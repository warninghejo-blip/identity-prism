/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HELIUS_API_KEY?: string;
  readonly VITE_HELIUS_API_KEYS?: string;
  readonly VITE_HELIUS_PROXY_URL?: string;
  readonly VITE_METADATA_BASE_URL?: string;
  readonly VITE_METADATA_IMAGE_URL?: string;
  readonly VITE_APP_BASE_URL?: string;
  readonly VITE_COLLECTION_MINT?: string;
  readonly VITE_UPDATE_AUTHORITY?: string;
  readonly VITE_COLLECTION_VERIFY_URL?: string;
  readonly VITE_CNFT_MINT_URL?: string;
  readonly VITE_TAPESTRY_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'gif.js' {
  const GIF: new (options?: Record<string, unknown>) => {
    addFrame: (image: CanvasImageSource, options?: { delay?: number }) => void;
    on: (event: 'finished' | 'abort', handler: (value: any) => void) => void;
    render: () => void;
  };
  export default GIF;
}

declare module 'gif.js/dist/gif.worker.js?url' {
  const url: string;
  export default url;
}
