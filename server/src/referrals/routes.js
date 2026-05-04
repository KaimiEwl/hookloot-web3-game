import { z } from 'zod';
import { fail, ok } from '../lib/responses.js';
import { isActionError } from '../lib/actionErrors.js';
import { parseIdempotency } from '../lib/idempotency.js';
import { requireRateLimit } from '../lib/rateLimit.js';

const applyCodeSchema = z.object({
  code: z.string().min(3).max(128)
}).strict();

async function requireAuth(request, reply, fastify) {
  const auth = await fastify.authService.authenticate(request);
  if (!auth.ok) {
    fail(reply, 401, auth.code, auth.message);
    return null;
  }
  return auth;
}

function requireIdempotency(request, reply) {
  const parsed = parseIdempotency(request);
  if (!parsed.ok) {
    fail(reply, 400, parsed.reason, 'Valid Idempotency-Key header is required');
    return null;
  }
  return parsed;
}

function handleActionError(reply, error) {
  if (isActionError(error)) {
    return fail(reply, error.statusCode || 400, error.code, error.message, error.details || null);
  }
  throw error;
}

export async function registerReferralRoutes(fastify) {
  fastify.get('/api/referrals/me', async (request, reply) => {
    const auth = await requireAuth(request, reply, fastify);
    if (!auth) return reply;
    try {
      return ok(reply, await fastify.referralsService.getMe({
        userId: auth.userId,
        now: new Date()
      }));
    } catch (error) {
      return handleActionError(reply, error);
    }
  });

  fastify.post('/api/referrals/apply-code', async (request, reply) => {
    const auth = await requireAuth(request, reply, fastify);
    if (!auth) return reply;
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'referrals:apply',
      max: fastify.config.rateLimitActionsMax,
      windowSeconds: 60,
      userId: auth.userId
    })) return reply;

    const body = applyCodeSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', body.error.issues);
    }
    const idempotency = requireIdempotency(request, reply);
    if (!idempotency) return reply;

    try {
      return ok(reply, await fastify.referralsService.applyCode({
        userId: auth.userId,
        code: body.data.code,
        now: new Date(),
        idempotency,
        request
      }));
    } catch (error) {
      return handleActionError(reply, error);
    }
  });
}
