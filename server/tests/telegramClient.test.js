import test from 'node:test';
import assert from 'node:assert/strict';

import { getTelegramChatMember } from '../src/telegram/client.js';

test('Telegram client treats member statuses as subscribed', async () => {
  for (const status of ['member', 'administrator', 'creator']) {
    const result = await getTelegramChatMember({
      botToken: 'bot-token',
      apiBaseUrl: 'https://api.telegram.org',
      chatId: '@channel',
      userId: '42',
      fetchImpl: async (url) => {
        assert.equal(String(url).includes('/botbot-token/getChatMember'), true);
        return {
          ok: true,
          async json() {
            return { ok: true, result: { status } };
          }
        };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, status);
    assert.equal(result.isMember, true);
  }
});

test('Telegram client rejects missing config and non-member statuses safely', async () => {
  assert.equal((await getTelegramChatMember({
    botToken: '',
    apiBaseUrl: 'https://api.telegram.org',
    chatId: '@channel',
    userId: '42',
    fetchImpl: async () => ({ ok: true, async json() { return { ok: true }; } })
  })).reason, 'telegram_bot_token_missing');

  const left = await getTelegramChatMember({
    botToken: 'bot-token',
    apiBaseUrl: 'https://api.telegram.org',
    chatId: '@channel',
    userId: '42',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { ok: true, result: { status: 'left' } };
      }
    })
  });

  assert.equal(left.ok, true);
  assert.equal(left.isMember, false);

  const kicked = await getTelegramChatMember({
    botToken: 'bot-token',
    apiBaseUrl: 'https://api.telegram.org',
    chatId: '@channel',
    userId: '42',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { ok: true, result: { status: 'kicked' } };
      }
    })
  });

  assert.equal(kicked.ok, true);
  assert.equal(kicked.isMember, false);
});

test('Telegram client classifies access errors and rate limits', async () => {
  const noAccess = await getTelegramChatMember({
    botToken: 'bot-token',
    apiBaseUrl: 'https://api.telegram.org',
    chatId: '@channel',
    userId: '42',
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      async json() {
        return { ok: false, description: 'Forbidden: bot is not a member of the channel chat' };
      }
    })
  });

  assert.equal(noAccess.ok, false);
  assert.equal(noAccess.reason, 'verification_unavailable');
  assert.equal(noAccess.retryable, false);

  const rateLimited = await getTelegramChatMember({
    botToken: 'bot-token',
    apiBaseUrl: 'https://api.telegram.org',
    chatId: '@channel',
    userId: '42',
    fetchImpl: async () => ({ ok: false, status: 429, async json() { return {}; } })
  });

  assert.equal(rateLimited.reason, 'telegram_rate_limited');
  assert.equal(rateLimited.retryable, true);

  const notFound = await getTelegramChatMember({
    botToken: 'bot-token',
    apiBaseUrl: 'https://api.telegram.org',
    chatId: '@channel',
    userId: '42',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { ok: false, description: 'Bad Request: user not found' };
      }
    })
  });

  assert.equal(notFound.ok, true);
  assert.equal(notFound.status, 'not_found');
  assert.equal(notFound.isMember, false);
});
