# Public metrics and on-chain inventory

Identity Prism exposes several counts that measure different things. They must not be presented as interchangeable.

## Verified snapshot

Snapshot collected from production and Solana/DAS on 2026-09-03 at 23:37:31 UTC:

| Metric | Count | Definition |
|---|---:|---|
| Recorded mint wallets | 48 | Rows in the production `minted_addresses` presence table. `address` is the primary key, so this is a unique-wallet count, not cumulative mint events. |
| Scanned wallet verdicts | 1,166 | Rows in `sybil_verdicts`, also keyed by wallet address. |
| Canonical collection assets discoverable through DAS | 96 | Metaplex Core assets grouped under `4JAq5D5qYMU5RtRuQj4eotQErWvTMKrMYGK87vtbJqJD`. |
| Live canonical assets | 87 | Canonical assets not marked `burnt` by DAS. |
| Burnt canonical assets | 9 | Canonical assets still discoverable by DAS but marked `burnt`. |
| Current owners of live canonical assets | 41 | Unique owner addresses across the 87 live assets. |
| Authority-visible legacy identity candidates | 2 | Noncanonical `V1_NFT` records named Identity Prism under the canonical collection authority. This is a scoped discovery result, not a guaranteed all-time legacy total. |

The production server does not expose a cumulative mint-event ledger. The 48 recorded wallets therefore cannot be used as a total number of mint transactions. Multiple assets per wallet, transfers, burns, legacy assets, and records created outside the current presence table explain why server, asset, and owner counts differ.

## Canonical addresses

- Identity collection: `4JAq5D5qYMU5RtRuQj4eotQErWvTMKrMYGK87vtbJqJD` (`MplCoreCollection`).
- Current dApp Store app metadata NFT: `AKuwHGvPHVe4E57stGnkd3ciVXs5LeVqBgxUuiDhmV3C`.
- Current dApp Store release metadata NFT: `FZ1T6CvCU1JBH1quoDvkodAkfxqNYbMp9upRVwGbsvvg`.
- Legacy dApp Store app/release metadata NFTs: `7KUb51b8CRYm6vkxFkXFv6ijyiMGi9TQganqDj3LYihB` / `8FhukmBa19nh6KhiNY5BvchhtpVumJyao3S6jZB6ucp9`.

The dApp Store addresses describe store metadata and releases; they are not Identity Prism card mints and are not included in the canonical collection count.

## Product terminology

- The legacy identity score is capped at 400. The five-pillar composite score is capped at 1,000.
- PRISM points are an off-chain application unit, not a currently issued token.
- Game sessions and settlement are server-authoritative. A MagicBlock devnet RPC blockhash can be used as entropy or verification input, but the games do not run on an Ephemeral Rollup.
- A score becomes an on-chain record only when a user separately reviews and signs the supported Memo attestation. Ordinary scans, games, tier changes, and profile badges are not automatically written on-chain.

## Reproduce

Run the read-only verifier from the repository root:

```bash
npm run metrics:verify
```

It reads canonical addresses from tracked configuration, calls the public production stats endpoint, queries DAS and Solana account state through the production read-only RPC proxy, and prints definitions plus current counts. It does not read `.env` files or require API keys. Counts are live and may change after this snapshot.
