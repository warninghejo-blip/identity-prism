/**
 * fadeTransition — unit tests for overlay creation, fade sequence and cleanup.
 * Runs in jsdom — document/setTimeout available, rAF stubbed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startFadeTransition, fadeOutTransition } from '../fadeTransition';

beforeEach(() => {
  // Remove any leftover overlay
  document.getElementById('fade-overlay')?.remove();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.getElementById('fade-overlay')?.remove();
});

describe('startFadeTransition', () => {
  it('creates a fade-overlay element in document.body', () => {
    startFadeTransition(() => {});
    expect(document.getElementById('fade-overlay')).not.toBeNull();
  });

  it('sets overlay position to fixed and z-index high', () => {
    startFadeTransition(() => {});
    const el = document.getElementById('fade-overlay')!;
    expect(el.style.position).toBe('fixed');
    expect(Number(el.style.zIndex)).toBeGreaterThan(9999);
  });

  it('calls onNavigate after durationMs', () => {
    const onNavigate = vi.fn();
    startFadeTransition(onNavigate, 150);
    expect(onNavigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('removes existing overlay before creating a new one', () => {
    const old = document.createElement('div');
    old.id = 'fade-overlay';
    old.dataset.marker = 'old';
    document.body.appendChild(old);

    startFadeTransition(() => {});
    const current = document.getElementById('fade-overlay')!;
    expect(current.dataset.marker).toBeUndefined();
  });

  it('still removes overlay if onNavigate throws', () => {
    const throwing = vi.fn().mockImplementation(() => {
      throw new Error('nav error');
    });
    startFadeTransition(throwing, 100);
    vi.advanceTimersByTime(100);
    // Overlay should start fading out (opacity set to 0) even on error
    const el = document.getElementById('fade-overlay');
    if (el) {
      expect(el.style.opacity).toBe('0');
    }
    // The important thing is it didn't leave pointerEvents:'all' blocking the UI
    if (el) {
      expect(el.style.pointerEvents).toBe('none');
    }
  });
});

describe('fadeOutTransition', () => {
  it('fades out and removes overlay after delay', () => {
    // Place an overlay first
    const el = document.createElement('div');
    el.id = 'fade-overlay';
    el.style.opacity = '1';
    document.body.appendChild(el);

    // Stub rAF to call cb synchronously
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    fadeOutTransition(50);
    vi.advanceTimersByTime(50); // trigger setTimeout
    // After rAF, opacity should be 0 and pointerEvents none
    expect(el.style.opacity).toBe('0');
    expect(el.style.pointerEvents).toBe('none');

    vi.unstubAllGlobals();
  });

  it('does not throw when no overlay exists', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    expect(() => {
      fadeOutTransition(10);
      vi.advanceTimersByTime(10);
    }).not.toThrow();
    vi.unstubAllGlobals();
  });
});
