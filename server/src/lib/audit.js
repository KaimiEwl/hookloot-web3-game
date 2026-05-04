import { createHash } from 'node:crypto';
import { auditLogs } from '../db/schema.js';

function hashOptional(value) {
  const source = String(value || '').trim();
  if (!source) return null;
  return createHash('sha256').update(source).digest('hex');
}

function cleanMetadata(metadata = {}) {
  const blocked = new Set([
    'authorization',
    'token',
    'jwt',
    'adminBearerToken',
    'adminToken',
    'telegramBotToken',
    'rawInitData',
    'initData',
    'tonIndexerApiKey'
  ]);
  return Object.fromEntries(
    Object.entries(metadata || {}).filter(([key]) => !blocked.has(key))
  );
}

export async function recordAuditLog(dbOrTx, {
  userId = null,
  eventType,
  actorType = 'user',
  request = null,
  metadata = {},
  now = new Date()
}) {
  if (!eventType) return;
  await dbOrTx.insert(auditLogs).values({
    userId,
    eventType,
    actorType,
    ipHash: hashOptional(request?.ip),
    userAgentHash: hashOptional(request?.headers?.['user-agent']),
    metadata: cleanMetadata(metadata),
    createdAt: now
  });
}
