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

const rewriteMwaWebSocketUrl = (url: string | URL): string | URL => {
  const raw = url.toString();
  if (!raw.startsWith('ws://localhost:') || !raw.endsWith('/solana-wallet')) return url;

  const rewritten = new URL(raw);
  rewritten.hostname = MWA_LOOPBACK_HOST;
  return rewritten.toString();
};

export const installMwaLoopbackPatch = () => {
  if (typeof window === 'undefined' || !shouldPatchMwaLoopback()) return;

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
