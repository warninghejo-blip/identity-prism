import { FormEvent, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, Radar, Shield, Target, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import SiteHeader from '@/components/SiteHeader';
import { fetchSybilAnalysis, type SybilResult } from '@/components/prism/shared';
import './apk-pages.css';

const bountyTargets = [
  'BmkPPw7o4K2xq6uEJmH9r5m7fNzVL',
  'GejR6mK8sw9QpVx2F3sTnA5oG',
  'E8swCwC1Y3U4v9qJ5aTR9CX5d',
  '8ne4sDQr7zF9yL2pa6bZPMs',
  'DkGa72kVT3mD6sFfJaysxH',
  '6PzQ7oJb2Va8M6SckMo5Q8',
];

const checklist = [
  'Connecting to Solana RPC',
  'Fetching tx history',
  'Analyzing 23 risk signals',
  'Tracing funding graph',
  'Profiling behavior patterns',
];

const quizzes = [
  {
    title: 'CRYPTO CULTURE +5 coins',
    question: 'What does HODL mean in crypto culture?',
    answers: ['Hold through volatility', 'High order daily ledger', 'Hide old dead liquidity', 'Hash-only data layer'],
  },
  {
    title: 'SOLANA +5 coins',
    question: 'Jupiter is best known as a Solana...',
    answers: ['DEX aggregator', 'NFT compression standard', 'Hardware wallet', 'Validator client'],
  },
];

function truncate(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function normalizeResult(data: SybilResult | null) {
  if (!data) return null;
  const riskScore = Math.max(0, Math.min(100, Number(data.riskScore ?? 0)));
  const label =
    riskScore >= 70 ? 'LINKED CLUSTER' : riskScore >= 35 ? 'REVIEW TARGET' : 'WALLET CLEAR';
  return {
    riskScore,
    label,
    trustScore: Number(data.trustScore ?? 100 - riskScore),
    signals: Array.isArray(data.signals) ? data.signals.slice(0, 5) : [],
  };
}

export default function SybilHunt() {
  const [target, setTarget] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReturnType<typeof normalizeResult>>(null);
  const quiz = useMemo(() => quizzes[Math.floor(Math.random() * quizzes.length)], [loading]);

  const runHunt = async (value = target) => {
    const next = value.trim();
    if (!next || loading) return;
    setTarget(next);
    setSubmitted(next);
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await fetchSybilAnalysis(next);
      const normalized = normalizeResult(data);
      if (!normalized) throw new Error('empty_sybil_result');
      setResult(normalized);
    } catch {
      setError('Sybil analysis is still warming up. Try another target or retry in a few seconds.');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void runHunt();
  };

  return (
    <div className="apk-page">
      <SiteHeader />
      <main className="apk-main">
        <div className="sybil-head">
          <Link to="/identity" className="apk-secondary-button"><ArrowLeft size={18} aria-hidden="true" /> Back</Link>
          <h1 className="sybil-title"><Target aria-hidden="true" /> Sybil Hunt</h1>
        </div>

        <div className="sybil-layout">
          <section>
            <div className="apk-panel sybil-command">
              <div className="sybil-copy">
                <div className="apk-kicker" style={{ color: '#f5a623' }}>Operator console</div>
                <h2>Expose linked wallet clusters before they farm trust.</h2>
                <p>Run a target through funding graph checks, behavior signals, token activity, and cluster heuristics. Clean wallets earn scan rewards; linked clusters go to bounty review.</p>
                <div className="sybil-metrics">
                  <span><b>23</b> signals</span>
                  <span><b>5</b> graph checks</span>
                  <span><b>+20</b> bounty</span>
                </div>
              </div>

              <div className="sybil-console">
                <div className="apk-panel sybil-card recruit-card">
                  <img src="/landing/textures/ranks/rank_cadet.png" alt="" style={{ width: 88 }} />
                  <div className="recruit-stat"><b>0</b><span>hunts</span></div>
                  <div className="recruit-stat"><b style={{ color: '#f87171' }}>0</b><span>caught</span></div>
                  <div className="recruit-stat"><b>Tracker</b><span>next rank</span></div>
                  <div className="recruit-stat"><b>0</b><span>/3 sybils</span></div>
                  <div className="limit-track recruit-progress"><span style={{ '--pct': '0%', background: 'linear-gradient(90deg,#f5a623,#ef4444)' } as React.CSSProperties} /></div>
                  <strong style={{ color: '#d7a72d', fontSize: 26 }}>⊕ 0</strong>
                </div>

                <form className="sybil-search" onSubmit={onSubmit}>
                  <label className="sr-only" htmlFor="sybil-target">Target wallet address</label>
                  <input id="sybil-target" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Wallet address" autoComplete="off" />
                  <button className="hunt-button" type="submit" disabled={loading}>
                    {loading ? <><Loader2 className="animate-spin" aria-hidden="true" /> SCANNING</> : <><Target aria-hidden="true" /> HUNT</>}
                  </button>
                </form>
              </div>
            </div>

            {loading && (
              <div className="apk-panel sybil-card">
                <div className="apk-kicker" style={{ color: '#f5a623' }}>Hunting Target</div>
                <h2 style={{ fontSize: 32, fontWeight: 900, fontFamily: 'monospace' }}>{truncate(submitted)}</h2>
                <ul className="checklist">
                  {checklist.map((item, index) => (
                    <li key={item}>{index < 4 ? <CheckCircle2 size={16} color="#4ade80" aria-hidden="true" /> : <Loader2 size={16} className="animate-spin" aria-hidden="true" />} {item}</li>
                  ))}
                </ul>
                <div className="apk-panel quiz-card">
                  <b style={{ color: '#f5a623' }}>{quiz.title}</b>
                  <p>{quiz.question}</p>
                  <div className="reward-grid">
                    {quiz.answers.map((answer) => <button type="button" className="apk-secondary-button" key={answer}>{answer}</button>)}
                  </div>
                </div>
              </div>
            )}

            {error && <div className="apk-panel result-card" role="alert"><TriangleAlert color="#f87171" aria-hidden="true" /> {error}</div>}

            {result && (
              <div className="apk-panel result-card">
                <div className="apk-kicker" style={{ color: result.riskScore >= 60 ? '#ef4444' : '#4ade80' }}>Analysis complete</div>
                <h2 style={{ fontSize: 36, fontWeight: 900 }}>{result.label}</h2>
                <p className="apk-muted">{truncate(submitted)} · risk {result.riskScore} · trust {result.trustScore}</p>
                <ul className="checklist">
                  {result.signals.length ? result.signals.map((signal: any) => <li key={signal.id ?? signal.name}><Radar size={16} aria-hidden="true" /> {signal.name ?? signal.id ?? 'Risk signal'}</li>) : <li><Shield size={16} aria-hidden="true" /> No high-confidence linked cluster returned.</li>}
                </ul>
                <div className="sybil-result-actions">
                  <button type="button" className="apk-primary-button" onClick={() => { setTarget(''); setSubmitted(''); setResult(null); }}>Try another</button>
                  <button type="button" className="apk-secondary-button" onClick={() => setError('Target added to the local bounty board queue.')}>Add to bounty board</button>
                </div>
              </div>
            )}

            <div className="apk-panel mission-briefing">
              <div className="apk-kicker" style={{ color: '#d7a72d' }}>Mission Briefing</div>
              <p>Sybil wallets pollute the ecosystem with fake identities. Your mission: scan suspicious addresses, expose linked clusters, and reward clean wallet review with coins.</p>
              <div className="reward-grid">
                <div className="apk-panel sybil-card"><TriangleAlert color="#f87171" aria-hidden="true" /><b>SYBIL FOUND</b><h3 style={{ color: '#f5a623', fontSize: 42 }}>+20</h3><span className="apk-muted">coins bounty</span></div>
                <div className="apk-panel sybil-card"><Shield color="#4ade80" aria-hidden="true" /><b>WALLET CLEAR</b><h3 style={{ fontSize: 42 }}>+5</h3><span className="apk-muted">coins scan fee</span></div>
              </div>
              <div className="arsenal-grid">
                {['23 Signals', 'Fund Graph', 'Behavior'].map((item) => <div className="apk-panel sybil-card" key={item}><Radar color="#f5a623" aria-hidden="true" /><b>{item}</b><p className="apk-muted">Detection arsenal</p></div>)}
              </div>
            </div>
          </section>

          <aside className="apk-panel bounty-board">
            <div className="apk-kicker" style={{ color: '#f87171' }}>Bounty Board</div>
            {bountyTargets.map((item) => (
              <button type="button" className="bounty-row" key={item} onClick={() => void runHunt(item)}>
                <span>{truncate(item)}</span><span className="risk-pill">60 LINKED</span><span className="linked-pill">+20 coins</span>
              </button>
            ))}
          </aside>
        </div>
      </main>
    </div>
  );
}
