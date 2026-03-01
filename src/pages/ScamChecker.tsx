/**
 * Scam Checker — check any contract/wallet for scam flags + Dark Pool Warning.
 * Mobile-first layout with touch-friendly inputs.
 */

import { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { ArrowLeft, Search, Shield, ShieldAlert, ShieldCheck, AlertTriangle, CheckCircle, Loader2, ExternalLink, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getHeliusProxyUrl } from '@/constants';

interface ScamCheckResult {
  address: string;
  isKnownScam: boolean;
  isExecutable: boolean;
  programInfo: { executable: boolean; owner: string; lamports: number; dataSize: number } | null;
  verdict: string;
}

interface DarkPoolResult {
  address: string;
  scamInteractions: { program?: string; address?: string; signature: string; blockTime: string | null }[];
  scamCount: number;
  totalProgramsUsed: number;
  riskLevel: 'clean' | 'medium' | 'high' | 'unknown';
}

function getApiBase(): string {
  const proxy = getHeliusProxyUrl();
  if (proxy) return proxy;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export default function ScamChecker() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { publicKey } = useWallet();

  const [mode, setMode] = useState<'contract' | 'wallet'>('contract');
  const [input, setInput] = useState(searchParams.get('address') || '');
  const [loading, setLoading] = useState(false);
  const [contractResult, setContractResult] = useState<ScamCheckResult | null>(null);
  const [darkPoolResult, setDarkPoolResult] = useState<DarkPoolResult | null>(null);
  const [error, setError] = useState('');

  const handleCheck = useCallback(async () => {
    const addr = input.trim();
    if (!addr || addr.length < 32) {
      setError('Enter a valid Solana address (32+ characters)');
      return;
    }
    setLoading(true);
    setError('');
    setContractResult(null);
    setDarkPoolResult(null);

    const base = getApiBase();

    try {
      if (mode === 'contract') {
        const res = await fetch(`${base}/api/scam-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr }),
        });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data: ScamCheckResult = await res.json();
        setContractResult(data);
      } else {
        const res = await fetch(`${base}/api/sybil/dark-pool?address=${addr}`);
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data: DarkPoolResult = await res.json();
        setDarkPoolResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check failed');
    } finally {
      setLoading(false);
    }
  }, [input, mode]);

  const handleCheckMyWallet = useCallback(() => {
    if (publicKey) {
      setInput(publicKey.toBase58());
      setMode('wallet');
    } else {
      toast.error('Connect wallet first');
    }
  }, [publicKey]);

  const copyAddress = (addr: string) => {
    navigator.clipboard?.writeText(addr).then(() => toast.success('Copied!')).catch(() => {});
  };

  const riskColor = (level: string) => {
    switch (level) {
      case 'clean': return '#22c55e';
      case 'medium': return '#f59e0b';
      case 'high': return '#ef4444';
      default: return '#6b7280';
    }
  };

  return (
    <div className="min-h-screen bg-[#050510] text-white pb-safe">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#050510]/80 border-b border-white/5">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-white/50 hover:text-white text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="text-sm font-bold">🛡️ Scam Checker</h1>
          <div className="w-12" />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5">
        {/* Mode toggle */}
        <div className="flex gap-1 mb-5 bg-white/5 rounded-xl p-1">
          <button
            onClick={() => { setMode('contract'); setContractResult(null); setDarkPoolResult(null); setError(''); }}
            className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${mode === 'contract' ? 'bg-white/10 text-white' : 'text-white/30'}`}
          >
            🔍 Check Contract
          </button>
          <button
            onClick={() => { setMode('wallet'); setContractResult(null); setDarkPoolResult(null); setError(''); }}
            className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${mode === 'wallet' ? 'bg-white/10 text-white' : 'text-white/30'}`}
          >
            🛡️ Scan Wallet
          </button>
        </div>

        {/* Description */}
        <p className="text-white/30 text-xs mb-4 leading-relaxed">
          {mode === 'contract'
            ? 'Paste any Solana program/contract address to check if it\'s flagged as a scam, verify it\'s executable, and see account details.'
            : 'Scan any wallet to check if it has interacted with known scam contracts or suspicious addresses (Dark Pool Warning).'}
        </p>

        {/* Input */}
        <div className="flex flex-col gap-3 mb-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
              placeholder={mode === 'contract' ? 'Paste contract address...' : 'Paste wallet address...'}
              className="w-full pl-10 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/20 focus:outline-none focus:border-red-500/50 font-mono"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCheck} disabled={loading} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold h-12">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
              {loading ? 'Checking...' : 'Check'}
            </Button>
            {mode === 'wallet' && (
              <Button onClick={handleCheckMyWallet} variant="outline" className="border-white/10 text-white/50 h-12 px-4">
                My Wallet
              </Button>
            )}
          </div>
        </div>

        {error && <p className="text-red-400 text-sm text-center mb-4">{error}</p>}

        {/* Contract result */}
        {contractResult && (
          <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: contractResult.isKnownScam ? '#ef444440' : '#22c55e40', background: contractResult.isKnownScam ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)' }}>
            {/* Verdict */}
            <div className="flex items-center gap-3">
              {contractResult.isKnownScam ? (
                <ShieldAlert className="w-10 h-10 text-red-500 flex-shrink-0" />
              ) : (
                <ShieldCheck className="w-10 h-10 text-green-500 flex-shrink-0" />
              )}
              <div>
                <p className="font-bold text-sm" style={{ color: contractResult.isKnownScam ? '#ef4444' : '#22c55e' }}>
                  {contractResult.verdict}
                </p>
                <button onClick={() => copyAddress(contractResult.address)} className="text-white/30 text-[10px] font-mono flex items-center gap-1 mt-1 active:text-white/60">
                  {contractResult.address.slice(0, 12)}...{contractResult.address.slice(-8)}
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Program info */}
            {contractResult.programInfo && (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-white/5">
                  <p className="text-white/30 mb-1">Executable</p>
                  <p className="font-bold" style={{ color: contractResult.programInfo.executable ? '#22c55e' : '#f59e0b' }}>
                    {contractResult.programInfo.executable ? 'Yes' : 'No'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-white/5">
                  <p className="text-white/30 mb-1">Data Size</p>
                  <p className="font-bold text-white">{(contractResult.programInfo.dataSize / 1024).toFixed(1)} KB</p>
                </div>
                <div className="p-3 rounded-lg bg-white/5 col-span-2">
                  <p className="text-white/30 mb-1">Owner</p>
                  <p className="font-mono text-white/60 text-[10px] break-all">{contractResult.programInfo.owner}</p>
                </div>
              </div>
            )}

            {!contractResult.programInfo && (
              <div className="p-3 rounded-lg bg-white/5 text-center">
                <p className="text-white/30 text-xs">Account not found or not a program</p>
              </div>
            )}

            <a
              href={`https://explorer.solana.com/address/${contractResult.address}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 text-cyan-400/60 text-xs hover:text-cyan-300 py-2"
            >
              View on Explorer <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Dark Pool result */}
        {darkPoolResult && (
          <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: `${riskColor(darkPoolResult.riskLevel)}40` }}>
            {/* Risk level */}
            <div className="flex items-center gap-3">
              {darkPoolResult.riskLevel === 'clean' ? (
                <CheckCircle className="w-10 h-10 flex-shrink-0" style={{ color: riskColor('clean') }} />
              ) : darkPoolResult.riskLevel === 'high' ? (
                <ShieldAlert className="w-10 h-10 flex-shrink-0" style={{ color: riskColor('high') }} />
              ) : (
                <AlertTriangle className="w-10 h-10 flex-shrink-0" style={{ color: riskColor(darkPoolResult.riskLevel) }} />
              )}
              <div>
                <p className="font-bold text-sm" style={{ color: riskColor(darkPoolResult.riskLevel) }}>
                  {darkPoolResult.riskLevel === 'clean' ? 'No scam interactions detected' :
                   darkPoolResult.riskLevel === 'medium' ? 'Caution — some suspicious interactions' :
                   darkPoolResult.riskLevel === 'high' ? 'Warning — multiple scam interactions' : 'Analysis incomplete'}
                </p>
                <p className="text-white/30 text-xs mt-1">{darkPoolResult.totalProgramsUsed} programs used, {darkPoolResult.scamCount} flagged</p>
              </div>
            </div>

            {/* Scam interactions list */}
            {darkPoolResult.scamInteractions.length > 0 && (
              <div className="space-y-2">
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Flagged Interactions</p>
                {darkPoolResult.scamInteractions.map((item, i) => (
                  <div key={i} className="p-3 rounded-lg bg-red-500/5 border border-red-500/10 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-red-400 font-bold">
                        {item.program ? '⚠️ Scam Program' : '⚠️ Scam Address'}
                      </span>
                      {item.blockTime && (
                        <span className="text-white/20">{new Date(item.blockTime).toLocaleDateString()}</span>
                      )}
                    </div>
                    <p className="font-mono text-white/40 text-[10px] break-all">
                      {item.program || item.address}
                    </p>
                    <a
                      href={`https://explorer.solana.com/tx/${item.signature}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400/50 text-[10px] flex items-center gap-1 mt-1"
                    >
                      View TX <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                ))}
              </div>
            )}

            {darkPoolResult.scamInteractions.length === 0 && darkPoolResult.riskLevel === 'clean' && (
              <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/10 text-center">
                <CheckCircle className="w-8 h-8 mx-auto text-green-500 mb-2" />
                <p className="text-green-400 text-sm font-bold">Wallet is clean</p>
                <p className="text-white/30 text-xs mt-1">No interactions with known scam contracts found</p>
              </div>
            )}
          </div>
        )}

        {/* Info box */}
        {!contractResult && !darkPoolResult && !loading && (
          <div className="rounded-xl bg-white/[0.02] border border-white/5 p-4 mt-2">
            <h3 className="text-white/50 text-xs font-bold mb-2">How it works</h3>
            <ul className="text-white/25 text-xs space-y-1.5 leading-relaxed">
              <li>• <strong className="text-white/40">Contract Check:</strong> verifies if a program is flagged in our scam database, checks on-chain account info</li>
              <li>• <strong className="text-white/40">Wallet Scan:</strong> analyzes last 100 transactions for interactions with known scam contracts and addresses</li>
              <li>• <strong className="text-white/40">Database:</strong> maintained list of known rug-pull deployers, honeypot contracts, and phishing addresses</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
