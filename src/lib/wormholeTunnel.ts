/**
 * Wormhole tunnel — WebGL shader-based transition.
 * Four modes:
 *   'blackhole'        — entering Black Hole (plasma wormhole)
 *   'blackhole-return' — returning from Black Hole (same plasma, reversed feel)
 *   'game'             — entering Prism League (starfield warp)
 *   'game-return'      — returning from game (starfield warp, warm tones)
 */

let _rafId = 0;
let _gl: WebGLRenderingContext | null = null;

/* ── Vertex shader — fullscreen quad ── */
const VERT = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

/* ── PREMIUM WORMHOLE — Black Hole forward (2.5s) ── */
const FRAG_BLACKHOLE = `
precision highp float;
uniform vec2 iResolution;
uniform float iTime;

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution) / iResolution.y;
    float r = length(uv);
    float a = atan(uv.y, uv.x);

    float cycle = clamp(iTime / 2.5, 0.0, 1.0);
    float accel = pow(cycle, 4.0);

    float z = 0.5 / max(r, 0.01) + iTime * 2.0 + accel * 10.0;
    float t = iTime * 3.0 + accel * 12.0;

    float v1 = sin(a * 3.0 + z * 2.0 - t);
    float v2 = cos(a * 5.0 - z * 3.0 + t * 1.5);
    float v3 = sin(a * 7.0 + z * 4.0 - t * 0.5);

    float intensity = (v1 + v2 + v3) / 3.0;
    intensity = smoothstep(0.0, 0.8, intensity);

    vec3 col = mix(vec3(0.05, 0.0, 0.15), vec3(0.4, 0.1, 0.8), intensity);
    col = mix(col, vec3(0.0, 0.8, 1.0), smoothstep(0.5, 1.0, intensity));
    col += vec3(0.8, 0.9, 1.0) * smoothstep(0.8, 1.0, intensity);

    float holeSize = 0.05 + accel * 0.05;
    float ring = smoothstep(holeSize + 0.1, holeSize, r) * smoothstep(holeSize - 0.02, holeSize + 0.05, r);
    col += vec3(0.6, 0.3, 1.0) * ring * (1.0 + accel * 5.0);

    col *= smoothstep(holeSize, holeSize + 0.15, r);
    col *= smoothstep(1.5, 0.3, r);

    float flash = smoothstep(0.85, 0.95, cycle);
    col += vec3(0.1, 0.8, 0.9) * flash * (0.05 / max(r, 0.01));
    col = mix(col, vec3(0.4, 0.9, 1.0), smoothstep(0.95, 1.0, cycle) * 0.85);

    gl_FragColor = vec4(col, 1.0);
}
`;

/* ── PREMIUM WORMHOLE — Black Hole return (2.5s) — same anim, purple-gold flash ── */
const FRAG_BLACKHOLE_RETURN = `
precision highp float;
uniform vec2 iResolution;
uniform float iTime;

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution) / iResolution.y;
    float r = length(uv);
    float a = atan(uv.y, uv.x);

    float cycle = clamp(iTime / 2.5, 0.0, 1.0);
    float accel = pow(cycle, 4.0);

    float z = 0.5 / max(r, 0.01) + iTime * 2.0 + accel * 10.0;
    float t = iTime * 3.0 + accel * 12.0;

    float v1 = sin(a * 3.0 + z * 2.0 - t);
    float v2 = cos(a * 5.0 - z * 3.0 + t * 1.5);
    float v3 = sin(a * 7.0 + z * 4.0 - t * 0.5);

    float intensity = (v1 + v2 + v3) / 3.0;
    intensity = smoothstep(0.0, 0.8, intensity);

    vec3 col = mix(vec3(0.05, 0.0, 0.15), vec3(0.4, 0.1, 0.8), intensity);
    col = mix(col, vec3(0.0, 0.8, 1.0), smoothstep(0.5, 1.0, intensity));
    col += vec3(0.8, 0.9, 1.0) * smoothstep(0.8, 1.0, intensity);

    float holeSize = 0.05 + accel * 0.05;
    float ring = smoothstep(holeSize + 0.1, holeSize, r) * smoothstep(holeSize - 0.02, holeSize + 0.05, r);
    col += vec3(0.6, 0.3, 1.0) * ring * (1.0 + accel * 5.0);

    col *= smoothstep(holeSize, holeSize + 0.15, r);
    col *= smoothstep(1.5, 0.3, r);

    float flash = smoothstep(0.85, 0.95, cycle);
    col += vec3(0.1, 0.8, 0.9) * flash * (0.05 / max(r, 0.01));
    col = mix(col, vec3(0.4, 0.9, 1.0), smoothstep(0.95, 1.0, cycle) * 0.85);

    gl_FragColor = vec4(col, 1.0);
}
`;

/* ── CLEAN STARFIELD WARP — Game forward (2.5s) ── */
const FRAG_GAME = `
precision highp float;
uniform vec2 iResolution;
uniform float iTime;

float hash(float n) { return fract(sin(n)*43758.5453123); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution) / iResolution.y;
    float r = length(uv);
    float a = atan(uv.y, uv.x);

    float cycle = clamp(iTime / 2.5, 0.0, 1.0);
    float accel = pow(cycle, 5.0);
    float speed = iTime * 0.5 + accel * 20.0;

    vec3 col = vec3(0.01, 0.015, 0.04);

    float coreGlow = 0.01 / max(r, 0.001);
    float coreDust = sin(a * 4.0 + iTime) * 0.5 + 0.5;
    vec3 coreColor = vec3(0.2, 0.6, 1.0) * coreGlow * (0.5 + coreDust * 0.2);
    coreColor *= 1.0 + accel * 5.0;
    col += coreColor;

    vec3 starsCol = vec3(0.0);
    for (float i = 0.0; i < 60.0; i++) {
        float angle = hash(i) * 6.2831;
        float z = fract(hash(i * 1.5) - speed * (0.1 + hash(i * 1.2) * 0.3));

        vec2 dir = vec2(cos(angle), sin(angle));
        vec2 pos = dir * (0.5 / max(z, 0.001));
        vec2 diff = uv - pos;

        float distAlong = dot(diff, dir);
        float distCross = length(diff - dir * distAlong);
        float streakLen = 0.015 + accel * 2.0 * (1.0 - z);

        float star = smoothstep(0.006, 0.0, distCross) * smoothstep(streakLen, 0.0, abs(distAlong));

        float brightness = smoothstep(1.0, 0.0, z);
        brightness *= smoothstep(0.0, 0.1, length(pos));

        vec3 sCol = mix(vec3(1.0), vec3(0.4, 0.8, 1.0), step(0.5, hash(i * 3.3)));
        starsCol += sCol * star * brightness;
    }

    col += starsCol;

    // Soft dim-out at the end — no bright flash
    float fadeOut = smoothstep(0.75, 1.0, cycle);
    col *= 1.0 - fadeOut * 0.92;

    gl_FragColor = vec4(col, 1.0);
}
`;

/* ── CLEAN STARFIELD WARP — Game return (2.5s, warm tones, decelerating) ── */
const FRAG_GAME_RETURN = `
precision highp float;
uniform vec2 iResolution;
uniform float iTime;

float hash(float n) { return fract(sin(n)*43758.5453123); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution) / iResolution.y;
    float r = length(uv);
    float a = atan(uv.y, uv.x);

    float cycle = clamp(iTime / 2.5, 0.0, 1.0);
    float accel = pow(cycle, 5.0);
    float speed = iTime * 0.5 + accel * 20.0;

    vec3 col = vec3(0.01, 0.015, 0.04);

    float coreGlow = 0.01 / max(r, 0.001);
    float coreDust = sin(a * 4.0 + iTime) * 0.5 + 0.5;
    vec3 coreColor = vec3(0.2, 0.6, 1.0) * coreGlow * (0.5 + coreDust * 0.2);
    coreColor *= 1.0 + accel * 5.0;
    col += coreColor;

    vec3 starsCol = vec3(0.0);
    for (float i = 0.0; i < 60.0; i++) {
        float angle = hash(i) * 6.2831;
        float z = fract(hash(i * 1.5) - speed * (0.1 + hash(i * 1.2) * 0.3));

        vec2 dir = vec2(cos(angle), sin(angle));
        vec2 pos = dir * (0.5 / max(z, 0.001));
        vec2 diff = uv - pos;

        float distAlong = dot(diff, dir);
        float distCross = length(diff - dir * distAlong);
        float streakLen = 0.015 + accel * 2.0 * (1.0 - z);

        float star = smoothstep(0.006, 0.0, distCross) * smoothstep(streakLen, 0.0, abs(distAlong));

        float brightness = smoothstep(1.0, 0.0, z);
        brightness *= smoothstep(0.0, 0.1, length(pos));

        vec3 sCol = mix(vec3(1.0), vec3(0.4, 0.8, 1.0), step(0.5, hash(i * 3.3)));
        starsCol += sCol * star * brightness;
    }

    col += starsCol;

    // Soft dim-out at the end — no bright flash
    float fadeOut = smoothstep(0.75, 1.0, cycle);
    col *= 1.0 - fadeOut * 0.92;

    gl_FragColor = vec4(col, 1.0);
}
`;

/* ── WebGL helpers ── */
function compileShader(gl: WebGLRenderingContext, src: string, type: number): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn('[WormholeTunnel] Shader compile error:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function createProgram(gl: WebGLRenderingContext, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vs = compileShader(gl, vertSrc, gl.VERTEX_SHADER);
  const fs = compileShader(gl, fragSrc, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[WormholeTunnel] Program link error:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

export type WormholeType = 'game' | 'blackhole' | 'game-return' | 'blackhole-return';

export function createWormholeTunnel(type: WormholeType = 'game'): HTMLElement {
  cancelAnimationFrame(_rafId);
  for (const id of ['wormhole-tunnel', 'bh-forward-blackout', 'bh-transition-veil']) {
    document.getElementById(id)?.remove();
  }

  const tunnel = document.createElement('div');
  tunnel.id = 'wormhole-tunnel';
  tunnel.style.cssText =
    'position:fixed;inset:0;z-index:999999;overflow:hidden;pointer-events:all;background:#010108';

  const W = window.innerWidth;
  const H = window.innerHeight;
  const mobile = W <= 768;
  const dpr = mobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);

  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;transform:translateZ(0)';
  tunnel.appendChild(canvas);
  document.body.appendChild(tunnel);

  // Try WebGL first, fallback to simple CSS animation
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
  if (!gl) {
    canvas.style.background = '#010108';
    return tunnel;
  }
  _gl = gl;

  const fragSrc =
    type === 'blackhole'        ? FRAG_BLACKHOLE :
    type === 'blackhole-return' ? FRAG_BLACKHOLE_RETURN :
    type === 'game-return'      ? FRAG_GAME_RETURN :
    FRAG_GAME;
  const program = createProgram(gl, VERT, fragSrc);
  if (!program) return tunnel;

  // Fullscreen quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  const posLoc = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  gl.useProgram(program);
  const resLoc  = gl.getUniformLocation(program, 'iResolution');
  const timeLoc = gl.getUniformLocation(program, 'iTime');

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(resLoc, canvas.width, canvas.height);

  const startTime = performance.now();
  const FRAME_MS = mobile ? 33 : 16;
  let lastTs = 0;

  function frame(now: number) {
    if (!document.getElementById('wormhole-tunnel')) return;
    if (now - lastTs < FRAME_MS) { _rafId = requestAnimationFrame(frame); return; }
    lastTs = now;

    const t = (now - startTime) / 1000;
    gl!.uniform1f(timeLoc, t);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

    _rafId = requestAnimationFrame(frame);
  }

  _rafId = requestAnimationFrame(frame);
  return tunnel;
}

export function fadeOutWormholeTunnel(delayMs = 400) {
  setTimeout(() => {
    cancelAnimationFrame(_rafId);
    const tunnel = document.getElementById('wormhole-tunnel');
    if (tunnel) {
      tunnel.style.transition = 'opacity 0.55s ease-out';
      tunnel.style.opacity = '0';
      setTimeout(() => {
        tunnel.remove();
        _gl = null;
      }, 650);
    }
    for (const id of ['bh-forward-blackout', 'bh-transition-veil']) {
      document.getElementById(id)?.remove();
    }
  }, delayMs);
}
