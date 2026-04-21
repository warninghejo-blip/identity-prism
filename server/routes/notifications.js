function registerNotificationsRoute(ctx) {
  const {
    core: {
      ipRateLimit,
      getClientIp,
      respondJson,
      requireJwt,
      readBody,
      normalizePubkey,
    },
    notificationsDb,
    saveNotificationsDebounced,
  } = ctx;

  return async function handleNotificationsRoute(req, res, url, pathname) {
    if (pathname === '/api/notifications' && req.method === 'GET') {
      if (!ipRateLimit('notifs_get', getClientIp(req), 30, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      const address = jwtAuth.address;
      const notifications = notificationsDb.get(address) || [];
      const unreadCount = notifications.filter((notification) => !notification.read).length;
      respondJson(res, 200, { notifications, unreadCount });
      return true;
    }

    if (pathname === '/api/notifications/read' && req.method === 'POST') {
      if (!ipRateLimit('notifs_post', getClientIp(req), 15, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      try {
        const address = jwtAuth.address;
        const { ids, all } = JSON.parse(await readBody(req));
        const notifications = notificationsDb.get(address) || [];
        if (all) {
          notifications.forEach((notification) => {
            notification.read = true;
          });
        } else if (Array.isArray(ids)) {
          const idSet = new Set(ids);
          notifications.forEach((notification) => {
            if (idSet.has(notification.id)) notification.read = true;
          });
        }
        notificationsDb.set(address, notifications);
        saveNotificationsDebounced();
        respondJson(res, 200, { ok: true });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    if (pathname === '/api/notifications/delete' && req.method === 'POST') {
      if (!ipRateLimit('notifs_post', getClientIp(req), 15, 60000)) {
        respondJson(res, 429, { error: 'Too many requests' });
        return true;
      }
      const jwtAuth = requireJwt(req, res);
      if (!jwtAuth.ok) return true;

      try {
        const address = jwtAuth.address;
        const { ids, all } = JSON.parse(await readBody(req));
        if (all) {
          notificationsDb.set(address, []);
        } else if (Array.isArray(ids)) {
          const idSet = new Set(ids);
          const notifications = (notificationsDb.get(address) || []).filter((notification) => !idSet.has(notification.id));
          notificationsDb.set(address, notifications);
        }
        saveNotificationsDebounced();
        respondJson(res, 200, { ok: true });
      } catch {
        respondJson(res, 400, { error: 'Invalid request body' });
      }
      return true;
    }

    if (pathname === '/api/notifications/unread-count' && req.method === 'GET') {
      const address = normalizePubkey(url.searchParams.get('address'));
      if (!address) {
        respondJson(res, 400, { error: 'address required' });
        return true;
      }
      const notifications = notificationsDb.get(address) || [];
      respondJson(res, 200, { count: notifications.filter((notification) => !notification.read).length });
      return true;
    }

    return false;
  };
}

export { registerNotificationsRoute };
