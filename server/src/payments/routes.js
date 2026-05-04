import { z } from 'zod';
import { fail, ok } from '../lib/responses.js';
import { parseIdempotency } from '../lib/idempotency.js';
import { isActionError } from '../lib/actionErrors.js';
import { getPaymentsRuntimeStatus } from './readiness.js';
import { requireRateLimit } from '../lib/rateLimit.js';
import { readPaymentWorkerStatus } from './workerStatus.js';

const createOrderSchema = z.object({
  itemId: z.string().min(1).max(96)
}).strict();

const orderParamsSchema = z.object({
  id: z.string().min(1).max(128)
}).strict();

const withdrawalSchema = z.object({
  amountUnits: z.string().regex(/^[0-9]+$/),
  assetType: z.enum(['TON', 'JETTON']).default('TON'),
  destinationWallet: z.string().min(1).max(128)
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

export async function registerPaymentRoutes(fastify) {
  fastify.get('/api/payments/status', async (_request, reply) => {
    const worker = await readPaymentWorkerStatus(fastify.redis);
    return ok(reply, { ...getPaymentsRuntimeStatus(fastify.config), worker });
  });

  fastify.post('/api/payments/orders', async (request, reply) => {
    const body = createOrderSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', body.error.issues);
    }

    const auth = await requireAuth(request, reply, fastify);
    if (!auth) return reply;
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'payment_order',
      max: fastify.config.rateLimitActionsMax,
      userId: auth.userId
    })) return reply;

    const idempotency = requireIdempotency(request, reply);
    if (!idempotency) return reply;

    try {
      const result = await fastify.paymentsService.createOrder({
        userId: auth.userId,
        walletAddress: auth.walletAddress,
        itemId: body.data.itemId,
        now: new Date(),
        idempotency,
        request
      });
      return ok(reply, result);
    } catch (error) {
      return handleActionError(reply, error);
    }
  });

  fastify.get('/api/payments/orders/:id', async (request, reply) => {
    const params = orderParamsSchema.safeParse(request.params ?? {});
    if (!params.success) {
      return fail(reply, 400, 'validation_error', 'Invalid route params', params.error.issues);
    }

    const auth = await requireAuth(request, reply, fastify);
    if (!auth) return reply;

    try {
      const result = await fastify.paymentsService.getOrder({
        userId: auth.userId,
        orderId: params.data.id,
        now: new Date()
      });
      return ok(reply, result);
    } catch (error) {
      return handleActionError(reply, error);
    }
  });

  fastify.post('/api/withdrawals', async (request, reply) => {
    const body = withdrawalSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', body.error.issues);
    }

    const auth = await requireAuth(request, reply, fastify);
    if (!auth) return reply;
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'withdrawal',
      max: fastify.config.rateLimitActionsMax,
      userId: auth.userId
    })) return reply;

    const idempotency = requireIdempotency(request, reply);
    if (!idempotency) return reply;

    try {
      const result = await fastify.paymentsService.createWithdrawal({
        userId: auth.userId,
        walletAddress: auth.walletAddress,
        amountUnits: body.data.amountUnits,
        assetType: body.data.assetType,
        destinationWallet: body.data.destinationWallet,
        now: new Date(),
        idempotency,
        request
      });
      return ok(reply, result);
    } catch (error) {
      return handleActionError(reply, error);
    }
  });
}
