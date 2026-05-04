import { z } from 'zod';
import { fail, ok } from '../lib/responses.js';
import { parseIdempotency } from '../lib/idempotency.js';
import { isActionError } from '../lib/actionErrors.js';
import { requireRateLimit } from '../lib/rateLimit.js';

const emptyObjectSchema = z.object({}).strict();
const itemIntentSchema = z.object({
  itemId: z.string().min(1).max(64),
  rarityId: z.string().min(1).max(64)
}).strict();
const activateSlotSchema = itemIntentSchema.extend({
  slotIndex: z.number().int().min(0).max(32)
}).strict();
const removeSlotSchema = z.object({
  slotIndex: z.number().int().min(0).max(32)
}).strict();
const nftBoostSchema = z.object({
  rarityId: z.string().min(1).max(64)
}).strict();

async function requireGameAuth(request, reply, fastify) {
  const auth = await fastify.authService.authenticate(request);
  if (!auth.ok) {
    fail(reply, 401, auth.code, auth.message);
    return null;
  }
  return auth;
}

function requireActionIdempotency(request, reply) {
  const parsedIdempotency = parseIdempotency(request);
  if (!parsedIdempotency.ok) {
    fail(reply, 400, parsedIdempotency.reason, 'Valid Idempotency-Key header is required');
    return null;
  }
  return parsedIdempotency;
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

export async function registerGameRoutes(fastify) {
  fastify.get('/api/game/state', async (request, reply) => {
    const query = emptyObjectSchema.safeParse(request.query ?? {});
    if (!query.success) {
      return fail(reply, 400, 'validation_error', 'Invalid query params', query.error.issues);
    }

    const auth = await requireGameAuth(request, reply, fastify);
    if (!auth) return reply;

    const state = await fastify.gameService.getState({
      userId: auth.userId,
      now: new Date()
    });

    return ok(reply, state);
  });

  fastify.post('/api/game/sync', async (request, reply) => {
    const body = emptyObjectSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', body.error.issues);
    }

    const parsedIdempotency = parseIdempotency(request);
    if (!parsedIdempotency.ok && parsedIdempotency.reason !== 'missing_idempotency_key') {
      return fail(reply, 400, 'invalid_idempotency_key', 'Invalid Idempotency-Key header', parsedIdempotency);
    }

    const auth = await requireGameAuth(request, reply, fastify);
    if (!auth) return reply;
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'game_sync',
      max: fastify.config.rateLimitActionsMax,
      userId: auth.userId
    })) return reply;

    const state = await fastify.gameService.sync({
      userId: auth.userId,
      now: new Date(),
      idempotencyKey: parsedIdempotency.ok ? parsedIdempotency.key : null
    });

    return ok(reply, state);
  });

  fastify.post('/api/shop/buy', async (request, reply) => {
    const body = itemIntentSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', body.error.issues);
    }

    const auth = await requireGameAuth(request, reply, fastify);
    if (!auth) return reply;
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'shop_buy',
      max: fastify.config.rateLimitActionsMax,
      userId: auth.userId
    })) return reply;

    const idempotency = requireActionIdempotency(request, reply);
    if (!idempotency) return reply;

    try {
      const result = await fastify.gameService.buyShopItem({
        userId: auth.userId,
        itemId: body.data.itemId,
        rarityId: body.data.rarityId,
        now: new Date(),
        idempotency
      });
      return ok(reply, result);
    } catch (error) {
      return handleActionError(reply, error);
    }
  });

  fastify.post('/api/inventory/activate-slot', async (request, reply) => {
    const body = activateSlotSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', body.error.issues);
    }

    const auth = await requireGameAuth(request, reply, fastify);
    if (!auth) return reply;
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'activate_slot',
      max: fastify.config.rateLimitActionsMax,
      userId: auth.userId
    })) return reply;

    const idempotency = requireActionIdempotency(request, reply);
    if (!idempotency) return reply;

    try {
      const result = await fastify.gameService.activateSlot({
        userId: auth.userId,
        itemId: body.data.itemId,
        rarityId: body.data.rarityId,
        slotIndex: body.data.slotIndex,
        now: new Date(),
        idempotency
      });
      return ok(reply, result);
    } catch (error) {
      return handleActionError(reply, error);
    }
  });

  fastify.post('/api/inventory/remove-slot', async (request, reply) => {
    const body = removeSlotSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', body.error.issues);
    }

    const auth = await requireGameAuth(request, reply, fastify);
    if (!auth) return reply;
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'remove_slot',
      max: fastify.config.rateLimitActionsMax,
      userId: auth.userId
    })) return reply;

    const idempotency = requireActionIdempotency(request, reply);
    if (!idempotency) return reply;

    try {
      const result = await fastify.gameService.removeSlot({
        userId: auth.userId,
        slotIndex: body.data.slotIndex,
        now: new Date(),
        idempotency
      });
      return ok(reply, result);
    } catch (error) {
      return handleActionError(reply, error);
    }
  });

  fastify.post('/api/boosts/coin/activate', async (request, reply) => {
    const body = emptyObjectSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', body.error.issues);
    }

    const auth = await requireGameAuth(request, reply, fastify);
    if (!auth) return reply;
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'coin_boost',
      max: fastify.config.rateLimitActionsMax,
      userId: auth.userId
    })) return reply;

    const idempotency = requireActionIdempotency(request, reply);
    if (!idempotency) return reply;

    try {
      const result = await fastify.gameService.activateCoinBoost({
        userId: auth.userId,
        now: new Date(),
        idempotency
      });
      return ok(reply, result);
    } catch (error) {
      return handleActionError(reply, error);
    }
  });

  fastify.post('/api/boosts/nft/activate', async (request, reply) => {
    const body = nftBoostSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', body.error.issues);
    }

    const auth = await requireGameAuth(request, reply, fastify);
    if (!auth) return reply;
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'nft_boost',
      max: fastify.config.rateLimitActionsMax,
      userId: auth.userId
    })) return reply;

    const idempotency = requireActionIdempotency(request, reply);
    if (!idempotency) return reply;

    try {
      const result = await fastify.gameService.activateNftBoost({
        userId: auth.userId,
        rarityId: body.data.rarityId,
        now: new Date(),
        idempotency
      });
      return ok(reply, result);
    } catch (error) {
      return handleActionError(reply, error);
    }
  });
}
