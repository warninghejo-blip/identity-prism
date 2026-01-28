import { createDefaultAuthorizationResultCache } from '@solana-mobile/wallet-adapter-mobile';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

type MwaAccount = {
  address?: string;
  publicKey?: Uint8Array | Record<string, number> | string;
};

type MwaAuthorization = {
  accounts?: MwaAccount[];
};

const baseCache = createDefaultAuthorizationResultCache();
let lastAuthorization: MwaAuthorization | undefined;

export const mwaAuthorizationCache = {
  async clear() {
    lastAuthorization = undefined;
    await baseCache.clear();
  },
  async get() {
    const cached = (await baseCache.get()) as MwaAuthorization | undefined;
    return cached ?? lastAuthorization;
  },
  async set(authorization: MwaAuthorization) {
    lastAuthorization = authorization;
    await baseCache.set(authorization as any);
  },
};

const decodeBase64ToPublicKey = (value?: string) => {
  if (!value) return undefined;
  try {
    return new PublicKey(Buffer.from(value, 'base64')).toBase58();
  } catch {
    try {
      const binary = globalThis.atob?.(value);
      if (!binary) return undefined;
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new PublicKey(bytes).toBase58();
    } catch {
      return undefined;
    }
  }
};

const decodeStringToPublicKey = (value?: string) => {
  if (!value) return undefined;
  try {
    return new PublicKey(value).toBase58();
  } catch {
    return decodeBase64ToPublicKey(value);
  }
};

const decodeBytesToPublicKey = (value?: Uint8Array | Record<string, number>) => {
  if (!value) return undefined;
  try {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(Object.values(value));
    return new PublicKey(bytes).toBase58();
  } catch {
    return undefined;
  }
};

export const extractMwaAddress = (authorization?: MwaAuthorization) => {
  const account = authorization?.accounts?.[0];
  if (!account) return undefined;
  return (
    decodeStringToPublicKey(account.address) ||
    decodeBytesToPublicKey(typeof account.publicKey === 'string' ? undefined : account.publicKey) ||
    decodeStringToPublicKey(typeof account.publicKey === 'string' ? account.publicKey : undefined)
  );
};
