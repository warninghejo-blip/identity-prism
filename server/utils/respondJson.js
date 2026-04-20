import zlib from 'node:zlib';

const respondJson = (res, status, payload) => {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  const acceptEncoding = String(res.req?.headers?.['accept-encoding'] ?? '');
  if (body.length > 256 && acceptEncoding.includes('gzip')) {
    zlib.gzip(Buffer.from(body), (err, compressed) => {
      if (res.headersSent) return;
      if (err || !compressed) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': compressed.length,
      });
      res.end(compressed);
    });
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
};

export { respondJson };
