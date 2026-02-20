/* ══════════════════════════════════════════════════════════════
   Identity Prism — Scroll-telling Animations
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── 1. Starfield canvas ── */
  const canvas = document.getElementById('stars');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let w, h;
    const stars = [];
    const COUNT = 220;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < COUNT; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.3 + 0.2,
        base: Math.random() * 0.6 + 0.15,
        phase: Math.random() * Math.PI * 2,
        twinkle: Math.random() * 0.015 + 0.005,
        drift: Math.random() * 0.08 + 0.01,
      });
    }

    let t = 0;
    function drawStars() {
      ctx.clearRect(0, 0, w, h);
      t++;
      for (const s of stars) {
        const a = s.base + Math.sin(s.phase + t * s.twinkle) * 0.25;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, a)})`;
        ctx.fill();
        s.y += s.drift;
        if (s.y > h + 4) {
          s.y = -4;
          s.x = Math.random() * w;
        }
      }
      requestAnimationFrame(drawStars);
    }
    drawStars();
  }

  /* ── 2. Intersection Observer — reveal on scroll ── */
  const revealEls = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  revealEls.forEach((el) => observer.observe(el));

  /* ── 3. Smooth parallax for orbit & blackhole visuals ── */
  const parallaxEls = document.querySelectorAll('.orbit-visual, .bh-visual');
  if (parallaxEls.length) {
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          parallaxEls.forEach((el) => {
            const rect = el.getBoundingClientRect();
            const center = rect.top + rect.height / 2;
            const offset = (center - window.innerHeight / 2) * 0.04;
            el.style.transform = `translateY(${offset}px)`;
          });
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  /* ── 4. Tier dot hover (already CSS, but add touch support) ── */
  document.querySelectorAll('.tier-dot').forEach((dot) => {
    dot.addEventListener('touchstart', () => {
      document.querySelectorAll('.tier-dot').forEach((d) => d.classList.remove('active'));
      dot.classList.add('active');
    });
  });

  /* ── 5. Navbar auto-hide on scroll (optional future use) ── */

})();
