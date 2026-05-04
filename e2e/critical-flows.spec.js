import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const COIN_UNIT = 1_000_000n;
const SESSION_STORAGE_KEY = 'nftMinerApiSession';

function units(coins) {
  return (BigInt(Math.round(Number(coins) * 1_000_000))).toString();
}

function money(coinsOrUnits) {
  const value = typeof coinsOrUnits === 'bigint'
    ? coinsOrUnits
    : BigInt(String(coinsOrUnits));
  const whole = value / COIN_UNIT;
  const fraction = (value % COIN_UNIT).toString().padStart(6, '0');
  return {
    units: value.toString(),
    coins: `${whole}.${fraction}`
  };
}

function envelope(data) {
  return {
    ok: true,
    data,
    error: null,
    meta: {
      requestId: `e2e-${Date.now()}`,
      serverTime: new Date().toISOString()
    }
  };
}

function errorEnvelope(code, message, details = null) {
  return {
    ok: false,
    data: null,
    error: { code, message, details },
    meta: {
      requestId: `e2e-${Date.now()}`,
      serverTime: new Date().toISOString()
    }
  };
}

function createServerState({
  balanceCoins = 123,
  inventory = { common: 1, rare: 0, epic: 0, legendary: 0, gold: 0 },
  activeSlots = { common: 0, rare: 0, epic: 0, legendary: 0, gold: 0 },
  boosts = [],
  incomePerHourCoins = 0
} = {}) {
  const now = new Date('2026-04-27T12:00:00.000Z').toISOString();
  const balanceUnits = BigInt(units(balanceCoins));
  const incomePerHourUnits = BigInt(units(incomePerHourCoins));
  return {
    balance: money(balanceUnits),
    balanceUnits: balanceUnits.toString(),
    inventory: Object.entries(inventory).map(([rarityId, quantity], index) => ({
      id: `inv-${rarityId}-${index}`,
      itemId: 'nft_card',
      rarityId,
      quantity
    })),
    activeSlots: {
      items: [],
      counts: activeSlots
    },
    boosts,
    incomePerHour: money(incomePerHourUnits),
    incomePerHourUnits: incomePerHourUnits.toString(),
    serverTime: now,
    lastMinedAt: now
  };
}

function paymentStatus({ configured = false, mode = 'testnet' } = {}) {
  return {
    configured,
    ready: configured,
    network: mode,
    mode,
    receiverWalletConfigured: configured,
    indexerConfigured: configured,
    workerCanRun: configured,
    orderTtlSeconds: 900,
    pollIntervalSeconds: 15,
    mainnetEnabled: false,
    worker: {
      status: 'idle',
      errorsTotal: 0
    }
  };
}

function safePostDataJSON(request) {
  try {
    return request.postDataJSON();
  } catch {
    return null;
  }
}

async function preparePage(page, {
  authenticated = true,
  fakeEconomy = false,
  language = 'en',
  screen = 'miner'
} = {}) {
  await page.addInitScript(({
    authenticated: isAuthenticated,
    fakeEconomy: shouldFakeEconomy,
    language: nextLanguage,
    screen: nextScreen
  }) => {
    localStorage.setItem('language', nextLanguage);
    localStorage.setItem('nftMinerLastScreen', nextScreen);
    if (shouldFakeEconomy) {
      localStorage.setItem('nftMinerState', JSON.stringify({
        balance: 999999999,
        balanceUnits: '999999999000000',
        inventory: { common: 999, rare: 999, epic: 999, legendary: 999, gold: 999 },
        activeSlots: { common: 999, rare: 999, epic: 999, legendary: 999, gold: 999 },
        coinBoostLevel: 10,
        ui: { screen: 'miner' }
      }));
    }
    if (isAuthenticated) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        token: 'e2e-test-token',
        expiresAt: '2099-01-01T00:00:00.000Z'
      }));
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, { authenticated, fakeEconomy, language, screen });
}

async function installAppMocks(page, options = {}) {
  const stateRef = {
    state: options.initialState || createServerState(),
    taskStatus: 'ready_to_claim',
    taskCopy: options.taskCopy || {
      connectTitle: 'Connect Telegram',
      connectDescription: 'Link Telegram for task rewards.',
      subscribeTitle: 'Subscribe to channel',
      subscribeDescription: 'Join our Telegram channel.'
    },
    shopMode: options.shopMode || 'success',
    claimMode: options.claimMode || 'success',
    paymentStatus: options.paymentStatus || paymentStatus(),
    telegramLinked: options.telegramLinked === true,
    requireAuth: options.requireAuth === true,
    requests: []
  };

  await page.route('**/tonconnect-manifest.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      url: 'https://demo.example.com',
      name: 'NFT Miner E2E',
      iconUrl: 'https://demo.example.com/vite.svg'
    })
  }));

  await page.route(/.*\.(mp4|webm|mp3|wav)(\?.*)?$/i, (route) => route.fulfill({
    status: 204,
    body: ''
  }));

  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.Telegram = window.Telegram || { WebApp: { initData: "", ready(){}, expand(){}, disableVerticalSwipes(){}, disableClosingConfirmation(){} } };'
  }));

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '') || '/';
    const method = request.method().toUpperCase();
    const authorization = request.headers().authorization || '';
    stateRef.requests.push({ path, method, headers: request.headers(), body: safePostDataJSON(request) });

    const protectedPaths = [
      '/game/state',
      '/game/sync',
      '/auth/me',
      '/auth/telegram/verify',
      '/shop/buy',
      '/tasks',
      '/tasks/claim',
      '/referrals/me',
      '/referrals/apply-code',
      '/payments/orders',
      '/withdrawals'
    ];
    if (stateRef.requireAuth && protectedPaths.includes(path) && !authorization) {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify(errorEnvelope('unauthorized', 'Connect TON wallet first.'))
      });
    }

    if (method === 'GET' && path === '/game/state') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(envelope(stateRef.state)) });
    }

    if (method === 'GET' && path === '/auth/me') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(envelope({
          user: { id: 'user-e2e' },
          wallets: [{ address: 'EQ_E2E_WALLET' }],
          linkedSocials: stateRef.telegramLinked
            ? [{ provider: 'telegram', providerUserId: '12345', username: 'miner_e2e' }]
            : [],
          session: { expiresAt: '2099-01-01T00:00:00.000Z' }
        }))
      });
    }

    if (method === 'POST' && path === '/auth/telegram/verify') {
      const body = safePostDataJSON(request) || {};
      if (!body.initData) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify(errorEnvelope('validation_error', 'Telegram initData is required.'))
        });
      }
      stateRef.telegramLinked = true;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(envelope({
          social: { provider: 'telegram', providerUserId: '12345', username: 'miner_e2e' }
        }))
      });
    }

    if (method === 'POST' && path === '/game/sync') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(envelope(stateRef.state)) });
    }

    if (method === 'GET' && path === '/payments/status') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(envelope(stateRef.paymentStatus)) });
    }

    if (method === 'POST' && path === '/payments/orders') {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify(errorEnvelope('payment_receiver_not_configured', 'Payment receiver is not configured.'))
      });
    }

    if (method === 'POST' && path === '/shop/buy') {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const idempotencyKey = request.headers()['idempotency-key'];
      if (!idempotencyKey) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify(errorEnvelope('validation_error', 'Idempotency-Key is required.'))
        });
      }
      if (stateRef.shopMode === 'insufficient') {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify(errorEnvelope('insufficient_balance', 'Not enough coins.'))
        });
      }
      stateRef.state = createServerState({
        balanceCoins: 118,
        inventory: { common: 2, rare: 0, epic: 0, legendary: 0, gold: 0 }
      });
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(envelope({ state: stateRef.state }))
      });
    }

    if (method === 'GET' && path === '/tasks') {
      const canClaim = stateRef.taskStatus === 'ready_to_claim';
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(envelope({
          tasks: [
            {
              id: 'connect_telegram',
              taskCode: 'connect_telegram',
              type: 'connect_telegram',
              title: stateRef.taskCopy.connectTitle,
              description: stateRef.taskCopy.connectDescription,
              rewardUnits: units(25),
              status: stateRef.taskStatus,
              canClaim: false,
              readiness: canClaim
                ? { ok: true }
                : { ok: false, reason: stateRef.telegramLinked ? 'already_claimed' : 'telegram_not_linked' }
            },
            {
              id: 'subscribe_channel',
              taskCode: 'subscribe_to_channel',
              type: 'subscribe_to_channel',
              title: stateRef.taskCopy.subscribeTitle,
              description: stateRef.taskCopy.subscribeDescription,
              rewardUnits: units(50),
              status: 'pending',
              canClaim: false,
              readiness: { ok: false, reason: 'not_configured', retryable: false, details: { missing: ['TELEGRAM_BOT_TOKEN'] } }
            }
          ]
        }))
      });
    }

    if (method === 'POST' && path === '/tasks/claim') {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const idempotencyKey = request.headers()['idempotency-key'];
      if (!idempotencyKey) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify(errorEnvelope('validation_error', 'Idempotency-Key is required.'))
        });
      }
      if (stateRef.claimMode === 'error') {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify(errorEnvelope('task_not_completed', 'Task is not completed yet.'))
        });
      }
      stateRef.taskStatus = 'claimed';
      stateRef.state = createServerState({ balanceCoins: 148 });
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(envelope({ state: stateRef.state }))
      });
    }

    if (method === 'GET' && path === '/referrals/me') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(envelope({
          code: 'MINER-E2E',
          referralLink: 'https://demo.example.com/?ref=MINER-E2E',
          relationships: [{ id: 'friend-1', status: 'linked', username: 'tester' }]
        }))
      });
    }

    if (method === 'POST' && path === '/referrals/apply-code') {
      const body = safePostDataJSON(request) || {};
      if (body.code === 'MINER-E2E') {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify(errorEnvelope('referral_self', 'Self-referral is not allowed.'))
        });
      }
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify(errorEnvelope('referral_invalid', 'Invalid referral code.'))
      });
    }

    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify(errorEnvelope('not_found', `Unhandled E2E route: ${method} ${path}`))
    });
  });

  return stateRef;
}

async function openApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => !document.body.classList.contains('app-preloading'), null, { timeout: 12_000 });
  await page.waitForFunction(() => {
    const preload = document.querySelector('#preloadScreen');
    return !preload || preload.classList.contains('hidden');
  }, null, { timeout: 12_000 });
  await page.waitForTimeout(500);
  await expect(page.locator('#app')).toBeVisible();
}

async function openShop(page) {
  await page.locator('#openShopBtn').click();
  await expect(page.locator('#screenShop')).toHaveClass(/is-active/);
  await page.waitForTimeout(1_250);
  await expect(page.locator('#shopBuyBtn')).toBeVisible();
}

async function openTasks(page) {
  await page.locator('#navTasksBtn').click();
  await expect(page.locator('#screenTasks')).toHaveClass(/is-active/);
  await expect(page.locator('#tasksList')).toBeVisible();
}

const VISUAL_DIR = 'test-results/visual';
const RU_TASK_COPY = {
  connectTitle: 'ÐŸÑ€Ð¸Ð²ÑÐ·Ð°Ñ‚ÑŒ Telegram',
  connectDescription: 'Ð¡Ð²ÑÐ¶Ð¸Ñ‚Ðµ Telegram, Ñ‡Ñ‚Ð¾Ð±Ñ‹ Ð¿Ð¾Ð»ÑƒÑ‡Ð°Ñ‚ÑŒ Ð½Ð°Ð³Ñ€Ð°Ð´Ñ‹ Ð·Ð° Telegram-Ð·Ð°Ð´Ð°Ð½Ð¸Ñ.',
  subscribeTitle: 'ÐŸÐ¾Ð´Ð¿Ð¸ÑÐ°Ñ‚ÑŒÑÑ Ð½Ð° ÐºÐ°Ð½Ð°Ð»',
  subscribeDescription: 'ÐŸÐ¾Ð´Ð¿Ð¸ÑˆÐ¸Ñ‚ÐµÑÑŒ Ð½Ð° Telegram-ÐºÐ°Ð½Ð°Ð» Ð¸ Ð¿Ð¾Ð»ÑƒÑ‡Ð¸Ñ‚Ðµ Ð½Ð°Ð³Ñ€Ð°Ð´Ñƒ.'
};

async function expectNoHorizontalOverflow(page) {
  const viewport = page.viewportSize();
  const width = viewport?.width || 0;
  const overflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth
  ) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);

  const offenders = await page.evaluate(() => {
    const ignoredTags = new Set(['INPUT', 'TEXTAREA', 'CANVAS', 'SVG', 'PATH']);
    return Array.from(document.querySelectorAll('body *'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (ignoredTags.has(element.tagName)) return false;
        const style = window.getComputedStyle(element);
        if (style.position === 'fixed') return false;
        return element.scrollWidth - element.clientWidth > 48;
      })
      .slice(0, 5)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        className: String(element.className || ''),
        extra: element.scrollWidth - element.clientWidth
      }));
  });
  expect(offenders, `horizontal overflow at ${width}px viewport`).toEqual([]);
}

async function expectTasksLayout(page) {
  await expectNoHorizontalOverflow(page);
  await expect(page.locator('#screenTasks')).toHaveClass(/is-active/);
  await expect(page.locator('#tasksTelegramPanel')).toBeVisible();
  await expect(page.locator('#tasksTelegramLinkBtn')).toBeVisible();

  const viewport = page.viewportSize();
  const telegramBox = await page.locator('#tasksTelegramPanel').boundingBox();
  expect(telegramBox?.width || 0).toBeGreaterThanOrEqual(Math.min(280, (viewport?.width || 320) - 32));
  if ((viewport?.width || 0) >= 900) {
    expect(telegramBox?.width || 0).toBeGreaterThan(760);
  }

  const textBox = await page.locator('#tasksTelegramPanel > div').boundingBox();
  expect(textBox?.width || 0).toBeGreaterThanOrEqual(Math.min(240, (viewport?.width || 320) - 60));

  const overlap = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const clipRect = (rect, clip) => ({
      top: Math.max(rect.top, clip.top),
      bottom: Math.min(rect.bottom, clip.bottom),
      left: Math.max(rect.left, clip.left),
      right: Math.min(rect.right, clip.right)
    });
    const hasArea = (rect) => rect.bottom > rect.top && rect.right > rect.left;
    const screenRect = document.querySelector('#screenTasks')?.getBoundingClientRect();
    const rects = ['#ai-chat-widget', '.bottom-nav']
      .map((selector) => document.querySelector(selector))
      .filter(isVisible)
      .map((element) => element.getBoundingClientRect());
    const cards = Array.from(document.querySelectorAll('#screenTasks .task-card, #screenTasks .tasks-state-card'))
      .filter(isVisible)
      .map((element) => {
        const rawRect = element.getBoundingClientRect();
        const rect = screenRect ? clipRect(rawRect, screenRect) : rawRect;
        return { className: String(element.className), rect };
      })
      .filter(({ rect }) => hasArea(rect));
    return cards
      .filter(({ rect }) => rects.some((blocker) => !(
        rect.bottom <= blocker.top
        || rect.top >= blocker.bottom
        || rect.right <= blocker.left
        || rect.left >= blocker.right
      )))
      .map(({ className }) => className);
  });
  expect(overlap).toEqual([]);
}

async function expectMobileMinerLayout(page) {
  const bodyOverflow = await page.evaluate(() => Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth
  ) - window.innerWidth);
  expect(bodyOverflow).toBeLessThanOrEqual(2);
  await expect(page.locator('#lane-common')).toBeVisible();
  await expect(page.locator('#slot-common')).toBeVisible();

  const laneBox = await page.locator('#lane-common').boundingBox();
  const slotBox = await page.locator('#slot-common').boundingBox();
  expect(laneBox?.width || 0).toBeGreaterThanOrEqual(110);
  expect(slotBox?.width || 0).toBeGreaterThanOrEqual(120);

  const overlap = await page.evaluate(() => {
    const chat = document.querySelector('#ai-chat-widget')?.getBoundingClientRect();
    if (!chat) return false;
    const screen = document.querySelector('#screenMiner')?.getBoundingClientRect();
    const clip = (rect) => screen ? ({
      top: Math.max(rect.top, screen.top),
      bottom: Math.min(rect.bottom, screen.bottom),
      left: Math.max(rect.left, screen.left),
      right: Math.min(rect.right, screen.right)
    }) : rect;
    const hasArea = (rect) => rect.bottom > rect.top && rect.right > rect.left;
    return Array.from(document.querySelectorAll('.lane-card, .drop-slot'))
      .filter((element) => {
        const rect = clip(element.getBoundingClientRect());
        return rect.width > 0 && rect.height > 0
          && hasArea(rect)
          && rect.bottom > 0 && rect.top < window.innerHeight
          && rect.right > 0 && rect.left < window.innerWidth;
      })
      .some((element) => {
        const rect = clip(element.getBoundingClientRect());
        return !(
          rect.bottom <= chat.top
          || rect.top >= chat.bottom
          || rect.right <= chat.left
          || rect.left >= chat.right
        );
      });
  });
  expect(overlap).toBe(false);
}

async function captureVisual(page, filename) {
  mkdirSync(VISUAL_DIR, { recursive: true });
  await page.screenshot({ path: `${VISUAL_DIR}/${filename}`, fullPage: true });
}

test.describe('critical frontend smoke flows', () => {
  test('frontend loads and unauthorized user sees wallet connect state', async ({ page }) => {
    await preparePage(page, { authenticated: false });
    await installAppMocks(page, { requireAuth: true });

    await openApp(page);
    await expect(page).toHaveTitle(/NFT Miner/);

    await page.locator('#navWalletBtn').click();
    await expect(page.locator('#walletConnectActionBtn')).toBeVisible();
    await expect(page.locator('#walletConnectActionBtn')).toContainText(/Connect TON/i);
    await expect(page.locator('#walletStatusText')).toContainText(/Not connected/i);
  });

  test('fake localStorage economy does not override displayed server balance', async ({ page }) => {
    await preparePage(page, { authenticated: true, fakeEconomy: true });
    await installAppMocks(page, {
      initialState: createServerState({ balanceCoins: 123, incomePerHourCoins: 0 })
    });

    await openApp(page);
    await expect(page.locator('#balance')).toHaveText('123.000');
    await expect(page.locator('#lane-common .count-badge')).toHaveText('x1');
    await expect(page.locator('#lane-gold .count-badge')).toHaveText('x0');
  });

  test('authenticated mocked user loads authoritative game state', async ({ page }) => {
    await preparePage(page, { authenticated: true });
    const api = await installAppMocks(page, {
      initialState: createServerState({ balanceCoins: 321, incomePerHourCoins: 0 })
    });

    await openApp(page);
    await expect(page.locator('#balance')).toHaveText('321.000');
    expect(api.requests.some((entry) => entry.method === 'GET' && entry.path === '/game/state')).toBe(true);
  });

  test('shop buy flow handles pending, insufficient balance and success server state', async ({ page }) => {
    await preparePage(page, { authenticated: true });
    const api = await installAppMocks(page, {
      initialState: createServerState({ balanceCoins: 123, incomePerHourCoins: 0 }),
      shopMode: 'insufficient'
    });

    await openApp(page);
    await openShop(page);

    await page.locator('#shopBuyBtn').click();
    await expect(page.locator('#shopConfirmModal')).toHaveClass(/active/);
    await page.locator('#shopConfirmYes').click();
    await expect(page.locator('#shopConfirmYes')).toBeDisabled();
    await expect(page.locator('#miner-toast')).toContainText(/Not enough coins/i);
    await expect(page.locator('#balance')).toHaveText('123.000');

    api.shopMode = 'success';
    await page.locator('#shopConfirmYes').click();
    await expect(page.locator('#shopConfirmYes')).toBeDisabled();
    await expect(page.locator('#balance')).toHaveText('118.000');
    await expect(page.locator('#lane-common .count-badge')).toHaveText('x2');
  });

  test('tasks claim error and success use server responses', async ({ page }) => {
    await preparePage(page, { authenticated: true });
    const api = await installAppMocks(page, {
      initialState: createServerState({ balanceCoins: 123, incomePerHourCoins: 0 }),
      claimMode: 'error'
    });

    await openApp(page);
    await openTasks(page);
    await expect(page.locator('#tasksTelegramPanel')).toBeVisible();
    await expect(page.locator('#tasksTelegramStatus')).toContainText(/Telegram linking is available/i);
    await expect(page.locator('#tasksList')).toContainText('Connect Telegram');
    await expect(page.locator('#tasksList')).toContainText('Subscribe to channel');
    await expect(page.locator('#tasksList')).toContainText(/Subscription task is not configured yet/i);

    await page.locator('.task-claim-btn[data-task-id="connect_telegram"]').click();
    await expect(page.locator('.task-claim-btn[data-task-id="connect_telegram"]')).toBeDisabled();
    await expect(page.locator('#tasksStatus')).toContainText(/Task is not completed/i);
    await expect(page.locator('#balance')).toHaveText('123.000');

    api.claimMode = 'success';
    await page.locator('.task-claim-btn[data-task-id="connect_telegram"]').click();
    await expect(page.locator('#balance')).toHaveText('148.000');
    await expect(page.locator('#tasksList')).toContainText(/claimed/i);
  });

  test('Telegram connected state is shown from /api/auth/me', async ({ page }) => {
    await preparePage(page, { authenticated: true });
    await installAppMocks(page, { telegramLinked: true });

    await openApp(page);
    await openTasks(page);
    await expect(page.locator('#tasksTelegramStatus')).toContainText(/Telegram connected/i);
    await expect(page.locator('#tasksTelegramStatus')).toContainText(/miner_e2e/i);
  });

  test('referrals show code and map invalid/self-referral errors', async ({ page }) => {
    await preparePage(page, { authenticated: true });
    await installAppMocks(page);

    await openApp(page);
    await openTasks(page);
    await expect(page.locator('#tasksReferralCode')).toHaveValue('MINER-E2E');
    await expect(page.locator('#tasksReferralSummary')).toContainText('Invites');

    await page.locator('#tasksReferralApplyInput').fill('BAD-CODE');
    await page.locator('#tasksReferralApplyBtn').click();
    await expect(page.locator('#tasksStatus')).toContainText(/Invalid referral code/i);

    await page.locator('#tasksReferralApplyInput').fill('MINER-E2E');
    await page.locator('#tasksReferralApplyBtn').click();
    await expect(page.locator('#tasksStatus')).toContainText(/Self-referral is not allowed/i);
  });

  test('payment status shows testnet mode and disabled receiver message', async ({ page }) => {
    await preparePage(page, { authenticated: true });
    await installAppMocks(page, {
      paymentStatus: paymentStatus({ configured: false, mode: 'testnet' })
    });

    await openApp(page);
    await page.locator('#navWalletBtn').click();
    await expect(page.locator('#walletPaymentModeValue')).toContainText(/testnet/i);
    await expect(page.locator('#walletPaymentStatusValue')).toContainText(/Payment receiver is not configured/i);
  });
});

test.describe('visual product smoke', () => {
  test('desktop unauthorized tasks layout screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await preparePage(page, { authenticated: false, language: 'ru' });
    await installAppMocks(page, { requireAuth: true });

    await openApp(page);
    await openTasks(page);
    await expect(page.locator('#tasksList')).toContainText(/ÐŸÐ¾Ð´ÐºÐ»ÑŽÑ‡Ð¸|ÐŸÐ¾Ð´ÐºÐ»ÑŽÑ‡Ð¸Ñ‚Ðµ/i);
    await expectTasksLayout(page);
    await captureVisual(page, 'desktop-unauth.png');
  });

  test('tablet unauthorized tasks layout screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await preparePage(page, { authenticated: false, language: 'ru' });
    await installAppMocks(page, { requireAuth: true });

    await openApp(page);
    await openTasks(page);
    await expect(page.locator('#tasksList')).toContainText(/ÐŸÐ¾Ð´ÐºÐ»ÑŽÑ‡Ð¸|ÐŸÐ¾Ð´ÐºÐ»ÑŽÑ‡Ð¸Ñ‚Ðµ/i);
    await expectTasksLayout(page);
    await captureVisual(page, 'tablet-unauth.png');
  });

  test('mobile unauthorized tasks layout screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await preparePage(page, { authenticated: false, language: 'ru' });
    await installAppMocks(page, { requireAuth: true });

    await openApp(page);
    await openTasks(page);
    await expect(page.locator('#tasksList')).toContainText(/ÐŸÐ¾Ð´ÐºÐ»ÑŽÑ‡Ð¸|ÐŸÐ¾Ð´ÐºÐ»ÑŽÑ‡Ð¸Ñ‚Ðµ/i);
    await expectTasksLayout(page);
    await captureVisual(page, 'mobile-unauth.png');
  });

  test('mobile miner layout screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await preparePage(page, { authenticated: true, language: 'ru' });
    await installAppMocks(page, {
      initialState: createServerState({ balanceCoins: 321, incomePerHourCoins: 0 })
    });

    await openApp(page);
    await expect(page.locator('#screenMiner')).toHaveClass(/is-active/);
    await expectMobileMinerLayout(page);
    await captureVisual(page, 'mobile-miner.png');
  });

  test('desktop authenticated tasks layout screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await preparePage(page, { authenticated: true, language: 'ru' });
    await installAppMocks(page, {
      taskCopy: RU_TASK_COPY,
      initialState: createServerState({ balanceCoins: 321, incomePerHourCoins: 0 })
    });

    await openApp(page);
    await openTasks(page);
    await expect(page.locator('#balance')).toHaveText('321.000');
    await expect(page.locator('#tasksList')).toContainText('ÐŸÑ€Ð¸Ð²ÑÐ·Ð°Ñ‚ÑŒ Telegram');
    await expect(page.locator('#tasksList')).toContainText(/Ð—Ð°Ð´Ð°Ð½Ð¸Ðµ Ð½Ð° Ð¿Ð¾Ð´Ð¿Ð¸ÑÐºÑƒ Ð¿Ð¾ÐºÐ° Ð½Ðµ Ð½Ð°ÑÑ‚Ñ€Ð¾ÐµÐ½Ð¾/i);
    await expectTasksLayout(page);
    await captureVisual(page, 'desktop-auth-tasks.png');
  });

  test('mobile authenticated tasks layout screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await preparePage(page, { authenticated: true, language: 'ru' });
    await installAppMocks(page, {
      taskCopy: RU_TASK_COPY,
      initialState: createServerState({ balanceCoins: 321, incomePerHourCoins: 0 })
    });

    await openApp(page);
    await openTasks(page);
    await expect(page.locator('#tasksList')).toContainText('ÐŸÑ€Ð¸Ð²ÑÐ·Ð°Ñ‚ÑŒ Telegram');
    await expectTasksLayout(page);
    await captureVisual(page, 'mobile-auth-tasks.png');
  });

  test('payments status layout screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await preparePage(page, { authenticated: true, language: 'ru' });
    await installAppMocks(page, {
      paymentStatus: paymentStatus({ configured: false, mode: 'testnet' })
    });

    await openApp(page);
    await page.locator('#navWalletBtn').click();
    await expect(page.locator('#screenWallet')).toHaveClass(/is-active/);
    await expect(page.locator('#walletPaymentModeValue')).toContainText(/testnet/i);
    await expect(page.locator('#walletPaymentStatusValue')).toContainText(/Ð½Ðµ Ð½Ð°ÑÑ‚Ñ€Ð¾ÐµÐ½|not configured/i);
    await expectNoHorizontalOverflow(page);
    await captureVisual(page, 'payments-status.png');
  });
});
