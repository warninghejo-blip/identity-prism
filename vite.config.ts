import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
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
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-three': ['three', '@react-three/fiber', '@react-three/drei', '@react-three/postprocessing', 'postprocessing'],
          'vendor-wallet': [
            '@solana/wallet-adapter-react',
            '@solana/wallet-adapter-react-ui',
            '@solana/wallet-adapter-wallets',
            '@solana/wallet-adapter-base',
            '@solana-mobile/wallet-adapter-mobile',
          ],
          'vendor-solana': ['@solana/web3.js', '@solana/spl-token'],
          'vendor-metaplex': [
            '@metaplex-foundation/umi',
            '@metaplex-foundation/umi-bundle-defaults',
            '@metaplex-foundation/mpl-bubblegum',
            '@metaplex-foundation/mpl-token-metadata',
          ],
          'vendor-ui': [
            '@radix-ui/react-tabs',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-dialog',
            '@radix-ui/react-toast',
            '@radix-ui/react-select',
            '@radix-ui/react-popover',
            'framer-motion',
            'lucide-react',
          ],
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
}));
