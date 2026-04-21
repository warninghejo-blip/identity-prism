import { createBlackHoleOrchestrator } from '../services/blackHoleOrchestrator.js';

function registerBlackholeRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      requireJwt,
      readBody,
    },
  } = ctx;
  const blackHoleOrchestrator = createBlackHoleOrchestrator(ctx);

  return async function handleBlackholeRoute(req, res, url, pathname) {
    if (pathname !== '/api/blackhole/claim' || req.method !== 'POST') return false;

    if (!ipRateLimit('blackhole_claim', getClientIp(req), 15, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
    const jwtAuth = requireJwt(req, res);
    if (!jwtAuth.ok) return true;
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      respondJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    const result = await blackHoleOrchestrator.claim({ address: jwtAuth.address, payload });
    respondJson(res, result.status, result.body);
    return true;
  };
}

export { registerBlackholeRoute };
