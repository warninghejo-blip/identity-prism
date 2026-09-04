# Deployment Guide

Identity Prism is deployed as two cooperating services:

- a Vite-built static web application from `dist/`;
- a separate long-running Node.js service started from the repository root with `node server/helius-proxy.js`.

The static host does not replace the Node service. Route API requests to the Node service through the production reverse proxy while serving the Vite artifacts as static files.

## Prerequisites and configuration

Use Node.js 22 and the root npm manifests. Install from the repository root:

```bash
npm ci
```

Copy the root `.env.example` to `.env` and supply environment-specific values outside version control. `.env.example` is the authoritative inventory of backend environment variables and runtime paths for local and production operation.

Service credentials, including RPC credentials, belong in the server environment. Do not expose a Helius key or another secret through a browser-prefixed `VITE_*` variable, and never commit `.env`.

## Build and verify the web application

From the repository root:

```bash
npm test
npm run build
npm run test:seo
```

`npm run build` compiles the Vite application and prerenders the configured SEO routes into `dist/`. `npm run test:seo` validates that generated output, so it must run after the build.

For a local inspection of the generated site, run:

```bash
npm run preview
```

The preview server is a local verification aid, not the production backend.

## Run the Node service

Start the backend from the repository root so the paths and environment described by `.env.example` resolve consistently:

```bash
node server/helius-proxy.js
```

In production, supervise this command with the platform's process manager. Keep secrets in the service environment, apply the platform's log-retention policy, and terminate TLS and forward API traffic through the chosen reverse proxy. The repository does not require a particular host name, IP address, or provider.

## Publish static artifacts

Publish the contents of `dist/` to a static host or CDN that serves the application from the configured domain root. Preserve the repository's redirect and route configuration, and forward backend API requests to the separately running Node service.

Do not publish source files, `.env`, runtime databases, uploads, logs, evidence bundles, or Android signing material with `dist/`.

## Solana dApp Store submission

The tracked source of submission metadata is `dapp-store/config.yaml` plus its referenced media and APK. The Solana dApp Store CLI generates `dapp-store/.asset-manifest.json` only as part of publisher portal submission. Do not create or edit that manifest manually, and do not treat a local generated manifest as proof of portal or on-chain state.
