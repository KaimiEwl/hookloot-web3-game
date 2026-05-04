import { randomUUID, createHash } from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { users, wallets, sessions, authEvents, auditLogs, linkedSocials } from '../db/schema.js';
import { hashToken, signSessionToken } from './jwt.js';

function hashIp(value) {
  if (!value) return null;
  return createHash('sha256').update(String(value)).digest('hex');
}

export async function recordAuthEvent(db, { userId = null, walletAddress = null, type, ok, details = {} }) {
  await db.insert(authEvents).values({
    userId,
    walletAddress,
    type,
    ok,
    details
  });
  await db.insert(auditLogs).values({
    userId,
    eventType: type,
    actorType: 'user',
    metadata: {
      ok,
      walletAddress,
      reason: details?.reason || null
    }
  });
}

export async function validateActiveSession(db, { token, payload, now = new Date() }) {
  if (typeof db?.validateSession === 'function') {
    return db.validateSession({ token, payload, now });
  }

  if (typeof db?.select !== 'function') {
    return {
      ok: true,
      session: {
        id: payload.jti,
        userId: payload.sub,
        expiresAt: payload.exp ? new Date(Number(payload.exp) * 1000) : null
      },
      wallet: { address: payload.wallet || null }
    };
  }

  const [record] = await db
    .select({
      session: sessions,
      wallet: wallets,
      user: users
    })
    .from(sessions)
    .innerJoin(wallets, eq(wallets.id, sessions.walletId))
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(
      eq(sessions.id, payload.jti),
      eq(sessions.userId, payload.sub),
      eq(sessions.tokenHash, hashToken(token)),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, now)
    ))
    .limit(1);

  if (!record) {
    return { ok: false, reason: 'session_inactive' };
  }

  return {
    ok: true,
    session: record.session,
    wallet: record.wallet,
    user: record.user
  };
}

export async function getCurrentAuthUser(db, { userId, sessionId }) {
  const [summary] = await db
    .select({
      user: users,
      session: sessions
    })
    .from(users)
    .innerJoin(sessions, eq(sessions.userId, users.id))
    .where(and(eq(users.id, userId), eq(sessions.id, sessionId)))
    .limit(1);

  if (!summary) return null;

  const [userWallets, socials] = await Promise.all([
    db.select().from(wallets).where(eq(wallets.userId, userId)),
    db.select({
      id: linkedSocials.id,
      provider: linkedSocials.provider,
      providerUserId: linkedSocials.providerUserId,
      username: linkedSocials.username,
      verifiedAt: linkedSocials.verifiedAt,
      createdAt: linkedSocials.createdAt,
      updatedAt: linkedSocials.updatedAt
    }).from(linkedSocials).where(eq(linkedSocials.userId, userId))
  ]);

  return {
    user: summary.user,
    wallets: userWallets,
    linkedSocials: socials,
    session: {
      id: summary.session.id,
      expiresAt: summary.session.expiresAt,
      createdAt: summary.session.createdAt
    }
  };
}

export async function revokeSession(db, {
  userId,
  sessionId,
  walletAddress = null,
  request = null,
  now = new Date(),
  reason = 'logout'
}) {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt)
      ))
      .returning({ id: sessions.id });

    await tx.insert(authEvents).values({
      userId,
      walletAddress,
      type: 'logout',
      ok: true,
      details: { reason }
    });
    await tx.insert(auditLogs).values({
      userId,
      eventType: 'logout',
      actorType: 'user',
      ipHash: hashIp(request?.ip),
      userAgentHash: hashIp(request?.headers?.['user-agent']),
      metadata: {
        ok: true,
        reason,
        sessionRevoked: updated.length > 0
      }
    });

    return { revoked: updated.length > 0 };
  });
}

export async function cleanupExpiredSessions(db, { now = new Date() } = {}) {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(isNull(sessions.revokedAt), lt(sessions.expiresAt, now)))
    .returning({ id: sessions.id });

  return { revoked: rows.length };
}

export async function createOrUpdateWalletSession(db, { wallet, config, userAgent, ip }) {
  return db.transaction(async (tx) => {
    const found = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.address, wallet.address))
      .limit(1);

    let userId;
    let walletId;

    if (found.length) {
      userId = found[0].userId;
      walletId = found[0].id;
      await tx
        .update(wallets)
        .set({
          rawAddress: wallet.rawAddress,
          network: wallet.network,
          publicKey: wallet.publicKey,
          verifiedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(wallets.id, walletId));
    } else {
      const [user] = await tx.insert(users).values({}).returning();
      userId = user.id;
      const [createdWallet] = await tx
        .insert(wallets)
        .values({
          userId,
          address: wallet.address,
          rawAddress: wallet.rawAddress,
          network: wallet.network,
          publicKey: wallet.publicKey,
          isPrimary: true
        })
        .returning();
      walletId = createdWallet.id;
    }

    const { token, sessionId, expiresAt } = await signSessionToken({
      userId,
      sessionId: randomUUID(),
      walletAddress: wallet.address,
      config
    });

    await tx.insert(sessions).values({
      id: sessionId,
      userId,
      walletId,
      tokenHash: hashToken(token),
      userAgent: userAgent || null,
      ipHash: hashIp(ip),
      expiresAt
    });

    await tx.insert(authEvents).values({
      userId,
      walletAddress: wallet.address,
      type: 'ton_proof_verified',
      ok: true,
      details: { network: wallet.network }
    });
    await tx.insert(auditLogs).values({
      userId,
      eventType: 'ton_proof_verified',
      actorType: 'user',
      metadata: {
        ok: true,
        walletAddress: wallet.address,
        network: wallet.network
      }
    });

    return {
      token,
      expiresAt,
      user: {
        id: userId,
        walletAddress: wallet.address,
        network: wallet.network
      }
    };
  });
}
