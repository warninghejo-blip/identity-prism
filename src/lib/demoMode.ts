export const DEMO_MODE_STORAGE_KEY = 'prism_demo_mode';

export function isDemoMode(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(DEMO_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDemoModeEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      window.sessionStorage.setItem(DEMO_MODE_STORAGE_KEY, '1');
    } else {
      window.sessionStorage.removeItem(DEMO_MODE_STORAGE_KEY);
    }
  } catch {
    /* session storage can be unavailable */
  }
}
