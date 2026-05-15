const TRUSTED_PROXIES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Extract real client IP, only trusting X-Forwarded-For from trusted proxies */
function getClientIp(req) {
  const socketIp = req.socket?.remoteAddress || 'unknown';
  if (TRUSTED_PROXIES.has(socketIp) && req.headers['x-forwarded-for']) {
    return req.headers['x-forwarded-for'].split(',')[0].trim();
  }
  return socketIp;
}

export { TRUSTED_PROXIES, getClientIp };
