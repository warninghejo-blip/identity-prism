/**
 * Haptic feedback utility for Capacitor native apps.
 * Falls back to no-op on web.
 */

let Haptics: any = null;
let HapticsImpactStyle: any = null;
let HapticsNotificationType: any = null;
let _loaded = false;

async function ensureLoaded() {
  if (_loaded) return;
  _loaded = true;
  try {
    const mod = await import('@capacitor/haptics');
    Haptics = mod.Haptics;
    HapticsImpactStyle = mod.ImpactStyle;
    HapticsNotificationType = mod.NotificationType;
  } catch {
    // Not available (web)
  }
}

// Preload on module import
ensureLoaded();

/** Light tap — button press, coin collect */
export async function hapticLight() {
  await ensureLoaded();
  try { await Haptics?.impact({ style: HapticsImpactStyle?.Light }); } catch {}
}

/** Medium tap — game event, achievement */
export async function hapticMedium() {
  await ensureLoaded();
  try { await Haptics?.impact({ style: HapticsImpactStyle?.Medium }); } catch {}
}

/** Heavy tap — explosion, death, collision */
export async function hapticHeavy() {
  await ensureLoaded();
  try { await Haptics?.impact({ style: HapticsImpactStyle?.Heavy }); } catch {}
}

/** Success notification — score saved, achievement claimed */
export async function hapticSuccess() {
  await ensureLoaded();
  try { await Haptics?.notification({ type: HapticsNotificationType?.Success }); } catch {}
}

/** Error notification — failed transaction */
export async function hapticError() {
  await ensureLoaded();
  try { await Haptics?.notification({ type: HapticsNotificationType?.Error }); } catch {}
}
