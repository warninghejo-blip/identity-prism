/**
 * Game audio engine — procedural Web Audio API sounds + background music.
 * Call initAudio() from a user gesture (button click) to unlock.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let _ready = false;
let _musicPlaying = false;
let _musicNodes: (OscillatorNode | AudioBufferSourceNode)[] = [];
let _musicGains: GainNode[] = [];
let _currentTrack = '';

const LOG = (msg: string, ...args: unknown[]) => console.log(`[audio] ${msg}`, ...args);

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
  LOG('initAudio called');
  if (!ctx) {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) { LOG('No AudioContext available!'); return; }
      ctx = new AC();
      LOG('AudioContext created, state:', ctx.state, 'sampleRate:', ctx.sampleRate);

      masterGain = ctx.createGain();
      masterGain.gain.value = 0.5;
      masterGain.connect(ctx.destination);

      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.45;
      sfxGain.connect(masterGain);

      musicGain = ctx.createGain();
      musicGain.gain.value = 0.0;
      musicGain.connect(masterGain);
    } catch (e) {
      LOG('Failed to create AudioContext:', e);
      return;
    }
  }

  const doResume = () => {
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        _ready = true;
        LOG('Context resumed, state:', ctx?.state);
        _playConfirmBeep();
      }).catch(e => LOG('Resume failed:', e));
    } else if (ctx.state === 'running') {
      if (!_ready) { _ready = true; _playConfirmBeep(); }
    }
  };

  doResume();

  if (!(window as any).__audioUnlockAdded) {
    (window as any).__audioUnlockAdded = true;
    const unlockEvents = ['click', 'touchstart', 'keydown', 'pointerdown'] as const;
    const removeUnlockListeners = () => {
      for (const evt of unlockEvents) {
        document.removeEventListener(evt, unlock);
      }
      (window as any).__audioUnlockAdded = false;
      LOG('Unlock listeners removed');
    };
    const unlock = () => {
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().then(() => { _ready = true; LOG('Unlocked via gesture'); removeUnlockListeners(); }).catch(() => {});
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
    LOG('Confirm beep at t=', t.toFixed(2));
  } catch (e) {
    LOG('Confirm beep error:', e);
  }
}

/* ── Core playback ───────────────────────────── */
function _sfx(): GainNode | null {
  if (!ctx || !sfxGain) return null;
  if (!_ready) {
    if (ctx.state === 'running') { _ready = true; }
    else return null;
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

/* ═══════════════════════════════════════════════════
   Background Music — multiple cosmic tracks, per mode
   ═══════════════════════════════════════════════════ */

// Track definitions — each has a chord, scale, BPM, and feel
interface TrackDef {
  name: string;
  bpm: number;
  padNotes: number[];    // sustained pad chord (low freqs)
  padType: OscillatorType;
  scale: number[];       // arpeggio note pool
  arpType: OscillatorType;
  arpPattern: number[];  // indices into scale
  padVol: number;
  arpVol: number;
}

// ── ALL TRACKS ──────────────────────────────────────
// Each mode has multiple variants; one is picked at random each session.
// To add your own: just append a new TrackDef to the appropriate array.
// File location: src/lib/gameAudio.ts

const ORBIT_TRACKS: TrackDef[] = [
  {
    name: 'Stellar Drift',
    bpm: 88,
    padNotes: [130.8, 164.8, 196.0], // C3 E3 G3
    padType: 'sine',
    scale: [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3, 659.3],
    arpType: 'sine',
    arpPattern: [0, 2, 4, 7, 4, 2, 5, 3],
    padVol: 0.018,
    arpVol: 0.08,
  },
  {
    name: 'Nebula Waltz',
    bpm: 76,
    padNotes: [146.8, 174.6, 220.0], // D3 F3 A3
    padType: 'sine',
    scale: [293.7, 349.2, 392.0, 440.0, 523.3, 587.3, 659.3, 784.0],
    arpType: 'sine',
    arpPattern: [0, 3, 5, 2, 7, 4, 6, 1],
    padVol: 0.018,
    arpVol: 0.07,
  },
  {
    name: 'Deep Space Lullaby',
    bpm: 66,
    padNotes: [116.5, 146.8, 174.6], // Bb2 D3 F3
    padType: 'sine',
    scale: [233.1, 261.6, 293.7, 349.2, 392.0, 466.2, 523.3, 587.3],
    arpType: 'sine',
    arpPattern: [0, 4, 1, 5, 3, 7, 2, 6],
    padVol: 0.016,
    arpVol: 0.065,
  },
];

const DEFENDER_TRACKS: TrackDef[] = [
  {
    name: 'Battle Horizon',
    bpm: 110,
    padNotes: [110.0, 146.8, 164.8], // A2 D3 E3
    padType: 'triangle',
    scale: [220.0, 261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3],
    arpType: 'triangle',
    arpPattern: [0, 3, 5, 7, 6, 4, 2, 1],
    padVol: 0.016,
    arpVol: 0.07,
  },
  {
    name: 'Ion Storm',
    bpm: 120,
    padNotes: [123.5, 155.6, 185.0], // B2 Eb3 F#3
    padType: 'triangle',
    scale: [246.9, 293.7, 329.6, 370.0, 440.0, 493.9, 554.4, 659.3],
    arpType: 'square',
    arpPattern: [0, 5, 2, 7, 1, 6, 3, 4],
    padVol: 0.014,
    arpVol: 0.06,
  },
  {
    name: 'Plasma Drive',
    bpm: 100,
    padNotes: [98.0, 130.8, 155.6], // G2 C3 Eb3
    padType: 'triangle',
    scale: [196.0, 233.1, 261.6, 311.1, 349.2, 392.0, 466.2, 523.3],
    arpType: 'triangle',
    arpPattern: [0, 2, 5, 3, 7, 1, 6, 4],
    padVol: 0.016,
    arpVol: 0.065,
  },
];

const MENU_TRACKS: TrackDef[] = [
  {
    name: 'Cosmic Overture',
    bpm: 72,
    padNotes: [98.0, 130.8, 164.8, 196.0], // G2 C3 E3 G3
    padType: 'sine',
    scale: [196.0, 261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 659.3],
    arpType: 'sine',
    arpPattern: [0, 4, 2, 6, 3, 7, 5, 1],
    padVol: 0.016,
    arpVol: 0.07,
  },
  {
    name: 'Astral Gateway',
    bpm: 80,
    padNotes: [110.0, 138.6, 164.8, 220.0], // A2 C#3 E3 A3
    padType: 'sine',
    scale: [220.0, 277.2, 329.6, 370.0, 440.0, 554.4, 659.3, 740.0],
    arpType: 'sine',
    arpPattern: [0, 2, 4, 6, 7, 5, 3, 1],
    padVol: 0.016,
    arpVol: 0.07,
  },
];

const MODE_TRACKS: Record<string, TrackDef[]> = {
  orbit: ORBIT_TRACKS,
  defender: DEFENDER_TRACKS,
  menu: MENU_TRACKS,
};

function pickRandom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export function startMusic(_mode: 'orbit' | 'defender' | 'menu' = 'menu') {
  // Music disabled — SFX only
}

let _arpTimer: ReturnType<typeof setTimeout> | null = null;
let _arpStep = 0;

function _scheduleArpeggio(startTime: number, track: TrackDef) {
  if (!_musicPlaying || !ctx || !musicGain) return;
  const beatDur = 60 / track.bpm;
  const pat = [...track.arpPattern];
  const noteDur = beatDur * 0.65;

  // Shift pattern every 4 bars for variety
  if (_arpStep % 4 === 1) pat.reverse();
  else if (_arpStep % 4 === 2) { const h = pat.splice(0, 4); pat.push(...h); }
  else if (_arpStep % 4 === 3) { pat.reverse(); const h = pat.splice(0, 4); pat.push(...h); }

  for (let i = 0; i < pat.length; i++) {
    const noteTime = startTime + i * beatDur;
    if (noteTime < (ctx?.currentTime ?? 0) - 0.1) continue;
    const freq = track.scale[pat[i] % track.scale.length];
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = track.arpType;
    o.frequency.setValueAtTime(freq, noteTime);
    g.gain.setValueAtTime(0, noteTime);
    g.gain.linearRampToValueAtTime(track.arpVol, noteTime + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, noteTime + noteDur);
    o.connect(g).connect(musicGain!);
    o.start(noteTime);
    o.stop(noteTime + noteDur + 0.05);
  }

  const barDur = pat.length * beatDur;
  _arpStep++;
  _arpTimer = setTimeout(() => {
    if (ctx && _musicPlaying) {
      _scheduleArpeggio(ctx.currentTime + 0.05, track);
    }
  }, barDur * 1000 - 100);
}

function _stopMusicImmediate() {
  _musicPlaying = false;
  if (_arpTimer) { clearTimeout(_arpTimer); _arpTimer = null; }
  for (const o of _musicNodes) { try { o.stop(); } catch {} }
  _musicNodes = [];
  _musicGains = [];
  _arpStep = 0;
}

export function stopMusic() {
  // Music disabled — no-op
}

/** Kill every running oscillator / scheduled node so nothing lingers after leaving the game */
export function stopAllAudio() {
  _musicPlaying = false;
  _currentTrack = '';
  if (_arpTimer) { clearTimeout(_arpTimer); _arpTimer = null; }
  for (const o of _musicNodes) { try { o.stop(); } catch {} }
  _musicNodes = [];
  _musicGains = [];
  _arpStep = 0;
  // Mute music gain only — leave masterGain alone so SFX keep working
  if (ctx && musicGain) {
    const t = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(0, t);
  }
}

/* ── SFX (all volumes halved from previous) ──── */
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
  f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2;
  o.connect(f).connect(g).connect(d);
  o.start(t); o.stop(t + 0.1);
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
    f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 1.5;
    o.connect(f).connect(g).connect(d);
    o.start(t); o.stop(t + 0.1);
  }
}

/** Rocket launch — low whoosh */
export function sfxShootRocket() {
  if (_throttled('rocket', 150)) return;
  playFilteredTone(120, 0.25, 0.08, 'sawtooth', 1200);
  playTone(300, 0.08, 0.04, 'triangle');
}

/** Enemy hit — metallic ping */
export function sfxHit() {
  if (_throttled('hit', 60)) return;
  playTone(200, 0.08, 0.15, 'sawtooth');
}

/** Enemy destroyed — crunch + low thud (more impactful than just a hit) */
export function sfxEnemyDestroy() {
  if (_throttled('destroy', 250)) return;
  playNoise(0.18, 0.12);
  playFilteredTone(100, 0.2, 0.15, 'sawtooth', 800);
}

/** Player explosion — heavy asteroid impact: deep thud + rock crunch + debris */
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

/** Low rumble — intensity 0..1 (soft sine, not harsh) */
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

/** Asteroid-asteroid collision — short rocky clunk, volume scales with impact */
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

/** Victory fanfare — triumphant ascending phrase for completing all levels */
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
