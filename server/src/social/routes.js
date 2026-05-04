import { z } from 'zod';
import { fail, ok } from '../lib/responses.js';
import { isActionError } from '../lib/actionErrors.js';
import { requireRateLimit } from '../lib/rateLimit.js';

const telegramVerifySchema = z.object({
  initData: z.string().min(1).max(8192)
}).strict();

async function requireAuth(request, reply, fastify) {
  const auth = await fastify.authService.authenticate(request);
  if (!auth.ok) {
    fail(reply, 401, auth.code, auth.message);
    return null;
  }
  return auth;
}

function handleActionError(reply, error) {
  if (isActionError(error)) {
    return fail(
      reply,
      error.statusCode || 400,
      error.code || 'action_error',
      error.message || 'Action failed',
      error.details || null
    );
  }
  throw error;
}

export async function registerSocialRoutes(fastify) {
  fastify.post('/api/auth/telegram/verify', async (request, reply) => {
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'auth:telegram',
      max: fastify.config.rateLimitAuthMax,
      windowSeconds: 60
    })) return reply;

    const parsed = telegramVerifySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', parsed.error.issues);
    }

    const auth = await requireAuth(request, reply, fastify);
    if (!auth) return reply;

    try {
      const result = await fastify.socialService.verifyTelegram({
        userId: auth.userId,
        initData: parsed.data.initData,
        now: new Date(),
        request
      });
      return ok(reply, result);
    } catch (error) {
      return handleActionError(reply, error);
    }
  });
}
