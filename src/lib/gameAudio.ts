/**
 * Game audio engine — procedural Web Audio API sound effects.
 * Call initAudio() from a user gesture (button click) to unlock.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let _ready = false;

/* ── Global SFX throttle — prevents audio node spam causing frame drops ── */
const _lastSfxTime: Record<string, number> = {};
function _throttled(key: string, minIntervalMs: number): boolean {
  const now = performance.now();
  const last = _lastSfxTime[key] || 0;
  if (now - last < minIntervalMs) return true; // skip
  _lastSfxTime[key] = now;
  return false;
}

/* ── Cached noise buffers — avoid allocating AudioBuffer every call ── */
const _noiseBufCache: Map<number, AudioBuffer> = new Map();
function _getCachedNoiseBuffer(dur: number): AudioBuffer | null {
  if (!ctx) return null;
  // Round to nearest 50ms for cache hit rate
  const key = Math.round(dur * 20);
  let buf = _noiseBufCache.get(key);
  if (!buf) {
    const bufSize = Math.floor(ctx.sampleRate * dur);
    buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    _noiseBufCache.set(key, buf);
  }
  return buf;
}

/* ── Init ────────────────────────────────────── */
export function initAudio() {
  if (ctx && _ready) return;
  if (!ctx) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();

      masterGain = ctx.createGain();
      masterGain.gain.value = 0.5;
      masterGain.connect(ctx.destination);

      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.45;
      sfxGain.connect(masterGain);

      musicGain = ctx.createGain();
      musicGain.gain.value = 0.0;
      musicGain.connect(masterGain);
    } catch {
      return;
    }
  }

  const doResume = () => {
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx
        .resume()
        .then(() => {
          _ready = true;
          _playConfirmBeep();
        })
        .catch(() => {});
    } else if (ctx.state === 'running') {
      if (!_ready) {
        _ready = true;
        _playConfirmBeep();
      }
    }
  };

  doResume();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(window as any).__audioUnlockAdded) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__audioUnlockAdded = true;
    const unlockEvents = ['click', 'touchstart', 'keydown', 'pointerdown'] as const;
    const removeUnlockListeners = () => {
      for (const evt of unlockEvents) {
        document.removeEventListener(evt, unlock);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__audioUnlockAdded = false;
    };
    const unlock = () => {
      if (ctx && ctx.state === 'suspended') {
        ctx
          .resume()
          .then(() => {
            _ready = true;
            removeUnlockListeners();
          })
          .catch(() => {});
      } else if (ctx && ctx.state === 'running') {
        _ready = true;
        removeUnlockListeners();
      }
    };
    for (const evt of unlockEvents) {
      document.addEventListener(evt, unlock, { passive: true });
    }
  }
}

function _playConfirmBeep() {
  if (!ctx || !sfxGain) return;
  try {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1200, t);
    o.frequency.exponentialRampToValueAtTime(800, t + 0.08);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(sfxGain);
    o.start(t);
    o.stop(t + 0.15);
  } catch {
    // ignore
  }
}

/* ── Core playback ───────────────────────────── */
function _sfx(): GainNode | null {
  if (!ctx || !sfxGain) return null;
  if (!_ready) {
    if (ctx.state === 'running') {
      _ready = true;
    } else return null;
  }
  return sfxGain;
}

function playTone(freq: number, dur: number, vol = 0.2, type: OscillatorType = 'sine') {
  const d = _sfx();
  if (!ctx || !d) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(d);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function playNoise(dur: number, vol = 0.15) {
  const d = _sfx();
  if (!ctx || !d) return;
  const buf = _getCachedNoiseBuffer(dur);
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2000;
  src.connect(filter).connect(g).connect(d);
  src.start(t);
}

function playFilteredTone(freq: number, dur: number, vol: number, type: OscillatorType, filterFreq: number) {
  const d = _sfx();
  if (!ctx || !d) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  f.type = 'lowpass';
  f.frequency.setValueAtTime(filterFreq, t);
  f.frequency.exponentialRampToValueAtTime(200, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(f).connect(g).connect(d);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/* ── Music stubs (music system removed — SFX only) ── */

export function startMusic(_mode: 'orbit' | 'defender' | 'menu' = 'menu') {
  // Music disabled — SFX only
}

/** Kill every running oscillator / scheduled node so nothing lingers after leaving the game */
export function stopAllAudio() {
  // Mute music gain — leave masterGain alone so SFX keep working
  if (ctx && musicGain) {
    const t = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(0, t);
  }
}

/* ── SFX ──── */
export function sfxPickup() {
  if (_throttled('pickup', 100)) return;
  playTone(880, 0.1, 0.2, 'sine');
  setTimeout(() => playTone(1320, 0.1, 0.15, 'sine'), 60);
}

export function sfxShield() {
  if (_throttled('shield', 200)) return;
  playTone(440, 0.15, 0.18, 'triangle');
  setTimeout(() => playTone(660, 0.15, 0.14, 'triangle'), 80);
}

/** Single bullet shot — quick laser zap with pitch sweep */
export function sfxShoot() {
  if (_throttled('shoot', 50)) return;
  const d = _sfx();
  if (!ctx || !d) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(1200, t);
  o.frequency.exponentialRampToValueAtTime(400, t + 0.06);
  g.gain.setValueAtTime(0.04, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 900;
  f.Q.value = 2;
  o.connect(f).connect(g).connect(d);
  o.start(t);
  o.stop(t + 0.1);
}

/** Double/dual shot — stereo laser burst */
export function sfxShootDouble() {
  if (_throttled('shootD', 50)) return;
  const d = _sfx();
  if (!ctx || !d) return;
  const t = ctx.currentTime;
  for (const freq of [1400, 900]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.35, t + 0.06);
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 800;
    f.Q.value = 1.5;
    o.connect(f).connect(g).connect(d);
    o.start(t);
    o.stop(t + 0.1);
  }
}

/** Rocket launch — low whoosh */
export function sfxShootRocket() {
  if (_throttled('rocket', 150)) return;
  playFilteredTone(120, 0.25, 0.08, 'sawtooth', 1200);
  playTone(300, 0.08, 0.04, 'triangle');
}

/** Enemy destroyed — crunch + low thud */
export function sfxEnemyDestroy() {
  if (_throttled('destroy', 250)) return;
  playNoise(0.18, 0.12);
  playFilteredTone(100, 0.2, 0.15, 'sawtooth', 800);
}

/** Player explosion — heavy asteroid impact */
export function sfxExplosion() {
  if (_throttled('explosion', 200)) return;
  playFilteredTone(45, 0.6, 0.25, 'sine', 400);
  playFilteredTone(70, 0.35, 0.18, 'sawtooth', 800);
  playNoise(0.25, 0.22);
  setTimeout(() => {
    playFilteredTone(35, 0.5, 0.15, 'sawtooth', 600);
    playNoise(0.35, 0.1);
  }, 60);
  setTimeout(() => {
    playNoise(0.2, 0.06);
    playTone(55, 0.3, 0.08, 'sine');
  }, 150);
}

export function sfxNearMiss() {
  if (_throttled('nearmiss', 80)) return;
  playTone(300, 0.1, 0.12, 'sine');
  setTimeout(() => playTone(500, 0.08, 0.1, 'sine'), 40);
}

export function sfxTap() {
  playTone(440, 0.04, 0.1, 'triangle');
}

export function sfxRevive() {
  playTone(440, 0.12, 0.15, 'sine');
  setTimeout(() => playTone(660, 0.12, 0.12, 'sine'), 100);
  setTimeout(() => playTone(880, 0.15, 0.1, 'sine'), 200);
}

/** Low rumble — intensity 0..1 */
export function sfxRumble(intensity: number) {
  if (_throttled('rumble', 120)) return;
  const vol = Math.min(intensity, 1) * 0.04;
  if (vol < 0.005) return;
  playTone(55 + intensity * 15, 0.15, vol, 'sine');
}

/** Debris crunch */
export function sfxDebris() {
  if (_throttled('debris', 100)) return;
  playNoise(0.12, 0.08);
  playTone(120, 0.06, 0.06, 'square');
}

/** Asteroid-asteroid collision */
export function sfxAsteroidHit(intensity: number = 0.5) {
  if (_throttled('ast_hit', 60)) return;
  const vol = Math.min(intensity, 1) * 0.06;
  if (vol < 0.005) return;
  playNoise(0.06, vol);
  playTone(90 + intensity * 40, 0.04, vol * 0.7, 'triangle');
}

/** Nuke activation — deep satisfying boom */
export function sfxNuke() {
  if (_throttled('nuke', 500)) return;
  playNoise(0.6, 0.2);
  playFilteredTone(40, 0.7, 0.25, 'sawtooth', 2000);
  playTone(80, 0.5, 0.15, 'sine');
  setTimeout(() => {
    playNoise(0.3, 0.1);
    playTone(30, 0.4, 0.1, 'sine');
  }, 100);
}

/** Level up — ascending chime */
export function sfxLevelUp() {
  playTone(523.3, 0.12, 0.12, 'sine');
  setTimeout(() => playTone(659.3, 0.12, 0.11, 'sine'), 80);
  setTimeout(() => playTone(784.0, 0.12, 0.1, 'sine'), 160);
  setTimeout(() => playTone(1047, 0.2, 0.1, 'sine'), 240);
}

/** Boss appears — ominous low warning */
export function sfxBossAppear() {
  playFilteredTone(55, 0.8, 0.18, 'sawtooth', 600);
  playTone(110, 0.3, 0.1, 'triangle');
  setTimeout(() => playFilteredTone(65, 0.6, 0.12, 'sawtooth', 400), 300);
  setTimeout(() => playTone(82.4, 0.4, 0.1, 'triangle'), 500);
}

/** Game over — descending sad tones */
export function sfxGameOver() {
  playTone(440, 0.2, 0.12, 'triangle');
  setTimeout(() => playTone(370, 0.2, 0.11, 'triangle'), 200);
  setTimeout(() => playTone(330, 0.25, 0.1, 'triangle'), 400);
  setTimeout(() => playTone(262, 0.4, 0.1, 'sine'), 650);
}

/** Victory fanfare */
export function sfxVictory() {
  const notes = [523.3, 659.3, 784.0, 1047, 784.0, 1047, 1318.5];
  const times = [0, 120, 240, 380, 500, 600, 720];
  notes.forEach((freq, i) => {
    setTimeout(() => {
      playTone(freq, 0.25, 0.18, 'sine');
      if (i === notes.length - 1) {
        setTimeout(() => playTone(freq, 0.35, 0.15, 'sine'), 80);
      }
    }, times[i]);
  });
}
