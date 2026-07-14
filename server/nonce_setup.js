// One-time durable-nonce setup for the PrismGuard payment flow.
// Run on server 188 from /opt/identityprism/helius-proxy with the service .env sourced:
//   set -a && . ./.env && set +a && node nonce_setup.js status   # shows the authority address to fund
//   ... owner sends ~0.005 SOL to that address ...
//   set -a && . ./.env && set +a && node nonce_setup.js create   # creates the nonce account
//
// Uses a DEDICATED nonce-authority keypair (keys/nonce_authority.json) — NOT the VPN treasury and
// NOT any identity-prism key. This authority only advances/owns the nonce account; it has zero
// access to user funds or the treasury (D1mzmpBP…). The nonce account keypair is keys/nonce_account.json.
import fs from 'node:fs';
import {
  Keypair, Connection, SystemProgram, Transaction, NONCE_ACCOUNT_LENGTH,
} from '@solana/web3.js';

const DIR = '/opt/identityprism/helius-proxy/keys';
const AUTH_PATH = `${DIR}/nonce_authority.json`;
const NONCE_PATH = `${DIR}/nonce_account.json`;

function rpcUrl() {
  const base = (process.env.HELIUS_RPC_BASE || 'https://mainnet.helius-rpc.com/').trim();
  const key = (process.env.HELIUS_API_KEYS || '').split(',')[0].trim();
  const u = new URL(base);
  if (key) u.searchParams.set('api-key', key);
  return u.toString();
}
const conn = new Connection(rpcUrl(), 'confirmed');

function loadOrCreate(path) {
  if (fs.existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path))));
  const kp = Keypair.generate();
  fs.writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

const cmd = process.argv[2] || 'status';
const authority = loadOrCreate(AUTH_PATH); // dedicated nonce authority (generated on first run)

if (cmd === 'status') {
  const bal = await conn.getBalance(authority.publicKey);
  console.log('NONCE AUTHORITY (fund this):', authority.publicKey.toBase58(), '=>', bal / 1e9, 'SOL');
  const rent = await conn.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
  console.log('rent needed for nonce account:', rent / 1e9, 'SOL (send ~0.005 to be safe)');
  if (fs.existsSync(NONCE_PATH)) {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(NONCE_PATH))));
    console.log('nonce account:', kp.publicKey.toBase58(), (await conn.getAccountInfo(kp.publicKey)) ? 'EXISTS' : 'NOT created yet');
  } else {
    console.log('nonce account: not created yet');
  }
} else if (cmd === 'create') {
  let nonceKp;
  if (fs.existsSync(NONCE_PATH)) {
    nonceKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(NONCE_PATH))));
    if (await conn.getAccountInfo(nonceKp.publicKey)) { console.log('ALREADY_EXISTS', nonceKp.publicKey.toBase58()); process.exit(0); }
  } else {
    nonceKp = Keypair.generate();
  }
  const rent = await conn.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
  const bal = await conn.getBalance(authority.publicKey);
  console.log('authority', authority.publicKey.toBase58(), 'SOL', bal / 1e9, 'rent', rent / 1e9);
  if (bal < rent + 20000) { console.error('INSUFFICIENT_FUNDS — send ~0.005 SOL to', authority.publicKey.toBase58()); process.exit(1); }
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction();
  tx.add(SystemProgram.createNonceAccount({ fromPubkey: authority.publicKey, noncePubkey: nonceKp.publicKey, authorizedPubkey: authority.publicKey, lamports: rent }));
  tx.recentBlockhash = blockhash;
  tx.feePayer = authority.publicKey;
  tx.sign(authority, nonceKp);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction(sig, 'confirmed');
  fs.writeFileSync(NONCE_PATH, JSON.stringify(Array.from(nonceKp.secretKey)));
  console.log('NONCE_CREATED', nonceKp.publicKey.toBase58(), 'sig', sig);
} else {
  console.error('usage: node nonce_setup.js [status|create]');
  process.exit(2);
}
