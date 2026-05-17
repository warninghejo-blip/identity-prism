import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Flame, Trash2, Zap } from 'lucide-react';
import './landing.css';

/**
 * BlackHoleWeb — thin marketing landing for /blackhole on the web target.
 * NOT a copy of pages-app/BlackHole.tsx (interactive burner).
 * Static hero + value props + "Download APK" CTA. No wallet logic.
 */
export default function BlackHoleWeb() {
  return (
    <div className="landing-page" style={{ minHeight: '100vh', background: '#05070a', color: 'white' }}>
      <header className="landing-header" style={{ padding: '24px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'white' }}>
          <img src="/phav.png" alt="" style={{ width: 32, height: 32 }} />
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, letterSpacing: 1 }}>IDENTITY PRISM</span>
        </Link>
        <nav style={{ display: 'flex', gap: 24 }}>
          <Link to="/" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none' }}>Home</Link>
          <Link to="/identity" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none' }}>Identity</Link>
          <Link to="/sybil-check" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none' }}>Sybil Check</Link>
        </nav>
      </header>

      <section style={{ position: 'relative', padding: '80px 32px 120px', textAlign: 'center', overflow: 'hidden' }}>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at center, rgba(255, 80, 80, 0.16) 0%, transparent 60%)',
            pointerEvents: 'none',
          }}
        />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          style={{ position: 'relative', maxWidth: 880, margin: '0 auto' }}
        >
          <span
            style={{
              display: 'inline-block',
              padding: '6px 14px',
              borderRadius: 999,
              border: '1px solid rgba(255, 140, 80, 0.3)',
              color: '#ff9b6a',
              fontSize: 12,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              marginBottom: 24,
            }}
          >
            Wallet Cleanup
          </span>
          <h1
            style={{
              fontFamily: 'Orbitron, sans-serif',
              fontSize: 'clamp(40px, 6vw, 72px)',
              fontWeight: 700,
              lineHeight: 1.05,
              margin: '0 0 24px',
              background: 'linear-gradient(135deg, #fff 0%, #ff9b6a 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Throw the spam into the Black Hole.
          </h1>
          <p style={{ fontSize: 20, lineHeight: 1.5, color: 'rgba(255, 255, 255, 0.75)', maxWidth: 640, margin: '0 auto 40px' }}>
            Scam tokens, NFT dust, drainer approvals — burn them all in one tap. Reclaim rent SOL,
            clear your wallet, boost your Identity Prism score.
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a
              href="https://identityprism.xyz/landing/download"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 28px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, #ff9b6a 0%, #ff6a6a 100%)',
                color: '#05070a',
                fontWeight: 700,
                textDecoration: 'none',
                fontSize: 16,
              }}
            >
              Download APK <ArrowRight size={18} />
            </a>
            <Link
              to="/identity"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 28px',
                borderRadius: 12,
                border: '1px solid rgba(255, 255, 255, 0.18)',
                color: 'white',
                textDecoration: 'none',
                fontSize: 16,
              }}
            >
              Learn about Identity
            </Link>
          </div>
        </motion.div>
      </section>

      <section style={{ padding: '60px 32px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
          {[
            {
              icon: <Trash2 size={28} />,
              title: 'Burn spam tokens',
              copy: 'Detect every scam/honeypot/dust token in your wallet and burn them in batched txs.',
            },
            {
              icon: <Flame size={28} />,
              title: 'Reclaim rent',
              copy: 'Each closed token account returns ~0.002 SOL of rent. The Black Hole gives it back.',
            },
            {
              icon: <Zap size={28} />,
              title: 'Boost trust score',
              copy: 'A clean wallet scores higher on the Identity Prism composite score. Less dust = more trust.',
            },
          ].map((f) => (
            <div
              key={f.title}
              style={{
                padding: 24,
                borderRadius: 16,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div style={{ color: '#ff9b6a', marginBottom: 12 }}>{f.icon}</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600 }}>{f.title}</h3>
              <p style={{ margin: 0, color: 'rgba(255, 255, 255, 0.6)', fontSize: 14, lineHeight: 1.5 }}>{f.copy}</p>
            </div>
          ))}
        </div>
      </section>

      <footer style={{ padding: '40px 32px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.4)', fontSize: 13 }}>
        <Link to="/" style={{ color: 'inherit', textDecoration: 'underline' }}>Back to home</Link>
      </footer>
    </div>
  );
}
