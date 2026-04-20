import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const JWT_SECRET_FILE = path.join(process.cwd(), '.jwt_secret');
const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET.trim();
  try {
    if (fs.existsSync(JWT_SECRET_FILE)) return fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
  } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(JWT_SECRET_FILE, secret, 'utf8'); } catch (e) { console.warn('[jwt] Could not persist secret:', e.message); }
  return secret;
})();

const JWT_TTL = '24h';

function verifyJwt(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: 'identity-prism', audience: 'identity-prism-api' });
}

function createJwt(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_TTL, algorithm: 'HS256', issuer: 'identity-prism', audience: 'identity-prism-api' });
}

function createRequireJwt({ walletIpLog, getClientIp, respondJson }) {
  return function requireJwt(req, res) {
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      respondJson(res, 401, { error: 'Missing auth token. Call /api/auth/challenge then /api/auth/token first.' });
      return { ok: false };
    }
    try {
      const payload = verifyJwt(token);
      const clientIp = getClientIp(req);
      if (payload.address && clientIp) {
        const ips = walletIpLog.get(payload.address) || new Set();
        ips.add(clientIp);
        walletIpLog.set(payload.address, ips);
      }
      return { ok: true, address: payload.address };
    } catch {
      respondJson(res, 401, { error: 'Invalid or expired auth token' });
      return { ok: false };
    }
  };
}

function createOptionalJwt() {
  return function optionalJwt(req, res) {
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return { ok: true, address: null };
    }
    try {
      const payload = verifyJwt(token);
      return { ok: true, address: payload.address };
    } catch {
      // Token present but invalid — reject to prevent spoofing
      return { ok: false, address: null };
    }
  };
}

export { JWT_TTL, createJwt, createOptionalJwt, createRequireJwt, verifyJwt };
