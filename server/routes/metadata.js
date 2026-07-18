import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Public NFT metadata is created with crypto.randomUUID(). The second branch
// preserves the filename emitted by the historical Date.now()/Math.random()
// fallback, so existing metadata URIs remain reachable on older deployments.
const PUBLIC_NFT_METADATA_FILE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{13}-[0-9a-f]+)\.json$/i;

function registerMetadataRoute(ctx) {
  const {
    requireJwt,
    optionalJwt,
    readBody,
    respondJson,
    ipRateLimit,
    getClientIp,
    getBaseUrl,
    resolveAssetFile,
    resolveMetadataFile,
    getContentType,
    assetsDir,
    metadataDir,
  } = ctx;

  return async function handleMetadataRoute(req, res, url, pathname) {
    const isAssetUpload =
      pathname === '/assets' ||
      pathname === '/assets/' ||
      pathname === '/metadata/assets' ||
      pathname === '/metadata/assets/';
    if (isAssetUpload) {
      if (req.method !== 'POST') {
        respondJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;
      try {
        const body = await readBody(req);
        let payload = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch (error) {
          console.error('[assets] invalid json', {
            error: error instanceof Error ? error.message : String(error),
            bodyPreview: body.slice(0, 200),
          });
          respondJson(res, 400, { error: 'Invalid JSON payload' });
          return true;
        }
        const imageValue = payload?.image ?? payload?.dataUrl ?? payload?.imageBase64 ?? '';
        if (!imageValue || typeof imageValue !== 'string') {
          respondJson(res, 400, { error: 'Missing image payload' });
          return true;
        }
        let base64 = imageValue.trim();
        let contentType = typeof payload?.contentType === 'string' ? payload.contentType : '';
        const dataMatch = base64.match(/^data:([^;]+);base64,(.+)$/);
        if (dataMatch) {
          contentType = dataMatch[1];
          base64 = dataMatch[2];
        }
        if (!base64) {
          respondJson(res, 400, { error: 'Invalid image payload' });
          return true;
        }
        let extension = 'png';
        if (contentType.includes('jpeg') || contentType.includes('jpg')) {
          extension = 'jpg';
        } else if (contentType.includes('webp')) {
          extension = 'webp';
        } else if (contentType.includes('gif')) {
          extension = 'gif';
        }
        const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const fileName = resolveAssetFile(`${id}.${extension}`);
        if (!fileName) {
          respondJson(res, 500, { error: 'Failed to create asset file' });
          return true;
        }
        const filePath = path.join(assetsDir, fileName);
        await fs.promises.writeFile(filePath, Buffer.from(base64, 'base64'));
        const baseUrl = getBaseUrl(req);
        if (!baseUrl) {
          respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
          return true;
        }
        respondJson(res, 200, { url: `${baseUrl}/metadata/assets/${fileName}` });
      } catch (error) {
        console.error('[assets] upload failed', error);
        respondJson(res, 500, { error: 'Asset upload failed' });
      }
      return true;
    }

    const isAssetFetch = pathname.startsWith('/assets/') || pathname.startsWith('/metadata/assets/');
    if (isAssetFetch) {
      if (req.method !== 'GET') {
        respondJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const parts = pathname.split('/').filter(Boolean);
      const rawName = parts[parts.length - 1] ?? '';
      const fileName = resolveAssetFile(rawName);
      if (!fileName) {
        respondJson(res, 404, { error: 'Asset not found' });
        return true;
      }
      const filePath = path.join(assetsDir, fileName);
      if (!fs.existsSync(filePath)) {
        respondJson(res, 404, { error: 'Asset not found' });
        return true;
      }
      res.writeHead(200, { 'Content-Type': getContentType(fileName) });
      res.end(fs.readFileSync(filePath));
      return true;
    }

    if (pathname.startsWith('/metadata')) {
      if (req.method === 'POST' && (pathname === '/metadata' || pathname === '/metadata/')) {
        if (!ipRateLimit('metadata_post', getClientIp(req), 10, 60000)) return respondJson(res, 429, { error: 'Too many requests' });
        const hasAuthHeader = typeof req.headers['authorization'] === 'string' && req.headers['authorization'].startsWith('Bearer ');
        const jwtAuth = optionalJwt ? optionalJwt(req, res) : hasAuthHeader ? requireJwt(req, res) : { ok: true, address: null };
        if (!jwtAuth.ok) {
          respondJson(res, 401, { error: 'Invalid or expired auth token' });
          return true;
        }
        try {
          const body = await readBody(req);
          let payload = {};
          try {
            payload = body ? JSON.parse(body) : {};
          } catch (error) {
            console.error('[metadata] invalid json', {
              error: error instanceof Error ? error.message : String(error),
              bodyPreview: body.slice(0, 200),
            });
            respondJson(res, 400, { error: 'Invalid JSON payload' });
            return true;
          }
          const wrappedMetadata = payload?.metadata;
          const metadata =
            wrappedMetadata && typeof wrappedMetadata === 'object'
              ? wrappedMetadata
              : payload && typeof payload === 'object'
                ? payload
                : null;
          if (!metadata || Array.isArray(metadata)) {
            respondJson(res, 400, { error: 'Missing metadata payload' });
            return true;
          }

          const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const fileName = resolveMetadataFile(id);
          if (!fileName) {
            respondJson(res, 500, { error: 'Failed to create metadata file' });
            return true;
          }
          const filePath = path.join(metadataDir, fileName);
          await fs.promises.writeFile(filePath, JSON.stringify(metadata, null, 2));
          const baseUrl = getBaseUrl(req);
          if (!baseUrl) {
            respondJson(res, 500, { error: 'PUBLIC_BASE_URL is not configured' });
            return true;
          }
          respondJson(res, 200, { uri: `${baseUrl}/metadata/${fileName}` });
        } catch (error) {
          console.error('[metadata] write failed', error);
          respondJson(res, 500, { error: 'Metadata write failed' });
        }
        return true;
      }

      if (req.method === 'GET') {
        const parts = pathname.split('/').filter(Boolean);
        const rawName = parts[1] ?? '';
        const fileName = resolveMetadataFile(rawName);
        if (parts.length !== 2 || !fileName || !PUBLIC_NFT_METADATA_FILE.test(fileName)) {
          respondJson(res, 404, { error: 'Metadata not found' });
          return true;
        }
        const filePath = path.join(metadataDir, fileName);
        if (!fs.existsSync(filePath)) {
          respondJson(res, 404, { error: 'Metadata not found' });
          return true;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(fs.readFileSync(filePath, 'utf-8'));
        return true;
      }

      respondJson(res, 405, { error: 'Method not allowed' });
      return true;
    }

    return false;
  };
}

export { registerMetadataRoute };
