import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramMembershipProvider } from '../src/telegram/provider.js';
import { evaluateSubscribeChannelReadiness } from '../src/tasks/service.js';

test('Telegram membership provider reports not_configured without token or channel', async () => {
  const provider = createTelegramMembershipProvider({
    botToken: '',
    chatId: '',
    fetchImpl: async () => {
      throw new Error('should not call Telegram API without config');
    }
  });

  assert.equal(provider.configured, false);
  const result = await provider.checkMembership('42');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_configured');
  assert.deepEqual(result.details.missing, ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_REQUIRED_CHANNEL_ID']);

  const readiness = await evaluateSubscribeChannelReadiness({
    telegramSocial: null,
    telegramMembershipProvider: provider
  });
  assert.equal(readiness.reason, 'not_configured');
});

test('Telegram membership provider passes members and rejects left/kicked users', async () => {
  const makeProvider = (status) => createTelegramMembershipProvider({
    botToken: 'bot-token',
    chatId: '@channel',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { ok: true, result: { status } };
      }
    })
  });

  for (const status of ['member', 'administrator', 'creator']) {
    const readiness = await evaluateSubscribeChannelReadiness({
      telegramSocial: { providerUserId: '42' },
      telegramMembershipProvider: makeProvider(status)
    });
    assert.equal(readiness.ok, true);
    assert.equal(readiness.details.status, status);
  }

  for (const status of ['left', 'kicked']) {
    const readiness = await evaluateSubscribeChannelReadiness({
      telegramSocial: { providerUserId: '42' },
      telegramMembershipProvider: makeProvider(status)
    });
    assert.equal(readiness.ok, false);
    assert.equal(readiness.reason, 'telegram_not_subscribed');
    assert.equal(readiness.details.status, status);
  }
});

test('Telegram membership provider maps access and API errors for tasks', async () => {
  const noAccess = createTelegramMembershipProvider({
    botToken: 'bot-token',
    chatId: '@channel',
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      async json() {
        return { ok: false, description: 'Forbidden: bot is not a member of the channel chat' };
      }
    })
  });
  const noAccessReadiness = await evaluateSubscribeChannelReadiness({
    telegramSocial: { providerUserId: '42' },
    telegramMembershipProvider: noAccess
  });
  assert.equal(noAccessReadiness.ok, false);
  assert.equal(noAccessReadiness.reason, 'verification_unavailable');
  assert.equal(noAccessReadiness.retryable, false);

  const rateLimited = createTelegramMembershipProvider({
    botToken: 'bot-token',
    chatId: '@channel',
    fetchImpl: async () => ({ ok: false, status: 429, async json() { return {}; } })
  });
  const rateLimitedReadiness = await evaluateSubscribeChannelReadiness({
    telegramSocial: { providerUserId: '42' },
    telegramMembershipProvider: rateLimited
  });
  assert.equal(rateLimitedReadiness.reason, 'telegram_rate_limited');
  assert.equal(rateLimitedReadiness.retryable, true);
});
