const APP_HOST_PATTERN = /(^|\.)identityprism\.xyz$/i;

const normalizeRoute = (path: string) => {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

export function resolveNativeAppPath(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);

    if (url.protocol === 'identityprism:') {
      const host = url.hostname.trim();
      const route =
        host && host !== 'app'
          ? normalizeRoute(host)
          : normalizeRoute(url.pathname || '/');

      return `${route}${url.search}${url.hash}`;
    }

    if ((url.protocol === 'https:' || url.protocol === 'http:') && APP_HOST_PATTERN.test(url.hostname)) {
      return `${normalizeRoute(url.pathname || '/')}${url.search}${url.hash}`;
    }
  } catch {
    return null;
  }

  return null;
}
