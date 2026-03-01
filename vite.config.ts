import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const prodApiTarget =
  process.env.VITE_HELIUS_PROXY_URL ||
  process.env.VITE_APP_BASE_URL ||
  "https://identityprism.xyz";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const localApiTarget = process.env.VITE_LOCAL_API_TARGET || "http://localhost:3000";

  // In dev: /api and /metadata go to local server; /rpc goes to prod (needs Helius API key)
  // In prod: everything goes to the prod target
  const apiProxyTarget = mode === "development" ? localApiTarget : prodApiTarget;
  const rpcProxyTarget = mode === "development"
    ? (process.env.VITE_LOCAL_RPC_TARGET || prodApiTarget)
    : prodApiTarget;

  return {
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/rpc": {
        target: rpcProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/helius-proxy": {
        target: rpcProxyTarget,
        changeOrigin: true,
        secure: false,
      },
      "/metadata": {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  plugins: [
    react(),
    nodePolyfills({
      protocolImports: true,
      include: ['buffer', 'crypto', 'stream', 'util'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    mode === "development" && componentTagger()
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      buffer: "buffer",
    },
  },
  build: {
    modulePreload: { polyfill: true },
    cssCodeSplit: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // React core — tiny critical-path chunk (~150KB), loaded by bootstrapper
            if (/\/react\/|\/react-dom\/|\/scheduler\/|\/buffer\//.test(id)) return 'vendor-react';
            if (/three|@react-three|postprocessing|framer-motion/.test(id)) return 'vendor-three';
            if (/@metaplex-foundation/.test(id)) return; // stays with lazy mintIdentityPrism
            if (/@solana|@solana-mobile|bn\.js|borsh|bs58|buffer-layout|superstruct/.test(id)) return 'vendor-solana';
            if (/@radix-ui|lucide-react|@tanstack/.test(id)) return 'vendor-ui';
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ["buffer"],
  },
  define: {
    global: "globalThis",
  },
};
});
