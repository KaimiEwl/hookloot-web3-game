import { and, eq } from 'drizzle-orm';
import { idempotencyKeys } from '../db/schema.js';
import { ActionError } from './actionErrors.js';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export async function runIdempotentAction(tx, {
  userId,
  route,
  key,
  requestHash,
  now = new Date(),
  scope = `economy_action:${userId}`,
  run
}) {
  if (!key || !requestHash) {
    throw new ActionError('missing_idempotency_key', 'Idempotency-Key header is required', {
      statusCode: 400
    });
  }

  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);

  await tx
    .insert(idempotencyKeys)
    .values({
      userId,
      scope,
      route,
      key,
      requestHash,
      status: 'started',
      expiresAt
    })
    .onConflictDoNothing({
      target: [idempotencyKeys.scope, idempotencyKeys.route, idempotencyKeys.key]
    });

  const [record] = await tx
    .select()
    .from(idempotencyKeys)
    .where(and(
      eq(idempotencyKeys.scope, scope),
      eq(idempotencyKeys.route, route),
      eq(idempotencyKeys.key, key)
    ))
    .for('update')
    .limit(1);

  if (!record) {
    throw new ActionError('idempotency_unavailable', 'Idempotency record is unavailable', {
      statusCode: 500
    });
  }

  if (record.requestHash !== requestHash) {
    throw new ActionError('idempotency_conflict', 'Idempotency-Key was already used with another request body', {
      statusCode: 409,
      details: { key, route }
    });
  }

  if (record.status === 'completed' && record.response) {
    return record.response;
  }

  const response = await run();

  await tx
    .update(idempotencyKeys)
    .set({
      response,
      status: 'completed',
      updatedAt: now,
      expiresAt
    })
    .where(eq(idempotencyKeys.id, record.id));

  return response;
}
