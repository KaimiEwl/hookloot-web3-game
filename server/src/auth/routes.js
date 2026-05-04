import { z } from 'zod';
import { createTonProofPayload, verifyTonProof } from './tonProof.js';
import { createTonProofChallengeStore } from './challengeStore.js';
import { recordAuthEvent } from './repository.js';
import { fail, ok } from '../lib/responses.js';
import { requireRateLimit } from '../lib/rateLimit.js';

const emptyBodySchema = z.object({}).strict();

const tonVerifySchema = z.object({
  address: z.string().min(1),
  network: z.string().optional().default('mainnet'),
  public_key: z.string().optional(),
  publicKey: z.string().optional(),
  proof: z.object({
    timestamp: z.number().int().positive(),
    domain: z.object({
      lengthBytes: z.number().int().nonnegative(),
      value: z.string().min(1)
    }),
    signature: z.string().min(1),
    payload: z.string().min(1),
    state_init: z.string().optional(),
    stateInit: z.string().optional()
  })
});

function getRequestOrigin(request) {
  const origin = request.headers.origin;
  if (!origin || Array.isArray(origin)) return null;
  return origin;
}

export async function registerAuthRoutes(fastify) {
  const challengeStore = createTonProofChallengeStore(fastify.redis, {
    ttlSeconds: fastify.config.tonProofTtlSeconds
  });

  fastify.post('/api/auth/ton/payload', async (request, reply) => {
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'auth:ton:payload',
      max: fastify.config.rateLimitAuthMax,
      windowSeconds: 60
    })) return reply;

    const parsed = emptyBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', parsed.error.issues);
    }

    const payload = createTonProofPayload();
    const expiresAt = new Date(Date.now() + fastify.config.tonProofTtlSeconds * 1000).toISOString();
    await challengeStore.put(payload, {
      expiresAt,
      origin: getRequestOrigin(request),
      createdIp: request.ip,
      userAgent: request.headers['user-agent'] || ''
    });
    return ok(reply, { payload, expiresAt });
  });

  fastify.post('/api/auth/ton/verify', async (request, reply) => {
    if (!await requireRateLimit(fastify, request, reply, {
      scope: 'auth:ton',
      max: fastify.config.rateLimitAuthMax,
      windowSeconds: 60
    })) return reply;

    const parsed = tonVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return fail(reply, 400, 'validation_error', 'Invalid TON proof payload', parsed.error.issues);
    }

    const body = parsed.data;
    const challenge = await challengeStore.consume(body.proof.payload, {
      origin: getRequestOrigin(request),
      now: new Date()
    });
    if (!challenge.ok) {
      await recordAuthEvent(fastify.db, {
        walletAddress: body.address,
        type: 'ton_proof_rejected',
        ok: false,
        details: { reason: challenge.reason }
      });
      return fail(reply, 401, 'invalid_ton_proof', 'TON proof payload expired or already used');
    }

    const verified = await verifyTonProof(body, {
      allowedDomain: fastify.config.tonProofDomain,
      maxAgeSeconds: fastify.config.tonProofMaxAgeSeconds
    });

    if (!verified.ok) {
      await recordAuthEvent(fastify.db, {
        walletAddress: body.address,
        type: 'ton_proof_rejected',
        ok: false,
        details: { reason: verified.reason }
      });
      return fail(reply, 401, 'invalid_ton_proof', 'TON proof verification failed', { reason: verified.reason });
    }

    const session = await fastify.authService.createOrUpdateWalletSession({
      wallet: verified.wallet,
      config: fastify.config,
      userAgent: request.headers['user-agent'] || '',
      ip: request.ip
    });

    return ok(reply, {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: session.user
    });
  });

  fastify.get('/api/auth/me', async (request, reply) => {
    const query = emptyBodySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return fail(reply, 400, 'validation_error', 'Invalid query params', query.error.issues);
    }

    const auth = await fastify.authService.authenticate(request);
    if (!auth.ok) {
      return fail(reply, 401, auth.code, auth.message);
    }

    const current = await fastify.authService.getCurrentUser({
      userId: auth.userId,
      sessionId: auth.sessionId
    });
    if (!current) {
      return fail(reply, 401, 'invalid_auth', 'Invalid or expired session token');
    }

    return ok(reply, {
      user: {
        id: current.user.id,
        status: current.user.status,
        createdAt: current.user.createdAt,
        updatedAt: current.user.updatedAt
      },
      wallets: current.wallets.map((wallet) => ({
        id: wallet.id,
        address: wallet.address,
        rawAddress: wallet.rawAddress,
        network: wallet.network,
        publicKey: wallet.publicKey,
        isPrimary: wallet.isPrimary,
        verifiedAt: wallet.verifiedAt,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt
      })),
      linkedSocials: current.linkedSocials,
      session: current.session
    });
  });

  fastify.post('/api/auth/logout', async (request, reply) => {
    const parsed = emptyBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return fail(reply, 400, 'validation_error', 'Invalid request payload', parsed.error.issues);
    }

    const auth = await fastify.authService.authenticate(request);
    if (!auth.ok) {
      return fail(reply, 401, auth.code, auth.message);
    }

    const result = await fastify.authService.logout({
      userId: auth.userId,
      sessionId: auth.sessionId,
      walletAddress: auth.walletAddress,
      request,
      now: new Date()
    });

    return ok(reply, { loggedOut: true, revoked: result.revoked });
  });
}
