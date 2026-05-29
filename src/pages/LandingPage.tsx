import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import SiteHeader from '@/components/SiteHeader';
import WebIdentityDemoCard from '@/components/WebIdentityDemoCard';
import { useGlobalStats } from '@/hooks/useGlobalStats';
import './landing.css';

// Animated count-up for the two LIVE hero stats (idsMinted, sybilsCaught).
// Formats with thousands separators; shows 0 while stats are loading.
function CountUpStat({ value, label }: { value: number; label: string }) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (latest) => Math.round(latest).toLocaleString('en-US'));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.2, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [mv, value]);
  return (
    <div className="hero-stat">
      <motion.div className="n">{display}</motion.div>
      <div className="l">{label}</div>
    </div>
  );
}

export default function LandingPage() {
  const stats = useGlobalStats(15_000);

  // ===== Ported scripts: bg-cosmos canvas, sybil-canvas cluster, scroll-rail
  // active highlighting, and reveal IntersectionObserver — all in ONE effect.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.ipl');
    if (!root) return;
    // The landing's motion (scroll reveals + cosmic/sybil canvases) is core to the
    // design and explicitly wanted, so we run it regardless of the OS reduced-motion
    // setting (which would otherwise hide the canvases and skip the reveal animation).
    const reduce = false;

    const rafIds: number[] = [];
    const cleanups: Array<() => void> = [];

    // ---- Reveal observer ----
    const revealEls = Array.from(
      root.querySelectorAll<HTMLElement>('.reveal, .reveal-stagger, .reveal-zoom'),
    );
    if (reduce || !('IntersectionObserver' in window)) {
      revealEls.forEach((el) => el.classList.add('in'));
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('in');
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12 },
      );
      revealEls.forEach((el) => io.observe(el));
      cleanups.push(() => io.disconnect());
    }

    // ---- Section progress rail active highlighting ----
    {
      const sections = ['hero', 'problem', 'solution', 'sybil-catch', 'badges', 'tiers', 'explode', 'ranks', 'games', 'ecosystem', 'cta'];
      const railMap: Record<string, string> = { hero: 'hero', problem: 'problem', solution: 'solution', 'sybil-catch': 'sybil-catch', badges: 'badges', tiers: 'tiers', explode: 'tiers', ranks: 'ranks', games: 'games', ecosystem: 'ecosystem', cta: 'cta' };
      const dots = Array.from(root.querySelectorAll<HTMLElement>('#scroll-rail .dot'));
      const dotClick = (d: HTMLElement) => () => {
        const el = document.getElementById(d.dataset.target || '');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      const dotHandlers: Array<[HTMLElement, () => void]> = dots.map((d) => {
        const h = dotClick(d);
        d.addEventListener('click', h);
        return [d, h];
      });
      let ticking = false;
      const update = () => {
        ticking = false;
        let active = 'hero';
        for (const id of sections) {
          const el = document.getElementById(id);
          if (el && el.getBoundingClientRect().top < window.innerHeight * 0.45) active = id;
        }
        const target = railMap[active] || active;
        dots.forEach((d) => d.classList.toggle('active', d.dataset.target === target));
      };
      const onScroll = () => {
        if (!ticking) {
          requestAnimationFrame(update);
          ticking = true;
        }
      };
      window.addEventListener('scroll', onScroll);
      update();
      cleanups.push(() => {
        window.removeEventListener('scroll', onScroll);
        dotHandlers.forEach(([d, h]) => d.removeEventListener('click', h));
      });
    }

    if (!reduce) {
      // ---- Cosmic background canvas (#bg-cosmos) ----
      {
        const c = document.getElementById('bg-cosmos') as HTMLCanvasElement | null;
        const ctx = c?.getContext('2d');
        if (c && ctx) {
          let stars: Array<{ x: number; y: number; r: number; a: number; hue: number }> = [];
          let shoots: Array<{ x: number; y: number; vx: number; vy: number; life: number }> = [];
          const init = () => {
            stars = [];
            for (let i = 0; i < 260; i++) {
              stars.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: Math.random() * 1.2 + 0.2, a: Math.random(), hue: Math.random() < 0.1 ? (Math.random() < 0.5 ? 200 : 280) : 0 });
            }
          };
          const resize = () => {
            c.width = innerWidth * devicePixelRatio;
            c.height = innerHeight * devicePixelRatio;
            c.style.width = innerWidth + 'px';
            c.style.height = innerHeight + 'px';
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(devicePixelRatio, devicePixelRatio);
            init();
          };
          const tick = () => {
            ctx.clearRect(0, 0, innerWidth, innerHeight);
            const g1 = ctx.createRadialGradient(innerWidth * 0.2, innerHeight * 0.3, 0, innerWidth * 0.2, innerHeight * 0.3, innerWidth * 0.5);
            g1.addColorStop(0, 'rgba(80,40,120,.06)');
            g1.addColorStop(1, 'transparent');
            ctx.fillStyle = g1;
            ctx.fillRect(0, 0, innerWidth, innerHeight);
            const g2 = ctx.createRadialGradient(innerWidth * 0.8, innerHeight * 0.7, 0, innerWidth * 0.8, innerHeight * 0.7, innerWidth * 0.5);
            g2.addColorStop(0, 'rgba(30,80,140,.07)');
            g2.addColorStop(1, 'transparent');
            ctx.fillStyle = g2;
            ctx.fillRect(0, 0, innerWidth, innerHeight);
            stars.forEach((s) => {
              s.a += (Math.random() - 0.5) * 0.04;
              s.a = Math.max(0.1, Math.min(1, s.a));
              ctx.beginPath();
              ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
              ctx.fillStyle = s.hue === 200 ? 'rgba(125,211,252,' + s.a + ')' : s.hue === 280 ? 'rgba(192,132,252,' + s.a + ')' : 'rgba(255,255,255,' + s.a + ')';
              ctx.fill();
            });
            if (Math.random() < 0.003) shoots.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight * 0.6, vx: -8 - Math.random() * 4, vy: 3 + Math.random() * 2, life: 1 });
            shoots = shoots.filter((s) => {
              s.x += s.vx;
              s.y += s.vy;
              s.life -= 0.015;
              if (s.life <= 0) return false;
              ctx.beginPath();
              ctx.moveTo(s.x, s.y);
              ctx.lineTo(s.x - s.vx * 8, s.y - s.vy * 8);
              ctx.strokeStyle = 'rgba(255,255,255,' + s.life + ')';
              ctx.lineWidth = 1.2;
              ctx.stroke();
              return true;
            });
            rafIds[0] = requestAnimationFrame(tick);
          };
          resize();
          window.addEventListener('resize', resize);
          rafIds[0] = requestAnimationFrame(tick);
          cleanups.push(() => window.removeEventListener('resize', resize));
        }
      }

      // ---- Sybil cluster canvas (#sybil-canvas) ----
      {
        const c = document.getElementById('sybil-canvas') as HTMLCanvasElement | null;
        const ctx = c?.getContext('2d');
        if (c && ctx) {
          let W = 0;
          let H = 0;
          let t = 0;
          let detected = false;
          let detectT = 0;
          let hub = { x: 0, y: 0, r: 14 };
          let sybils: Array<{ ax: number; ad: number; r: number; sp: number; pulse: number; x: number; y: number }> = [];
          let clusters: Array<{ x: number; y: number; r: number; sats: Array<{ x: number; y: number; r: number }>; ax: number }> = [];
          const init = () => {
            hub = { x: W * 0.5, y: H * 0.5, r: 14 };
            sybils = [];
            const N = 18;
            for (let i = 0; i < N; i++) {
              const a = (Math.PI * 2 / N) * i;
              sybils.push({ ax: a, ad: Math.min(W, H) * 0.28, r: 4, sp: 0.0008, pulse: Math.random(), x: 0, y: 0 });
            }
            clusters = [];
            for (let i = 0; i < 7; i++) {
              const a = (Math.PI * 2 / 7) * i + Math.PI / 7;
              const d = Math.min(W, H) * 0.4;
              const cx = W * 0.5 + Math.cos(a) * d;
              const cy = H * 0.5 + Math.sin(a) * d;
              const sats: Array<{ x: number; y: number; r: number }> = [];
              for (let j = 0; j < 4; j++) {
                const oa = Math.random() * Math.PI * 2;
                const od = 20 + Math.random() * 14;
                sats.push({ x: cx + Math.cos(oa) * od, y: cy + Math.sin(oa) * od, r: 2 });
              }
              clusters.push({ x: cx, y: cy, r: 5, sats, ax: a });
            }
          };
          const resize = () => {
            const r = c.parentElement!.getBoundingClientRect();
            c.width = r.width * 2;
            c.height = r.height * 2;
            c.style.width = r.width + 'px';
            c.style.height = r.height + 'px';
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(2, 2);
            W = r.width;
            H = r.height;
            init();
          };
          const tick = () => {
            ctx.clearRect(0, 0, W, H);
            t += 1;
            detectT += 1;
            if (detectT > 240) {
              detected = !detected;
              detectT = 0;
            }

            ctx.strokeStyle = 'rgba(248,113,113,.06)';
            ctx.lineWidth = 0.7;
            for (let i = 0; i < clusters.length; i++) {
              for (let j = i + 1; j < clusters.length; j++) {
                if (Math.abs(i - j) === 1 || (i === 0 && j === clusters.length - 1)) {
                  ctx.beginPath();
                  ctx.moveTo(clusters[i].x, clusters[i].y);
                  ctx.lineTo(clusters[j].x, clusters[j].y);
                  ctx.stroke();
                }
              }
            }

            sybils.forEach((n, i) => {
              n.ax += n.sp * 16;
              n.x = W * 0.5 + Math.cos(n.ax) * n.ad;
              n.y = H * 0.5 + Math.sin(n.ax) * n.ad;
              const grad = ctx.createLinearGradient(hub.x, hub.y, n.x, n.y);
              const alpha = detected ? 0.8 : 0.45;
              grad.addColorStop(0, 'rgba(248,113,113,' + alpha + ')');
              grad.addColorStop(1, 'rgba(248,113,113,.05)');
              ctx.strokeStyle = grad;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(hub.x, hub.y);
              ctx.lineTo(n.x, n.y);
              ctx.stroke();
              const pp = ((t * 0.5 + i * 20) % 80) / 80;
              const px = hub.x + (n.x - hub.x) * pp;
              const py = hub.y + (n.y - hub.y) * pp;
              ctx.beginPath();
              ctx.arc(px, py, 2.2, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(255,210,210,.95)';
              ctx.fill();
            });

            clusters.forEach((cl) => {
              cl.sats.forEach((s) => {
                ctx.strokeStyle = 'rgba(248,113,113,.16)';
                ctx.lineWidth = 0.6;
                ctx.beginPath();
                ctx.moveTo(cl.x, cl.y);
                ctx.lineTo(s.x, s.y);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(248,113,113,.5)';
                ctx.fill();
              });
              ctx.beginPath();
              ctx.arc(cl.x, cl.y, cl.r, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(248,113,113,.7)';
              ctx.fill();
              ctx.strokeStyle = 'rgba(252,165,165,.6)';
              ctx.stroke();
            });

            sybils.forEach((n) => {
              ctx.fillStyle = 'rgba(248,113,113,.9)';
              ctx.beginPath();
              ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = 'rgba(252,165,165,.7)';
              ctx.lineWidth = 1;
              ctx.stroke();
            });

            if (detected) {
              const cl = clusters[Math.floor((t * 0.005) % clusters.length)];
              const k = (detectT % 60) / 60;
              ctx.strokeStyle = 'rgba(248,113,113,' + (1 - k) + ')';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(cl.x, cl.y, 8 + k * 40, 0, Math.PI * 2);
              ctx.stroke();
            }

            const g = ctx.createRadialGradient(hub.x, hub.y, 0, hub.x, hub.y, 46);
            g.addColorStop(0, 'rgba(248,113,113,.55)');
            g.addColorStop(1, 'transparent');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(hub.x, hub.y, 46, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#f87171';
            ctx.beginPath();
            ctx.arc(hub.x, hub.y, hub.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,200,200,.9)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            const pr = 16 + (t * 0.5) % 34;
            ctx.beginPath();
            ctx.arc(hub.x, hub.y, pr, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(248,113,113,' + Math.max(0, 1 - (pr - 16) / 34) + ')';
            ctx.lineWidth = 1;
            ctx.stroke();

            rafIds[1] = requestAnimationFrame(tick);
          };
          resize();
          // Re-measure whenever the parent actually gets/changes size — the grid
          // column width isn't final on first paint, which would otherwise collapse
          // the cluster to a zero-size center (invisible).
          requestAnimationFrame(resize);
          if ('ResizeObserver' in window && c.parentElement) {
            const ro = new ResizeObserver(() => resize());
            ro.observe(c.parentElement);
            cleanups.push(() => ro.disconnect());
          }
          window.addEventListener('resize', resize);
          rafIds[1] = requestAnimationFrame(tick);
          cleanups.push(() => window.removeEventListener('resize', resize));
        }
      }
    }

    return () => {
      rafIds.forEach((id) => id && cancelAnimationFrame(id));
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return (
    <>
      {/* Header — real app SiteHeader, OUTSIDE .ipl so the landing reset/styles can't touch it */}
      <SiteHeader />
    <div className="ipl">
      <canvas id="bg-cosmos"></canvas>

      {/* Scroll storytelling rail */}
      <div className="scroll-rail" id="scroll-rail">
        <div className="dot active" data-l="Hero" data-target="hero"></div>
        <div className="dot" data-l="Problem" data-target="problem"></div>
        <div className="dot" data-l="Solution" data-target="solution"></div>
        <div className="dot" data-l="Filter" data-target="sybil-catch"></div>
        <div className="dot" data-l="Badges" data-target="badges"></div>
        <div className="dot" data-l="Tiers" data-target="tiers"></div>
        <div className="dot" data-l="Ranks" data-target="ranks"></div>
        <div className="dot" data-l="Games" data-target="games"></div>
        <div className="dot" data-l="Hub" data-target="ecosystem"></div>
        <div className="dot" data-l="Launch" data-target="cta"></div>
      </div>

      {/* HERO with celestial card demo */}
      <section id="hero">
        <div className="container">
          <div className="hero-wrap">
            <div className="hero-left">
              <div className="hero-eyebrow">Solana · On-Chain Identity Protocol</div>
              <h1 className="hero-title">
                <span className="l1">Your reputation,</span>
                <span className="l2">earned not bought.</span>
              </h1>
              <p className="hero-desc">A decentralized identity protocol where <strong>real humans rise</strong> through gameplay, on-chain history, and verified humanity — and <strong>sybils get caught</strong> by the very games they try to farm.</p>
              <div className="hero-ctas">
                <a href="#cta" className="btn btn-primary lg">Launch App</a>
                <a href="#solution" className="btn btn-ghost lg">How it works →</a>
              </div>
              <div className="hero-stats">
                <CountUpStat value={stats?.idsMinted ?? 0} label="Identities" />
                <div className="hero-stat"><div className="n">10</div><div className="l">Composite Tiers</div></div>
                <div className="hero-stat"><div className="n">20</div><div className="l">On-Chain Badges</div></div>
                <CountUpStat value={stats?.sybilsCaught ?? 0} label="Sybils Caught" />
              </div>
            </div>

            {/* Celestial Card — real component */}
            <div className="hero-right">
              <WebIdentityDemoCard />
            </div>
          </div>
        </div>
      </section>

      <div className="sec-divider"><div className="ribbon">— The Problem —</div></div>

      {/* PROBLEM */}
      <section id="problem">
        <div className="container">
          <div className="sec-head reveal">
            <div className="sec-tag warn">Web3 is broken</div>
            <h2 className="sec-title">One human.<br />Ten thousand wallets.</h2>
            <p className="sec-sub">Every airdrop, governance vote, and "fair launch" gets drained by sybil farms. Real users lose. Protocols lose. Web3 loses trust.</p>
          </div>

          <div className="problem-wrap">
            <div className="prob-cards reveal-stagger">
              <div className="prob-card"><div className="prob-num">01</div><div><h4>Airdrops captured by farms</h4><p>A single operator runs 10,000 wallets through every quest, claims everything, dumps it the moment vesting unlocks.</p></div></div>
              <div className="prob-card"><div className="prob-num">02</div><div><h4>Governance is captured</h4><p>DAO votes are decided by whoever can spin up the most addresses cheapest — not by the actual community.</p></div></div>
              <div className="prob-card"><div className="prob-num">03</div><div><h4>KYC kills web3</h4><p>The only "solution" the industry knows is uploading your passport. That's not decentralization — that's surveillance with extra steps.</p></div></div>
              <div className="prob-card"><div className="prob-num">04</div><div><h4>Reputation has no portability</h4><p>Your history on one protocol means nothing on the next. Every project re-invents the wheel and gets farmed all over again.</p></div></div>
            </div>

            <div className="sybil-stage reveal">
              <canvas id="sybil-canvas"></canvas>
              <div className="sybil-stats">
                <div>Cluster · <span id="syb-n">247</span> nodes</div>
                <div className="live">Live detection</div>
              </div>
              <div className="sybil-readout">
                funding-source: <span>shared</span><br />
                tx-timing: <span>identical ±2.3s</span><br />
                behavior: <span>scripted</span><br />
                verdict: <b style={{ color: '#f87171' }}>SYBIL CLUSTER</b>
              </div>
              <div className="sybil-label">Real-time on-chain pattern analysis</div>
            </div>
          </div>
        </div>
      </section>

      <div className="sec-divider"><div className="ribbon">— The Solution —</div></div>

      {/* SOLUTION */}
      <section id="solution">
        <div className="container">
          <div className="sec-head reveal">
            <div className="sec-tag">The transformation</div>
            <h2 className="sec-title">From wallet<br />to identity.</h2>
            <p className="sec-sub">An anonymous address becomes a portable, sybil-resistant reputation profile — without giving up custody, privacy, or sovereignty.</p>
          </div>

          <div className="sol-grid">
            <div className="sol-stage reveal">
              <div className="sol-row">
                <div className="sol-side">
                  <div className="sol-icon-frame from">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7h18a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1z" />
                      <path d="M3 7l3-4h12l3 4" />
                      <circle cx="17" cy="13" r="1.5" fill="currentColor" />
                    </svg>
                  </div>
                  <h5>Before</h5>
                  <div className="label">Anonymous Wallet</div>
                  <div className="desc">A string of characters with zero context.</div>
                </div>
                <div className="sol-arrow">
                  <div className="sol-arrow-line"></div>
                  <div className="sol-arrow-tip">Identity Prism</div>
                  <div className="sol-arrow-line"></div>
                </div>
                <div className="sol-side">
                  <div className="sol-icon-frame to">
                    <img src="/landing/phav.png" alt="" style={{ width: '64px', height: '64px', filter: 'drop-shadow(0 0 16px rgba(167,139,250,.6))' }} />
                  </div>
                  <h5>After</h5>
                  <div className="label">Cosmic Identity</div>
                  <div className="desc">A scored, badged, portable reputation.</div>
                </div>
              </div>
              <div className="sol-pipeline">
                <div className="step"><div className="dot"></div>Connect</div><div className="sep">/</div>
                <div className="step"><div className="dot"></div>Analyze</div><div className="sep">/</div>
                <div className="step"><div className="dot"></div>Play</div><div className="sep">/</div>
                <div className="step"><div className="dot"></div>Earn</div>
              </div>
            </div>

            <div className="sol-text reveal">
              <h3>Connect once. <em>Carry your reputation everywhere.</em></h3>
              <p>The Prism reads your wallet's full on-chain story — every transaction, every token, every protocol. It analyzes patterns, awards badges, calculates a score, and assigns you a tier among the planets.</p>
              <p>Then you <strong>play</strong>. Skill-based games keep your score alive and growing — and surface bots automatically.</p>
              <div className="sol-checks">
                <div className="sol-check"><div className="sol-check-mark"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg></div><span><b>Non-custodial.</b> We never hold your keys, your tokens, or your data.</span></div>
                <div className="sol-check"><div className="sol-check-mark"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg></div><span><b>Zero KYC.</b> No passport, no selfie — humanity proven through behavior.</span></div>
                <div className="sol-check"><div className="sol-check-mark"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg></div><span><b>Portable.</b> Your score works across any Solana protocol that integrates Prism.</span></div>
                <div className="sol-check"><div className="sol-check-mark"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg></div><span><b>Earned, not bought.</b> Score can't be transferred, sold, or faked — only proven.</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="sec-divider"><div className="ribbon">— Anti-Sybil Engine —</div></div>

      {/* SYBIL CATCH */}
      <section id="sybil-catch">
        <div className="container">
          <div className="sec-head sc-hero reveal">
            <div className="sec-tag">The core mechanic</div>
            <h3><span className="red">Sybils get caught.</span><br /><span className="green">Humans get cleared.</span></h3>
            <p>Anti-sybil isn't a one-time scan — it's a continuous filter. Real humans recover their reputation through skill. Bots can't. That's the whole protocol.</p>
          </div>
          <div className="sc-flow">
            <div className="sc-track bad reveal">
              <div className="sc-track-head">
                <div className="sc-track-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="8" y1="8" x2="16" y2="16" /><line x1="16" y1="8" x2="8" y2="16" /></svg></div>
                <div><h4>The Sybil Path</h4><div className="sub">Bot · Farm · Multi-account</div></div>
              </div>
              <div className="sc-steps">
                <div className="sc-step"><div className="sc-step-n">01</div><div className="sc-step-content"><b>Connects 10,000 wallets</b><span>Operator runs the same scripted on-chain history across a farm.</span></div></div>
                <div className="sc-step"><div className="sc-step-n">02</div><div className="sc-step-content"><b>Pattern flagged</b><span>The Prism detects shared funding sources, identical timing, copy-paste behavior.</span></div></div>
                <div className="sc-step"><div className="sc-step-n">03</div><div className="sc-step-content"><b>Forced into games</b><span>Score drops. To recover, the wallet must prove it can actually play in real time.</span></div></div>
                <div className="sc-step"><div className="sc-step-n">04</div><div className="sc-step-content"><b>Game performance fails</b><span>Bots can't ace skill games at scale. Cluster scores collapse together.</span></div></div>
                <div className="sc-step"><div className="sc-step-n">05</div><div className="sc-step-content"><b>Permanently filtered</b><span>The whole cluster is excluded from drops, governance, and gated rewards — for good.</span></div></div>
              </div>
              <div className="sc-result"><div className="sc-result-tag">Outcome</div>Cluster eliminated · Drops protected · Trust restored</div>
            </div>
            <div className="sc-track good reveal">
              <div className="sc-track-head">
                <div className="sc-track-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polyline points="8 12 11 15 16 9" /></svg></div>
                <div><h4>The Human Path</h4><div className="sub">Real player · Earned reputation</div></div>
              </div>
              <div className="sc-steps">
                <div className="sc-step"><div className="sc-step-n">01</div><div className="sc-step-content"><b>Connects one wallet</b><span>Real on-chain history — genuine transactions and real time spent on Solana.</span></div></div>
                <div className="sc-step"><div className="sc-step-n">02</div><div className="sc-step-content"><b>Initial scan</b><span>The Prism reads the full on-chain story and assigns a starting score and tier.</span></div></div>
                <div className="sc-step"><div className="sc-step-n">03</div><div className="sc-step-content"><b>Plays the games</b><span>Orbit Survival, Cosmic Defender, Gravity Runner — skill-based, time-based, replayable.</span></div></div>
                <div className="sc-step"><div className="sc-step-n">04</div><div className="sc-step-content"><b>Score grows</b><span>Performance lifts the score. Streaks unlock badges. Tier rises through the planets.</span></div></div>
                <div className="sc-step"><div className="sc-step-n">05</div><div className="sc-step-content"><b>Reputation cleared</b><span>Verified human. Eligible for drops, governance, and gated experiences across the ecosystem.</span></div></div>
              </div>
              <div className="sc-result"><div className="sc-result-tag">Outcome</div>Verified human · Reputation portable · Earned, not bought</div>
            </div>
          </div>
        </div>
      </section>

      <div className="sec-divider"><div className="ribbon">— On-Chain Badges —</div></div>

      {/* BADGES — match dapp categories exactly */}
      <section id="badges">
        <div className="container">
          <div className="sec-head reveal">
            <div className="sec-tag">20 on-chain badges</div>
            <h2 className="sec-title">Proof of you,<br />signed by the chain.</h2>
            <p className="sec-sub">Badges are auto-awarded by reading your wallet's on-chain history, game performance, and community contribution. Six categories — each a different shade of trust.</p>
          </div>

          <div className="badges-cats">

            {/* ON-CHAIN (gold) */}
            <div className="badge-cat reveal">
              <div className="badge-cat-head">
                <div className="badge-cat-title">
                  <div className="pip" style={{ background: '#d4a04a', boxShadow: '0 0 8px #d4a04a' }}></div>
                  <h4>On-Chain</h4><span className="meta">· Wallet history &amp; activity</span>
                </div>
                <div className="badge-cat-count">5 Badges</div>
              </div>
              <div className="badges-row reveal-stagger" style={{ ['--cat-c1' as string]: '#d4a04a', ['--cat-c2' as string]: '#7c5a1a', ['--cat-glow' as string]: 'rgba(212,160,74,.4)', ['--cat-bg' as string]: 'linear-gradient(160deg,rgba(124,90,26,.4),rgba(124,90,26,.12))', ['--cat-border' as string]: 'rgba(212,160,74,.25)', ['--cat-border-hover' as string]: 'rgba(212,160,74,.6)' } as React.CSSProperties}>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/early_adopter.png" alt="" /></div><div className="name">Early Bird</div><div className="desc">Wallet ≥ 1 year</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/veteran.png" alt="" /></div><div className="name">Veteran</div><div className="desc">2yrs &amp; 1K+ tx</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/whale.png" alt="" /></div><div className="name">Whale</div><div className="desc">≥ 50 SOL</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/nft_collector.png" alt="" /></div><div className="name">NFT Collector</div><div className="desc">≥ 10 NFTs</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/defi_architect.png" alt="" /></div><div className="name">DeFi Architect</div><div className="desc">3+ protocols</div></div>
              </div>
            </div>

            {/* TRUST (cyan) */}
            <div className="badge-cat reveal">
              <div className="badge-cat-head">
                <div className="badge-cat-title">
                  <div className="pip" style={{ background: '#4ac8e8', boxShadow: '0 0 8px #4ac8e8' }}></div>
                  <h4>Trust</h4><span className="meta">· Sybil-resistance &amp; integrity</span>
                </div>
                <div className="badge-cat-count">3 Badges</div>
              </div>
              <div className="badges-row reveal-stagger" style={{ ['--cat-c1' as string]: '#4ac8e8', ['--cat-c2' as string]: '#0e7490', ['--cat-glow' as string]: 'rgba(74,200,232,.4)', ['--cat-bg' as string]: 'linear-gradient(160deg,rgba(22,78,99,.4),rgba(22,78,99,.12))', ['--cat-border' as string]: 'rgba(74,200,232,.25)', ['--cat-border-hover' as string]: 'rgba(74,200,232,.6)' } as React.CSSProperties}>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/verified_human.png" alt="" /></div><div className="name">Verified Human</div><div className="desc">Trust ≥ 80</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/clean_record.png" alt="" /></div><div className="name">Clean Record</div><div className="desc">Risk &lt; 10</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/trust_pillar.png" alt="" /></div><div className="name">Trust Pillar</div><div className="desc">Trust ≥ 95</div></div>
              </div>
            </div>

            {/* GAMES (green) */}
            <div className="badge-cat reveal">
              <div className="badge-cat-head">
                <div className="badge-cat-title">
                  <div className="pip" style={{ background: '#34d399', boxShadow: '0 0 8px #34d399' }}></div>
                  <h4>Games</h4><span className="meta">· Skill proven in real-time</span>
                </div>
                <div className="badge-cat-count">3 Badges</div>
              </div>
              <div className="badges-row reveal-stagger" style={{ ['--cat-c1' as string]: '#34d399', ['--cat-c2' as string]: '#065f46', ['--cat-glow' as string]: 'rgba(52,211,153,.4)', ['--cat-bg' as string]: 'linear-gradient(160deg,rgba(6,95,70,.4),rgba(6,95,70,.12))', ['--cat-border' as string]: 'rgba(52,211,153,.25)', ['--cat-border-hover' as string]: 'rgba(52,211,153,.6)' } as React.CSSProperties}>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/game_master.png" alt="" /></div><div className="name">Game Master</div><div className="desc">3+ game types</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/achievement_hunter.png" alt="" /></div><div className="name">Achievement Hunter</div><div className="desc">10+ achievements</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/high_scorer.png" alt="" /></div><div className="name">High Scorer</div><div className="desc">Score ≥ 40</div></div>
              </div>
            </div>

            {/* IDENTITY PRISM (purple) */}
            <div className="badge-cat reveal">
              <div className="badge-cat-head">
                <div className="badge-cat-title">
                  <div className="pip" style={{ background: '#a78bfa', boxShadow: '0 0 8px #a78bfa' }}></div>
                  <h4>Identity Prism</h4><span className="meta">· Native holders &amp; OGs</span>
                </div>
                <div className="badge-cat-count">3 Badges</div>
              </div>
              <div className="badges-row reveal-stagger" style={{ ['--cat-c1' as string]: '#a78bfa', ['--cat-c2' as string]: '#6d28d9', ['--cat-glow' as string]: 'rgba(167,139,250,.4)', ['--cat-bg' as string]: 'linear-gradient(160deg,rgba(88,28,135,.4),rgba(88,28,135,.12))', ['--cat-border' as string]: 'rgba(167,139,250,.25)', ['--cat-border-hover' as string]: 'rgba(167,139,250,.6)' } as React.CSSProperties}>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/seeker.png" alt="" /></div><div className="name">Seeker of Truth</div><div className="desc">Holds Seeker NFT</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/visionary.png" alt="" /></div><div className="name">Visionary</div><div className="desc">Pre-launch believer</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/binary.png" alt="" /></div><div className="name">Binary Sun</div><div className="desc">Dual-star combo</div></div>
              </div>
            </div>

            {/* SOCIAL (red) */}
            <div className="badge-cat reveal">
              <div className="badge-cat-head">
                <div className="badge-cat-title">
                  <div className="pip" style={{ background: '#ef4444', boxShadow: '0 0 8px #ef4444' }}></div>
                  <h4>Social</h4><span className="meta">· PvP &amp; community signal</span>
                </div>
                <div className="badge-cat-count">2 Badges</div>
              </div>
              <div className="badges-row reveal-stagger" style={{ ['--cat-c1' as string]: '#ef4444', ['--cat-c2' as string]: '#991b1b', ['--cat-glow' as string]: 'rgba(239,68,68,.4)', ['--cat-bg' as string]: 'linear-gradient(160deg,rgba(127,29,29,.4),rgba(127,29,29,.12))', ['--cat-border' as string]: 'rgba(239,68,68,.25)', ['--cat-border-hover' as string]: 'rgba(239,68,68,.6)' } as React.CSSProperties}>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/arena_champion.png" alt="" /></div><div className="name">Arena Champion</div><div className="desc">5+ duels won</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/debate_king.png" alt="" /></div><div className="name">Sybil Hunter</div><div className="desc">5+ community reviews</div></div>
              </div>
            </div>

            {/* ENGAGEMENT (pink) */}
            <div className="badge-cat reveal">
              <div className="badge-cat-head">
                <div className="badge-cat-title">
                  <div className="pip" style={{ background: '#f472b6', boxShadow: '0 0 8px #f472b6' }}></div>
                  <h4>Engagement</h4><span className="meta">· Quests, streaks &amp; exploration</span>
                </div>
                <div className="badge-cat-count">4 Badges</div>
              </div>
              <div className="badges-row reveal-stagger" style={{ ['--cat-c1' as string]: '#f472b6', ['--cat-c2' as string]: '#9d174d', ['--cat-glow' as string]: 'rgba(244,114,182,.4)', ['--cat-bg' as string]: 'linear-gradient(160deg,rgba(131,24,67,.4),rgba(131,24,67,.12))', ['--cat-border' as string]: 'rgba(244,114,182,.25)', ['--cat-border-hover' as string]: 'rgba(244,114,182,.6)' } as React.CSSProperties}>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/quest_hunter.png" alt="" /></div><div className="name">Quest Master</div><div className="desc">15+ quests done</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/quest_hunter.png" alt="" /></div><div className="name">Quest Hunter</div><div className="desc">10+ quests done</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/streak_lord.png" alt="" /></div><div className="name">Streak Lord</div><div className="desc">7-day streak</div></div>
                <div className="badge-card"><div className="img-wrap"><img src="/landing/badges/explorer.png" alt="" /></div><div className="name">Explorer</div><div className="desc">20+ wallet scans</div></div>
              </div>
            </div>

          </div>
        </div>
      </section>

      <div className="sec-divider"><div className="ribbon">— Composite Tier System —</div></div>

      {/* TIERS — correct thresholds, no spinning planets */}
      <section id="tiers">
        <div className="container">
          <div className="sec-head reveal">
            <div className="sec-tag">From Mercury to Binary Sun</div>
            <h2 className="sec-title">Ten planets.<br />Score-based.</h2>
            <p className="sec-sub">Your composite score lands you on one of ten planets. Score caps at 1,000 — Binary Sun is the absolute pinnacle of on-chain reputation.</p>
          </div>

          <div className="tier-meter reveal">
            <div className="tier-meter-label"><b>Composite Score</b> · 0 — 1,000</div>
            <div className="tier-bar"></div>
            <div className="tier-scale"><span>0</span><span>220</span><span>480</span><span>700</span><span>880</span><span>1000</span></div>
          </div>

          <div className="tiers-grid reveal-stagger">
            <div className="tier-card" style={{ ['--tier-c' as string]: '#b4a995' } as React.CSSProperties}><div className="planet"><img src="/landing/textures/tiers/mercury.png" alt="" /></div><div className="tname">Mercury</div><div className="trange">0 — 99</div></div>
            <div className="tier-card" style={{ ['--tier-c' as string]: '#ff6b4a' } as React.CSSProperties}><div className="planet"><img src="/landing/textures/tiers/mars.png" alt="" /></div><div className="tname">Mars</div><div className="trange">100 — 219</div></div>
            <div className="tier-card" style={{ ['--tier-c' as string]: '#ffd166' } as React.CSSProperties}><div className="planet"><img src="/landing/textures/tiers/venus.png" alt="" /></div><div className="tname">Venus</div><div className="trange">220 — 349</div></div>
            <div className="tier-card" style={{ ['--tier-c' as string]: '#5fa8ff' } as React.CSSProperties}><div className="planet"><img src="/landing/textures/tiers/earth.png" alt="" /></div><div className="tname">Earth</div><div className="trange">350 — 479</div></div>
            <div className="tier-card" style={{ ['--tier-c' as string]: '#4cc9f0' } as React.CSSProperties}><div className="planet"><img src="/landing/textures/tiers/neptune.png" alt="" /></div><div className="tname">Neptune</div><div className="trange">480 — 599</div></div>
            <div className="tier-card" style={{ ['--tier-c' as string]: '#80edff' } as React.CSSProperties}><div className="planet"><img src="/landing/textures/tiers/uranus.png" alt="" /></div><div className="tname">Uranus</div><div className="trange">600 — 699</div></div>
            <div className="tier-card" style={{ ['--tier-c' as string]: '#fcbf49' } as React.CSSProperties}><div className="planet"><img src="/landing/textures/tiers/saturn.png" alt="" /></div><div className="tname">Saturn</div><div className="trange">700 — 799</div></div>
            <div className="tier-card" style={{ ['--tier-c' as string]: '#f4a261' } as React.CSSProperties}><div className="planet"><img src="/landing/textures/tiers/jupiter.png" alt="" /></div><div className="tname">Jupiter</div><div className="trange">800 — 879</div></div>
            <div className="tier-card" style={{ ['--tier-c' as string]: '#ffdd99' } as React.CSSProperties}><div className="planet"><img src="/landing/textures/tiers/sun.png" alt="" /></div><div className="tname">Sun</div><div className="trange">880 — 949</div></div>
            <div className="tier-card" style={{ ['--tier-c' as string]: '#fffbe6' } as React.CSSProperties}><div className="planet"><img src="/landing/textures/tiers/binary_sun.png" alt="" /></div><div className="tname">Binary Sun</div><div className="trange">950 — 1000</div></div>
          </div>

          <div className="tiers-formula reveal">
            <h4>Composite Score · <b>Five Pillars</b></h4>
            <div className="formula-row">
              <div className="formula-cell"><div className="pct">40%</div><div className="lab">On-Chain</div></div>
              <div className="formula-cell"><div className="pct">25%</div><div className="lab">Trust</div></div>
              <div className="formula-cell"><div className="pct">15%</div><div className="lab">Games</div></div>
              <div className="formula-cell"><div className="pct">10%</div><div className="lab">Social</div></div>
              <div className="formula-cell"><div className="pct">10%</div><div className="lab">Engagement</div></div>
            </div>
            <div className="formula-eq">on-chain × 0.40 + trust × 0.25 + games × 0.15 + social × 0.10 + engagement × 0.10 = <span className="out">score / 1000</span></div>
          </div>
        </div>
      </section>

      <div className="sec-divider"><div className="ribbon">— Planet Reborn —</div></div>

      {/* EXPLODE / REBORN ANIMATION */}
      <section id="explode">
        <div className="container">
          <div className="sec-head reveal">
            <div className="sec-tag">Score is alive</div>
            <h2 className="sec-title">Tiers explode.<br />Tiers reform.</h2>
            <p className="sec-sub">Your tier isn't static. As your score climbs, planets shatter and reassemble into the next world. Every tier change is on-chain — and visually unmistakable.</p>
          </div>
          <div className="explode-stage reveal">
            <div className="explode-ring r1"></div>
            <div className="explode-ring r2"></div>
            <div className="explode-ring r3"></div>
            <div className="explode-planet"><img className="exp-saturn" src="/landing/textures/tiers/saturn.png" alt="Saturn" /><img className="exp-jupiter" src="/landing/textures/tiers/jupiter.png" alt="Jupiter" /></div>
            <div className="explode-shard"></div><div className="explode-shard"></div><div className="explode-shard"></div>
            <div className="explode-shard"></div><div className="explode-shard"></div><div className="explode-shard"></div>
            <div className="explode-shard"></div><div className="explode-shard"></div><div className="explode-shard"></div>
            <div className="explode-shard"></div><div className="explode-shard"></div><div className="explode-shard"></div>
            <div className="explode-label">Saturn (774) → <b>Jupiter (800)</b> · score threshold crossed</div>
          </div>
        </div>
      </section>

      <div className="sec-divider"><div className="ribbon">— Ranger Ranks (XP-Based) —</div></div>

      {/* RANGER RANKS — separate metric */}
      <section id="ranks">
        <div className="container">
          <div className="sec-head reveal">
            <div className="sec-tag">Earned through play</div>
            <h2 className="sec-title">Ranger Ranks.<br />The XP track.</h2>
            <p className="sec-sub">Different from your composite tier — Ranger Rank is an XP-based progression you earn by playing games and clearing quests. Unlocks gear, module slots, and exclusive content.</p>
          </div>

          <div className="ranks-intro reveal">
            <div className="ranks-vs">
              <h4>· Two Metrics ·</h4>
              <div className="ranks-vs-row">
                <span className="badge t">Composite</span>
                <div><b>Score 0 – 1000</b><span>Mercury → Binary Sun. Built from on-chain history, DeFi, trust, games &amp; social. Powers your tier and ship stats.</span></div>
              </div>
              <div className="ranks-vs-row">
                <span className="badge r">Ranger</span>
                <div><b>XP 0 – 50,000+</b><span>Cadet → Legend. Earned by playing games and completing quests. Unlocks gear, module slots &amp; ranked content.</span></div>
              </div>
            </div>
            <div className="ranks-vs" style={{ borderColor: 'rgba(96,165,250,.18)', background: 'linear-gradient(135deg,rgba(96,165,250,.05),rgba(34,211,238,.03))' }}>
              <h4 style={{ color: '#60a5fa' }}>· XP Sources ·</h4>
              <div className="ranks-vs-row"><span className="badge r">Games</span><div><b>~70% of XP</b><span>Skill-based play in Prism League — Orbit, Cosmic Defender, Gravity.</span></div></div>
              <div className="ranks-vs-row"><span className="badge r">Quests</span><div><b>~20% of XP</b><span>Daily &amp; weekly cosmic quests; lore-locked adventures.</span></div></div>
              <div className="ranks-vs-row"><span className="badge r">Other</span><div><b>~10% of XP</b><span>Achievements, streaks, social contributions.</span></div></div>
            </div>
          </div>

          <div className="ranks-grid reveal-stagger">
            <div className="rank-card" style={{ ['--rk-c' as string]: '#9ca3af' } as React.CSSProperties}><div className="badge-img"><img src="/landing/textures/ranks/rank_cadet.png" alt="" /></div><div className="rname">Cadet</div><div className="rxp">0 XP</div><div className="rperk">Starting rank · base gear</div></div>
            <div className="rank-card" style={{ ['--rk-c' as string]: '#60a5fa' } as React.CSSProperties}><div className="badge-img"><img src="/landing/textures/ranks/rank_pilot.png" alt="" /></div><div className="rname">Pilot</div><div className="rxp">1,500 XP</div><div className="rperk">Unlock text quests</div></div>
            <div className="rank-card" style={{ ['--rk-c' as string]: '#fbbf24' } as React.CSSProperties}><div className="badge-img"><img src="/landing/textures/ranks/rank_captain.png" alt="" /></div><div className="rname">Captain</div><div className="rxp">8,000 XP</div><div className="rperk">Yellow module slots</div></div>
            <div className="rank-card" style={{ ['--rk-c' as string]: '#a78bfa' } as React.CSSProperties}><div className="badge-img"><img src="/landing/textures/ranks/rank_ace.png" alt="" /></div><div className="rname">Ace</div><div className="rxp">25,000 XP</div><div className="rperk">Red module slots</div></div>
            <div className="rank-card" style={{ ['--rk-c' as string]: '#fde047' } as React.CSSProperties}><div className="badge-img"><img src="/landing/textures/ranks/rank_legend.png" alt="" /></div><div className="rname">Legend</div><div className="rxp">50,000+ XP</div><div className="rperk">Mastery — all systems</div></div>
          </div>
        </div>
      </section>

      <div className="sec-divider"><div className="ribbon">— Prism League · Skill Games —</div></div>

      {/* GAMES */}
      <section id="games">
        <div className="container">
          <div className="sec-head reveal">
            <div className="sec-tag">Prism League</div>
            <h2 className="sec-title">Skill is the proof.<br />Bots can't fake it.</h2>
            <p className="sec-sub">Real-time, reaction-based games. Real humans get high scores. Bots burn out. Every session is an on-chain attestation of your humanity — and the primary source of Ranger XP.</p>
          </div>
          <div className="games-grid reveal-stagger">
            <div className="game-card"><img src="/landing/games/orbit_cover.png" alt="" className="cover" /><div className="veil"></div><div className="body"><div className="pill">Live · Solo</div><h3>Orbit Survival</h3><p className="gdesc">Navigate asteroid fields. Reflexes &amp; reaction time scored in real-time.</p><div className="stats"><div className="stat"><b>Solo</b></div><div className="stat"><b>Realtime</b></div><div className="stat"><b>Reflex</b></div></div></div></div>
            <div className="game-card"><img src="/landing/games/wars_cover.png" alt="" className="cover" /><div className="veil"></div><div className="body"><div className="pill">Live · Solo</div><h3>Cosmic Defender</h3><p className="gdesc">Hold the line against relentless waves. Twitch aim &amp; survival under pressure.</p><div className="stats"><div className="stat"><b>Solo</b></div><div className="stat"><b>Waves</b></div><div className="stat"><b>Twitch</b></div></div></div></div>
            <div className="game-card"><img src="/landing/games/gravity_cover.png" alt="" className="cover" /><div className="veil"></div><div className="body"><div className="pill">Live · Solo</div><h3>Gravity Runner</h3><p className="gdesc">Physics-driven obstacle course. Pure motor skill — impossible to script.</p><div className="stats"><div className="stat"><b>Solo</b></div><div className="stat"><b>Physics</b></div><div className="stat"><b>Motor</b></div></div></div></div>
            <div className="game-card"><img src="/landing/games/quest_cover.png" alt="" className="cover" /><div className="veil"></div><div className="body"><div className="pill">Live · Story</div><h3>Text Adventures</h3><p className="gdesc">Choice-driven narrative missions. Strategy &amp; judgment — a different proof of human.</p><div className="stats"><div className="stat"><b>Solo</b></div><div className="stat"><b>Story</b></div><div className="stat"><b>Choices</b></div></div></div></div>
          </div>
        </div>
      </section>

      <div className="sec-divider"><div className="ribbon">— Ecosystem · Hub Modules —</div></div>

      {/* ECOSYSTEM — Stellar Mining & Constellation removed */}
      <section id="ecosystem">
        <div className="container">
          <div className="sec-head reveal">
            <div className="sec-tag">Hub modules</div>
            <h2 className="sec-title">An entire universe<br />around your identity.</h2>
            <p className="sec-sub">The Prism isn't a single page — it's a full hub of modules built around your reputation. Forge cosmetics. Lock vault stakes. Burn dust in the Black Hole. Fight in the Arena.</p>
          </div>
          <div className="eco-grid reveal-stagger">
            <div className="eco-card eco-c-scanner"><span className="eco-tag">Core</span><div className="eco-icon"><img src="/landing/hub/scanner.png" alt="" /></div><h3>Prism Scanner</h3><p>Analyze any Solana wallet. Composite score, full badge list, tier, age, behavior signals — all in one scan.</p><div className="eco-feats"><div className="eco-feat">Public &amp; private scans</div><div className="eco-feat">Snapshot history</div><div className="eco-feat">Compare wallets</div></div></div>
            <div className="eco-card eco-c-forge"><span className="eco-tag">Cosmetics</span><div className="eco-icon"><img src="/landing/hub/shop.png" alt="" /></div><h3>Stellar Forge</h3><p>Craft ship skins, frames, auras, and titles. Equip them on your identity card or your in-game ship. Rank-gated.</p><div className="eco-feats"><div className="eco-feat">50+ cosmetic items</div><div className="eco-feat">Ship stat boosts</div><div className="eco-feat">Tradeable as NFTs</div></div></div>
            <div className="eco-card eco-c-vault"><span className="eco-tag">Staking</span><div className="eco-icon"><img src="/landing/hub/vault.png" alt="" /></div><h3>Cosmic Vault</h3><p>Lock coins for 1 week — 6 months. Yield from 1× to 4× multiplier based on tier &amp; lock duration.</p><div className="eco-feats"><div className="eco-feat">Up to 4× multiplier</div><div className="eco-feat">Tier-boosted APY</div><div className="eco-feat">Compound on unlock</div></div></div>
            <div className="eco-card eco-c-blackhole"><span className="eco-tag">Burn</span><div className="eco-icon"><img src="/landing/hub/blackhole.png" alt="" /></div><h3>Black Hole</h3><p>Scan token accounts &amp; NFTs, protect high-signal assets, then burn or close the worthless dust to reclaim locked SOL rent.</p><div className="eco-feats"><div className="eco-feat">Reclaim SOL rent</div><div className="eco-feat">Protects key assets</div><div className="eco-feat">Burn / close dust</div></div></div>
            <div className="eco-card eco-c-arena"><span className="eco-tag">PvP</span><div className="eco-icon"><img src="/landing/hub/arena.png" alt="" /></div><h3>Wallet Arena</h3><p>1v1 wallet duels — score-vs-score brackets with real prize pools. Climb the ranks; win the season.</p><div className="eco-feats"><div className="eco-feat">Live brackets</div><div className="eco-feat">Seasonal champions</div><div className="eco-feat">On-chain payouts</div></div></div>
            <div className="eco-card eco-c-quests"><span className="eco-tag">Adventure</span><div className="eco-icon"><img src="/landing/hub/quests.png" alt="" /></div><h3>Cosmic Quests</h3><p>Daily &amp; weekly missions. Lore-locked adventure chains. The main path from Cadet to Pilot.</p><div className="eco-feats"><div className="eco-feat">Daily refresh</div><div className="eco-feat">Streak rewards</div><div className="eco-feat">Lore-locked badges</div></div></div>
            <div className="eco-card eco-c-leader"><span className="eco-tag">Compete</span><div className="eco-icon"><img src="/landing/hub/leaderboard.png" alt="" /></div><h3>Leaderboards</h3><p>Global rankings across every game, every badge category, every tier. Friends list &amp; rivals.</p><div className="eco-feats"><div className="eco-feat">Global &amp; friends</div><div className="eco-feat">Per-game boards</div><div className="eco-feat">Seasonal resets</div></div></div>
            <div className="eco-card eco-c-league"><span className="eco-tag">Skill</span><div className="eco-icon"><img src="/landing/hub/league.png" alt="" /></div><h3>Prism League</h3><p>The home of all skill games. Orbit Survival, Cosmic Defender, Gravity Runner &amp; Text Adventures in active rotation.</p><div className="eco-feats"><div className="eco-feat">4 live games</div><div className="eco-feat">Active rotation</div><div className="eco-feat">XP attestation</div></div></div>
          </div>
        </div>
      </section>

      <div className="sec-divider"><div className="ribbon">— Deflationary Engine —</div></div>

      {/* BLACK HOLE feature */}
      <section id="blackhole-feature">
        <div className="container">
          <div className="bh-feature reveal">
            <div className="bh-visual" aria-hidden="true">
              <div className="blackhole-visual">
                <div className="blackhole-glow" />
                <div className="blackhole-warp" />
                <div className="blackhole-jet blackhole-jet--north" />
                <div className="blackhole-jet blackhole-jet--south" />
                <div className="blackhole-accretion" />
                <div className="blackhole-ring" />
                <div className="blackhole-photon" />
                <div className="blackhole-lens" />
                <div className="blackhole-shadow" />
                <div className="blackhole-core" />
              </div>
            </div>
            <div className="bh-copy">
              <div className="sec-tag warn">The Black Hole</div>
              <h2 className="sec-title">Reclaim rent.<br />Sweep the dust.</h2>
              <p className="sec-sub">The Black Hole scans your token accounts and NFTs, protects your Identity Prism and other high-signal assets, then burns or closes the worthless dust — returning the SOL rent locked inside those empty accounts back to your wallet. Identity Prism holders pay just 2% commission on reclaimed rent, versus the 10% standard rate.</p>
              <div className="bh-stats">
                <div className="bh-stat"><b>Reclaim</b><span>locked SOL rent</span></div>
                <div className="bh-stat"><b>Protects</b><span>high-signal assets</span></div>
                <div className="bh-stat"><b>2% fee</b><span>for ID holders (10% std)</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="sec-divider"><div className="ribbon">— Get Started —</div></div>

      {/* CTA */}
      <section id="cta">
        <div className="container cta">
          <div className="cta-logo reveal-zoom"><img src="/landing/phav.png" alt="Identity Prism" /></div>
          <h2 className="reveal grad-cyan">Your reputation<br />starts now.</h2>
          <p className="cta-sub reveal">Connect your wallet. See your tier. Play the games. Carry your reputation across the entire Solana ecosystem.</p>
          <div className="cta-actions reveal">
            <a href="/identity" className="btn btn-primary lg">Identity Hub</a>
            <a href="/blackhole" className="btn btn-ghost lg">Black Hole</a>
            <a href="/sybil-check" className="btn btn-ghost lg">Sybil Checker</a>
          </div>
        </div>
      </section>

      <footer>
        <div className="container">
          <div className="foot-grid">
            <div className="foot-brand">
              <img src="/landing/phav.png" alt="" />
              <h5>IDENTITY PRISM</h5>
              <p>The sybil-resistant identity layer for Solana. Reputation earned through behavior &amp; skill, never bought, never sold.</p>
            </div>
            <div className="foot-col"><h6>Protocol</h6><a href="#solution">How it works</a><a href="#badges">Badges</a><a href="#tiers">Composite tiers</a><a href="#ranks">Ranger ranks</a><a href="#games">Prism League</a><a href="#ecosystem">Hub modules</a></div>
            <div className="foot-col"><h6>Resources</h6><a href="/identity">Launch app</a><a href="/whitepaper.html">Whitepaper</a><a href="/developers.html">API docs</a><a href="https://github.com/warninghejo-blip/identity-prism" target="_blank" rel="noopener noreferrer">GitHub</a><a href="/brand.html">Brand assets</a></div>
            <div className="foot-col"><h6>Legal</h6><a href="/privacy.html">Privacy Policy</a><a href="/terms.html">Terms of Use</a><a href="/cookies.html">Cookie Policy</a><a href="/disclaimer.html">Disclaimer</a></div>
          </div>
          <div className="foot-bottom">
            <div>© 2026 Identity Prism · All rights reserved</div>
            <div>Built on Solana · Powered by MagicBlock</div>
          </div>
        </div>
      </footer>
    </div>
    </>
  );
}
