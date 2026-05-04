import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { verifyTelegramInitData } from '../src/telegram/initData.js';

function signInitData({ botToken, authDate = 1_700_000_000, user = { id: 42, username: 'miner' } }) {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', 'AAEAAAE');
  params.set('user', JSON.stringify(user));
  const dataCheckString = Array.from(params.entries())
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

test('Telegram initData verifier accepts signed WebApp payload', () => {
  const botToken = '123456:test-token';
  const initData = signInitData({ botToken });

  const result = verifyTelegramInitData(initData, {
    botToken,
    now: new Date(1_700_000_100 * 1000),
    ttlSeconds: 86400
  });

  assert.equal(result.ok, true);
  assert.equal(result.user.id, '42');
  assert.equal(result.user.username, 'miner');
});

test('Telegram initData verifier rejects invalid hash expired and missing auth_date', () => {
  const botToken = '123456:test-token';
  const initData = signInitData({ botToken });
  const tampered = new URLSearchParams(initData);
  const originalHash = tampered.get('hash');
  tampered.set('hash', `${originalHash?.startsWith('00') ? '11' : '00'}${originalHash?.slice(2) || ''}`);

  assert.equal(verifyTelegramInitData(tampered.toString(), {
    botToken,
    now: new Date(1_700_000_100 * 1000),
    ttlSeconds: 86400
  }).reason, 'invalid_init_data_signature');

  assert.equal(verifyTelegramInitData(initData, {
    botToken,
    now: new Date(1_700_100_000 * 1000),
    ttlSeconds: 60
  }).reason, 'init_data_expired');

  const missingAuthDate = new URLSearchParams(initData);
  missingAuthDate.delete('auth_date');
  assert.equal(verifyTelegramInitData(missingAuthDate.toString(), {
    botToken,
    now: new Date(1_700_000_100 * 1000),
    ttlSeconds: 86400
  }).reason, 'invalid_init_data');
});
