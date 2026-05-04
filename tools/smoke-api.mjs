const baseUrl = (process.env.SMOKE_BASE_URL || 'https://demo.example.com').replace(/\/$/, '');

const checks = [
  ['/api/health', [200]],
  ['/api/ready', [200, 503]],
  ['/api/payments/status', [200]]
];

let failed = false;

for (const [path, expectedStatuses] of checks) {
  const url = `${baseUrl}${path}`;
  try {
    const response = await fetch(url, {
      headers: {
        'x-request-id': `smoke-${Date.now()}-${path.replace(/[^a-z0-9]/gi, '-')}`
      }
    });
    const body = await response.text();
    const ok = expectedStatuses.includes(response.status);
    console.log(JSON.stringify({
      ok,
      url,
      status: response.status,
      expectedStatuses
    }));
    if (!ok) {
      failed = true;
      console.error(body.slice(0, 500));
    }
  } catch (error) {
    failed = true;
    console.error(JSON.stringify({
      ok: false,
      url,
      error: error?.message || 'request_failed'
    }));
  }
}

if (failed) process.exitCode = 1;
