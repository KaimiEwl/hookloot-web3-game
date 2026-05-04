import { z } from 'zod';
import { fail, ok } from '../lib/responses.js';
import { isActionError } from '../lib/actionErrors.js';
import { parseIdempotency } from '../lib/idempotency.js';
import { requireRateLimit } from '../lib/rateLimit.js';

const claimSchema = z.object({
  taskId: z.string().min(1).max(128).optional(),
  task_id: z.string().min(1).max(128).optional()
}).strict().refine((body) => body.taskId || body.task_id, {
  message: 'taskId is required'
});

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

export async function registerTaskRoutes(fastify) {
  fastify.get('/api/tasks', async (request, reply) => {
    const auth = await requireAuth(request, reply, fastify);
    if (!auth) return reply;
    try {
      return ok(reply, await fastify.tasksService.listTasks({
        userId: auth.userId,
        now: new Date()
      }));
    } catch (error) {
      return handleActionError(reply, error);
    }
  });

  fastify.post('/api/tasks/claim', async (request, reply) => {
    const auth = await requireAuth(request, reply, fastify);
    if (!auth) return reply;
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'tasks:claim',
      max: fastify.config.rateLimitActionsMax,
      windowSeconds: 60,
      userId: auth.userId
    })) return reply;

    const body = claimSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', body.error.issues);
    }
    const idempotency = requireIdempotency(request, reply);
    if (!idempotency) return reply;

    try {
      return ok(reply, await fastify.tasksService.claimTask({
        userId: auth.userId,
        taskId: body.data.taskId || body.data.task_id,
        now: new Date(),
        idempotency,
        request
      }));
    } catch (error) {
      return handleActionError(reply, error);
    }
  });
}
