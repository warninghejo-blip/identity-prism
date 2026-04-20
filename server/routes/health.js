function registerHealthRoute() {
  return async function handleHealthRoute(req, res) {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    return false;
  };
}

export { registerHealthRoute };
