const _startTime = Date.now();

function registerHealthRoute(ctx) {
  const { core, walletDatabase, mintedAddresses, rateLimitStore } = ctx;
  const { respondJson } = core;

  return async function handleHealthRoute(req, res) {
    if (req.url !== '/health') return false;

    const uptimeSeconds = Math.floor((Date.now() - _startTime) / 1000);

    // walletDatabase dep status
    let walletDbStatus = 'unavailable';
    if (walletDatabase instanceof Map) {
      walletDbStatus = walletDatabase.size > 0 ? 'loaded' : 'empty';
    }

    // mintedAddresses dep status
    let mintedStatus = 'unavailable';
    if (mintedAddresses instanceof Set || mintedAddresses instanceof Map) {
      mintedStatus = `loaded-${mintedAddresses.size}`;
    }

    // rateLimitStore dep status
    let rateLimitStatus = 'unavailable';
    if (rateLimitStore && typeof rateLimitStore.get === 'function') {
      rateLimitStatus = 'ok';
    }

    // Sentry status
    const sentryStatus = process.env.SENTRY_DSN ? 'configured' : 'not-configured';

    const payload = {
      ok: true,
      version: process.env.RELEASE || 'v1.0.33',
      uptime_seconds: uptimeSeconds,
      deps: {
        walletDatabase: walletDbStatus,
        mintedAddresses: mintedStatus,
        rateLimitStore: rateLimitStatus,
        sentry: sentryStatus,
      },
    };

    respondJson(res, 200, payload);
    return true;
  };
}

export { registerHealthRoute };
