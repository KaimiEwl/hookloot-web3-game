import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

function secretKey(secret) {
  return new TextEncoder().encode(secret);
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function signSessionToken({ userId, sessionId = randomUUID(), walletAddress, config, now = new Date() }) {
  const expiresAt = new Date(now.getTime() + Number(config.sessionTtlSeconds) * 1000);
  const token = await new SignJWT({ wallet: walletAddress })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setJti(sessionId)
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey(config.jwtSecret));

  return { token, sessionId, expiresAt };
}

export async function verifySessionToken(token, config) {
  const result = await jwtVerify(token, secretKey(config.jwtSecret), {
    issuer: config.jwtIssuer,
    audience: config.jwtAudience
  });
  return result.payload;
}
