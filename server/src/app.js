import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import Redis from 'ioredis';
import { createDb } from './db/client.js';
import { fail, normalizeFastifyError, ok } from './lib/responses.js';
import { createAuthService } from './auth/service.js';
import { registerAuthRoutes } from './auth/routes.js';
import { createGameService } from './game/service.js';
import { registerGameRoutes } from './game/routes.js';
import { createPaymentsService } from './payments/service.js';
import { registerPaymentRoutes } from './payments/routes.js';
import { createSocialService } from './social/service.js';
import { registerSocialRoutes } from './social/routes.js';
import { createTasksService } from './tasks/service.js';
import { registerTaskRoutes } from './tasks/routes.js';
import { createReferralsService } from './referrals/service.js';
import { registerReferralRoutes } from './referrals/routes.js';
import { createAdminService } from './admin/service.js';
import { registerAdminRoutes } from './admin/routes.js';
import {
  checkReadiness,
  createMetricsStore,
  registerObservability,
  renderMetrics
} from './lib/observability.js';

export async function buildServer(config, overrides = {}) {
  const fastify = Fastify({
    logger: false,
    genReqId(request) {
      const header = request.headers['x-request-id'];
      const value = Array.isArray(header) ? header[0] : header;
      return typeof value === 'string' && value.trim() ? value.trim() : randomUUID();
    }
  });

  const dbBundle = overrides.dbBundle || createDb(config.databaseUrl);
  const redis = overrides.redis || new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 3
  });

  if (!overrides.redis) {
    await redis.connect();
  }

  fastify.decorate('config', config);
  fastify.decorate('db', dbBundle.db || dbBundle);
  fastify.decorate('pgPool', dbBundle.pool || null);
  fastify.decorate('redis', redis);
  fastify.decorate('authService', overrides.authService || createAuthService(dbBundle.db || dbBundle, config));
  const gameService = overrides.gameService || createGameService(dbBundle.db || dbBundle, config);
  fastify.decorate('gameService', gameService);
  fastify.decorate('paymentsService', overrides.paymentsService || createPaymentsService(dbBundle.db || dbBundle, config));
  fastify.decorate('socialService', overrides.socialService || createSocialService(dbBundle.db || dbBundle, config));
  fastify.decorate('tasksService', overrides.tasksService || createTasksService(dbBundle.db || dbBundle, config));
  fastify.decorate('referralsService', overrides.referralsService || createReferralsService(dbBundle.db || dbBundle, config));
  fastify.decorate('adminService', overrides.adminService || createAdminService(dbBundle.db || dbBundle, config));
  fastify.decorate('metrics', overrides.metrics || createMetricsStore());

  registerObservability(fastify, {
    metrics: fastify.metrics,
    logger: overrides.observabilityLogger || console,
    enabled: config.nodeEnv !== 'test' || Boolean(overrides.observabilityLogger)
  });

  fastify.addHook('onRequest', async (request, reply) => {
    reply.requestId = request.id;
    reply.header('x-request-id', request.id);
  });

  await fastify.register(cors, {
    origin: config.corsOrigins,
    credentials: true
  });

  fastify.addHook('onRequest', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'SAMEORIGIN');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('cross-origin-opener-policy', 'same-origin');
  });

  fastify.get('/api/health', async (_request, reply) => {
    return ok(reply, { status: 'ok' });
  });

  fastify.get('/api/ready', async (_request, reply) => {
    const readiness = await checkReadiness({ dbBundle, redis, config });
    if (readiness.ready) {
      return ok(reply, { status: 'ready', checks: readiness.checks });
    }
    return fail(reply, 503, 'not_ready', 'Dependency readiness check failed', readiness.checks);
  });

  async function metricsHandler(_request, reply) {
    if (!config.metricsEnabled) {
      return fail(reply, 404, 'metrics_disabled', 'Metrics endpoint is disabled');
    }
    try {
      const body = await renderMetrics({
        metrics: fastify.metrics,
        dbBundle,
        redis,
        config
      });
      return reply.type('text/plain; version=0.0.4').send(body);
    } catch (error) {
      return fail(reply, 503, 'not_ready', 'Dependency readiness check failed', {
        reason: error?.message || 'unknown'
      });
    }
  }

  fastify.get('/api/metrics', metricsHandler);
  fastify.get('/metrics', metricsHandler);

  await registerAuthRoutes(fastify);
  await registerSocialRoutes(fastify);
  await registerGameRoutes(fastify);
  await registerPaymentRoutes(fastify);
  await registerTaskRoutes(fastify);
  await registerReferralRoutes(fastify);
  await registerAdminRoutes(fastify);

  fastify.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeFastifyError(error);
    return fail(
      reply,
      normalized.statusCode,
      normalized.code,
      normalized.message,
      normalized.details
    );
  });

  fastify.addHook('onClose', async () => {
    if (dbBundle.pool) await dbBundle.pool.end();
    await redis.quit();
  });

  return fastify;
}
