const MWA_LOOPBACK_HOST = '127.0.0.1';

type NativeCapacitorWindow = Window & {
  Capacitor?: {
    isNativePlatform?: () => boolean;
  };
};

const shouldPatchMwaLoopback = () => {
  const nativeWindow = window as NativeCapacitorWindow;
  return Boolean(nativeWindow.Capacitor?.isNativePlatform?.()) && /android/i.test(navigator.userAgent);
};

// Polyfill: Android 14 WebView не поддерживает permissions.query({name:'loopback-network'})
// MWA SDK (wallet-standard-mobile) кидает SolanaMobileWalletAdapterError при отказе → блокирует picker
const installLocalNetworkPermissionShim = () => {
  if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) return;
  const perms = navigator.permissions as Permissions & { __identityPrismLnaShim?: boolean };
  if (perms.__identityPrismLnaShim) return;

  const orig = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (async (desc: PermissionDescriptor & { name: string }) => {
    const name = desc?.name;
    if (name === 'loopback-network' || name === 'local-network-access') {
      // Возвращаем granted — WebView имеет доступ к 127.0.0.1 через INTERNET permission
      return {
        state: 'granted',
        name,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as unknown as PermissionStatus;
    }
    try {
      return await orig(desc);
    } catch (e) {
      // Fallback для других неизвестных permission'ов в WebView
      return {
        state: 'granted',
        name,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as unknown as PermissionStatus;
    }
  }) as typeof navigator.permissions.query;

  perms.__identityPrismLnaShim = true;
};

const rewriteMwaWebSocketUrl = (url: string | URL): string | URL => {
  const raw = url.toString();
  if (!raw.startsWith('ws://localhost:') || !raw.endsWith('/solana-wallet')) return url;

  const rewritten = new URL(raw);
  rewritten.hostname = MWA_LOOPBACK_HOST;
  return rewritten.toString();
};

export const installMwaLoopbackPatch = () => {
  if (typeof window === 'undefined' || !shouldPatchMwaLoopback()) return;

  installLocalNetworkPermissionShim();

  const OriginalWebSocket = window.WebSocket;
  if (!OriginalWebSocket || (OriginalWebSocket as typeof WebSocket & { __identityPrismMwaPatch?: boolean }).__identityPrismMwaPatch) {
    return;
  }

  const PatchedWebSocket = function (
    this: WebSocket,
    url: string | URL,
    protocols?: string | string[],
  ) {
    return new OriginalWebSocket(rewriteMwaWebSocketUrl(url), protocols);
  } as unknown as typeof WebSocket & { __identityPrismMwaPatch?: boolean };

  PatchedWebSocket.prototype = OriginalWebSocket.prototype;
  Object.setPrototypeOf(PatchedWebSocket, OriginalWebSocket);
  PatchedWebSocket.__identityPrismMwaPatch = true;
  window.WebSocket = PatchedWebSocket;
};
