# Contributing

## Local setup

Use Node.js 22 and npm. The root `package.json` and `package-lock.json` are the canonical dependency manifests for the frontend, backend tests, local server, and CI.

```bash
npm ci
```

Do not run an independent install in `server/`. The file `server/server-package.json` is retained only as legacy deployment metadata and is not an npm install manifest.

## Development and checks

```bash
npm run dev
npm test
npm run build
npm run test:seo
```

Run the full test suite, production build, and SEO regression checks before opening a pull request. CI uses the locked install and runs those same three acceptance commands; `npm run test:seo` consumes the generated `dist/` output and therefore runs after the build.

There is currently no accepted `typecheck` package script. The default `npx tsc --noEmit` follows the root TypeScript project and is not the authoritative application check. The authoritative app command is `npx tsc -p tsconfig.app.json --noEmit`; it currently reports pre-existing application diagnostics and is not a passing CI gate. A successful default invocation must not be described as a green app typecheck. Do not weaken TypeScript settings to hide diagnostics; introduce a `typecheck` script only with a focused cleanup that makes the authoritative application check pass.

To run the backend locally after the root install:

```bash
node server/helius-proxy.js
```

Run that command from the repository root. Copy `.env.example` to the root `.env` and use `.env.example` as the authoritative inventory of environment variables and runtime paths. Never commit `.env`, credentials, wallet or signing secrets, runtime databases, logs, uploads, build outputs, or local evidence bundles.

## Pull requests

- Keep changes focused and preserve unrelated worktree changes.
- Add or update tests for behavior changes.
- Explain operational or data-migration impact when applicable.
- Do not commit generated `dist/`, Android build outputs, runtime SQLite/WAL/SHM files, logs, uploads, local deployment evidence, or generated presentations/media.
- Report security-sensitive findings through the private process in `SECURITY.md`, not in a public pull request.
