# Legacy publishing snapshot

This directory preserves the earlier `com.identityprism.app` Solana dApp Store publishing lineage for historical reference. Its app and release addresses, APK manifest, version, and certificate metadata must not be reused for the current Android package.

The current canonical Android metadata is maintained in:

- `android/app/build.gradle` — package ID, version code, and version name.
- `dapp-store/config.yaml` — current Solana dApp Store package and release metadata.
- `public/.well-known/assetlinks.json` — package-to-signing-certificate association.

Current install artifacts use `com.identityprism2.app`. Generate a fresh store asset manifest from the signed APK in `dapp-store/files/app-release.apk`; do not copy hashes or upload URIs from this legacy directory.
