const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB hard limit

const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      req.destroy();
      reject(new Error('Request body too large'));
      return;
    }
    data += chunk;
  });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

export { MAX_BODY_SIZE, readBody };
