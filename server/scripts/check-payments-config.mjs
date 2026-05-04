import { loadConfig } from '../src/config.js';
import { getPaymentsRuntimeStatus } from '../src/payments/readiness.js';

const requireReady = process.argv.includes('--require-ready');
const checkOnlyEnvDefaults = {
  PUBLIC_APP_ORIGIN: 'https://demo.example.com',
  TON_PROOF_DOMAIN: 'demo.example.com',
  JWT_SECRET: 'check-only-placeholder-jwt-secret-000000',
  DATABASE_URL: 'postgres://check:check@127.0.0.1:5432/check',
  REDIS_URL: 'redis://127.0.0.1:6379/0'
};
let config;
try {
  config = loadConfig({
    ...checkOnlyEnvDefaults,
    ...process.env
  });
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: 'payment_config_invalid',
      message: error?.message || 'Payment configuration is invalid'
    }
  }, null, 2));
  process.exit(1);
}

const status = getPaymentsRuntimeStatus(config);

console.log(JSON.stringify({
  ok: status.ready,
  payments: status
}, null, 2));

if (requireReady && !status.ready) {
  process.exitCode = 1;
}
