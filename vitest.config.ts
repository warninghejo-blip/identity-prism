import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig({ mode: 'test', command: 'serve', isSsrBuild: false, isPreview: false }),
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
      globals: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        include: ['src/**/*.{ts,tsx}', 'server/**/*.{js,ts}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx'],
      },
    },
  }),
);
