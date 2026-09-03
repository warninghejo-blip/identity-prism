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
```

Run the full test suite and production build before opening a pull request. CI uses the locked install and runs those same two acceptance commands.

There is currently no accepted `typecheck` package script. A direct `npx tsc -p tsconfig.app.json --noEmit` reports pre-existing application diagnostics, so typechecking is not presented as a passing CI gate. Do not weaken TypeScript settings to hide them; introduce a `typecheck` script only with a focused cleanup that makes the existing application pass.

To run the backend locally after the root install:

```bash
node server/helius-proxy.js
```

Copy `.env.example` to `.env` and provide local values. Never commit `.env`, credentials, wallet or signing secrets, runtime databases, logs, uploads, build outputs, or local evidence bundles.

## Pull requests

- Keep changes focused and preserve unrelated worktree changes.
- Add or update tests for behavior changes.
- Explain operational or data-migration impact when applicable.
- Do not commit generated `dist/`, Android build outputs, runtime SQLite/WAL/SHM files, logs, uploads, local deployment evidence, or generated presentations/media.
- Report security-sensitive findings through the private process in `SECURITY.md`, not in a public pull request.
