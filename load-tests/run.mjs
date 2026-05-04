import autocannon from 'autocannon';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3101';
const args = new Set(process.argv.slice(2));
const profile = args.has('--profile')
  ? process.argv[process.argv.indexOf('--profile') + 1]
  : (process.env.LOAD_PROFILE || 'smoke');

const env = process.env;
const baseUrl = normalizeBaseUrl(env.BASE_URL || DEFAULT_BASE_URL);
const authToken = env.AUTH_TOKEN || '';
const vus = toPositiveInt(env.VUS, profile === 'smoke' ? 1 : 5);
const duration = env.DURATION || (profile === 'smoke' ? '5s' : '30s');
const runMutations = /^true$/i.test(env.RUN_MUTATIONS || '');
const postActionEndpoint = env.POST_ACTION_ENDPOINT || '/api/boosts/coin/activate';
const postActionBody = parseJsonEnv('POST_ACTION_BODY', {});
const requestTimeoutSeconds = toPositiveInt(env.REQUEST_TIMEOUT_SECONDS, 10);

const commonHeaders = {
  'accept': 'application/json',
  'user-agent': 'nft-miner-load-tests/1.0'
};

const authHeaders = authToken
  ? { ...commonHeaders, authorization: `Bearer ${authToken}` }
  : commonHeaders;

const scenarios = [
  {
    name: 'public health',
    method: 'GET',
    path: '/api/health',
    headers: commonHeaders,
    required: true
  },
  {
    name: 'public ready',
    method: 'GET',
    path: '/api/ready',
    headers: commonHeaders,
    required: true
  },
  {
    name: 'payment status',
    method: 'GET',
    path: '/api/payments/status',
    headers: commonHeaders,
    required: true
  },
  {
    name: 'authenticated game state',
    method: 'GET',
    path: '/api/game/state',
    headers: authHeaders,
    requiresAuth: true
  },
  {
    name: 'authenticated game sync',
    method: 'POST',
    path: '/api/game/sync',
    headers: withJsonHeaders(authHeaders, true),
    body: '{}',
    requiresAuth: true,
    idempotentPost: true
  },
  {
    name: 'tasks list',
    method: 'GET',
    path: '/api/tasks',
    headers: authHeaders,
    requiresAuth: true
  },
  {
    name: 'referrals me',
    method: 'GET',
    path: '/api/referrals/me',
    headers: authHeaders,
    requiresAuth: true
  },
  {
    name: 'POST action with Idempotency-Key',
    method: 'POST',
    path: postActionEndpoint,
    headers: withJsonHeaders(authHeaders, true),
    body: JSON.stringify(postActionBody),
    requiresAuth: true,
    requiresMutationOptIn: true,
    idempotentPost: true
  }
];

const runnableScenarios = scenarios.filter((scenario) => {
  if (scenario.requiresAuth && !authToken) {
    console.log(`[skip] ${scenario.name}: AUTH_TOKEN is not set.`);
    return false;
  }
  if (scenario.requiresMutationOptIn && !runMutations) {
    console.log(`[skip] ${scenario.name}: set RUN_MUTATIONS=true with a disposable test user to run this mutating action.`);
    return false;
  }
  return true;
});

if (runnableScenarios.length === 0) {
  console.error('No load-test scenarios selected. Set BASE_URL and, for protected routes, AUTH_TOKEN.');
  process.exitCode = 1;
} else {
  console.log(`Load profile: ${profile}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`VUS: ${vus}`);
  console.log(`Duration: ${duration}`);
  console.log(`Selected scenarios: ${runnableScenarios.map((s) => s.name).join(', ')}`);
  console.log('');

  let failed = false;
  for (const scenario of runnableScenarios) {
    const result = await runScenario(scenario);
    printScenarioSummary(scenario, result);
    if (result.errors > 0 || result.timeouts > 0) {
      failed = true;
    }
  }

  if (failed) {
    console.error('Load smoke finished with transport errors/timeouts. Check API health before running a larger profile.');
    process.exitCode = 1;
  }
}

function runScenario(scenario) {
  const request = {
    method: scenario.method,
    path: scenario.path,
    headers: scenario.headers,
    body: scenario.body
  };

  if (scenario.idempotentPost) {
    request.setupRequest = (rawRequest) => {
      rawRequest.headers = {
        ...(rawRequest.headers || {}),
        'idempotency-key': `load-${profile}-${Date.now()}-${Math.random().toString(16).slice(2)}`
      };
      return rawRequest;
    };
  }

  return autocannon({
    url: baseUrl,
    title: scenario.name,
    connections: vus,
    duration,
    timeout: requestTimeoutSeconds,
    pipelining: 1,
    requests: [request]
  });
}

function printScenarioSummary(scenario, result) {
  const statusCounts = Object.entries(result.statusCodeStats || {})
    .map(([status, stats]) => `${status}:${stats.count}`)
    .join(' ') || 'none';
  const p50 = formatNumber(result.latency?.p50);
  const p95 = formatNumber(result.latency?.p97_5 || result.latency?.p95);
  const p99 = formatNumber(result.latency?.p99);
  const rps = formatNumber(result.requests?.average);

  console.log(`=== ${scenario.name} ===`);
  console.log(`${scenario.method} ${scenario.path}`);
  console.log(`requests/sec avg=${rps} latency_ms p50=${p50} p95ish=${p95} p99=${p99}`);
  console.log(`status=${statusCounts} errors=${result.errors} timeouts=${result.timeouts} non2xx=${result.non2xx}`);
  console.log('');
}

function withJsonHeaders(headers, includeIdempotencyPlaceholder = false) {
  return {
    ...headers,
    'content-type': 'application/json',
    ...(includeIdempotencyPlaceholder ? { 'idempotency-key': 'load-placeholder' } : {})
  };
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJsonEnv(name, fallback) {
  const raw = env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[warn] ${name} is not valid JSON; using fallback. ${error.message}`);
    return fallback;
  }
}

function formatNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00';
}
