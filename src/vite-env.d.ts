/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HELIUS_API_KEY?: string;
  readonly VITE_HELIUS_API_KEYS?: string;
  readonly VITE_HELIUS_PROXY_URL?: string;
  readonly VITE_METADATA_BASE_URL?: string;
  readonly VITE_METADATA_IMAGE_URL?: string;
  readonly VITE_APP_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
