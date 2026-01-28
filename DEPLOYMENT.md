# 🚀 Deployment & Integration Guide: Identity Prism

This guide explains how to prepare and transport the Identity Prism module into a production Solana dApp or deploy it as a standalone application.

## 1. 🏗️ Build for Production

To create an optimized production build:

```bash
npm run build
```

This will generate a `dist` folder containing:
- `index.html` (Entry point)
- `assets/` (Compiled JS and CSS)
- `textures/` (Copied from public/textures)

### Preview Locally
Before deploying, verify the build works locally:
```bash
npm run preview
```

---

## 2. 📦 Transporting to Another Solana dApp

If you are moving this code into an existing Solana project (e.g., Next.js or another Vite app), follow these steps:

### A. Dependencies
Ensure the target project has these packages installed:
```json
"dependencies": {
  "@react-three/fiber": "^8.18.0",
  "@react-three/drei": "^9.122.0",
  "three": "^0.160.1",
  "framer-motion": "^12.0.0",
  "lucide-react": "^0.462.0",
  "@solana/wallet-adapter-react": "^0.15.35",
  "clsx": "^2.1.1",
  "tailwind-merge": "^2.6.0"
}
```

### B. File Migration
Copy the following folders to your target project:

1. **Components**: `src/components/` -> `your-app/src/components/`
   - *Crucial files:* `CelestialCard.tsx`, `Planet3D.tsx`, `StarField.tsx`
2. **Hooks**: `src/hooks/` -> `your-app/src/hooks/`
   - *Crucial file:* `useWalletData.ts`
3. **Utils**: `src/utils/` -> `your-app/src/utils/`
4. **Assets**: `public/textures/` -> `your-app/public/textures/`
   - *Note:* Ensure the path `/textures/...` remains accessible from the root.

### C. Environment Variables
You must set the Helius API key in your destination project's `.env` file:

**Vite:**
```env
VITE_HELIUS_API_KEY=your_api_key_here
```

**Next.js:**
```env
NEXT_PUBLIC_HELIUS_API_KEY=your_api_key_here
```
*Note: If using Next.js, update `src/constants.ts` to use `process.env.NEXT_PUBLIC_HELIUS_API_KEY` instead of `import.meta.env`.*

---

## 3. 🚢 Standalone Deployment

### Vercel / Netlify
1. Push this repository to GitHub.
2. Import project into Vercel/Netlify.
3. Set the **Build Command**: `npm run build`
4. Set the **Output Directory**: `dist`
5. **Important:** Add `VITE_HELIUS_API_KEY` in the project settings (Environment Variables).

### Solana Hosting (Shdw Drive / IPFS)
For decentralized hosting:
1. Run `npm run build`.
2. Upload the contents of the `dist` folder to Shdw Drive or IPFS.
3. Ensure relative paths are handled correctly (you may need to set `base: './'` in `vite.config.ts` if not serving from domain root).

---

## 4. 🎨 Customization Checklist

- **Saturn Rings**: Updated to use volumetric Torus geometry in `Planet3D.tsx`.
- **Sun Shaders**: Custom shaders for pulsing magma effect are in `Planet3D.tsx`.
- **Card Flip**: Controlled via `isFlipped` state in `CelestialCard.tsx`.
- **Badges**: Definitions are in `CelestialCard.tsx` (function `getBadgeItems`).

---

## 5. ⚠️ Troubleshooting

- **Textures not loading?** Check that the `public/textures` folder was copied correctly and that your web server serves static files from the root.
- **Wallet not connecting?** Ensure `WalletProvider` is wrapping your application (see `src/main.tsx`).
- **3D Performance?** The `Planet3D` component uses high-quality shaders. For mobile optimization, consider reducing `pixelRatio` in the `Canvas` component in `CelestialCard.tsx`.
