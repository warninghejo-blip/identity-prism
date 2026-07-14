import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const JWT_SECRET_FILE = process.env.JWT_SECRET_FILE
  || path.join(os.homedir(), '.identity-prism', 'jwt_secret');
const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET.trim();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET env var is required in production');
  }
  console.warn('[SECURITY WARNING] JWT_SECRET env var not set — using auto-generated file fallback. Set JWT_SECRET for production!');
  try {
    if (fs.existsSync(JWT_SECRET_FILE)) return fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
  } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(JWT_SECRET_FILE), { recursive: true });
    fs.writeFileSync(JWT_SECRET_FILE, secret, { mode: 0o600 });
  } catch (e) { console.warn('[jwt] Could not persist secret:', e.message); }
  return secret;
})();

const JWT_TTL = process.env.JWT_TTL || '6h';

function verifyJwt(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: 'identity-prism', audience: 'identity-prism-api' });
}

function createJwt(payload, walletDatabase) {
  const tokenVersion = walletDatabase?.get(payload.address)?.tokenVersion || 0;
  return jwt.sign({ ...payload, tokenVersion }, JWT_SECRET, { expiresIn: JWT_TTL, algorithm: 'HS256', issuer: 'identity-prism', audience: 'identity-prism-api' });
}

function signGameSessionToken(payload, expiresInSeconds) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: expiresInSeconds,
    algorithm: 'HS256',
    issuer: 'identity-prism',
    audience: 'identity-prism-game-session',
  });
}

function verifyGameSessionTokenSignature(token) {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'identity-prism',
    audience: 'identity-prism-game-session',
  });
}

function createRequireJwt({ walletIpLog, getClientIp, respondJson, walletDatabase }) {
  return function requireJwt(req, res) {
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      respondJson(res, 401, { error: 'Missing auth token. Call /api/auth/challenge then /api/auth/token first.' });
      return { ok: false };
    }
    try {
      const payload = verifyJwt(token);
      // Token version check — allows invalidation by incrementing tokenVersion in walletDatabase
      if (payload.tokenVersion !== undefined) {
        const entry = walletDatabase?.get(payload.address);
        const currentVersion = entry?.tokenVersion || 0;
        if (payload.tokenVersion !== currentVersion) {
          respondJson(res, 401, { error: 'Token revoked' });
          return { ok: false };
        }
      }
      const clientIp = getClientIp(req);
      if (payload.address && clientIp) {
        // Option B: cap per-address IP list at 50 (array, oldest shifted out)
        const entry = walletIpLog.get(payload.address) || { ips: [], lastSeen: 0 };
        if (!entry.ips.includes(clientIp)) {
          entry.ips.push(clientIp);
          if (entry.ips.length > 50) entry.ips.shift();
        }
        entry.lastSeen = Date.now();
        walletIpLog.set(payload.address, entry);
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

function createAuthServices(ctx) {
  const boundCreateJwt = (payload) => createJwt(payload, ctx.walletDatabase);
  return {
    createJwt: boundCreateJwt,
    verifyJwt,
    requireJwt: createRequireJwt(ctx),
    optionalJwt: createOptionalJwt(ctx),
  };
}

export {
  JWT_TTL,
  createAuthServices,
  createJwt,
  createOptionalJwt,
  createRequireJwt,
  signGameSessionToken,
  verifyGameSessionTokenSignature,
  verifyJwt,
};
