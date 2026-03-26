/**
 * Firebase Authentication — Twitter/X sign-in for Trust Recovery.
 * Uses Google Identity Platform (50K MAU free).
 * Uses redirect flow (popup blocked by some antivirus CSP rules).
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, TwitterAuthProvider } from 'firebase/auth';

function getFirebaseApp() {
  if (getApps().length > 0) return getApp();
  return initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  });
}

export interface TwitterProfile {
  userId: string;
  username: string;
  displayName: string;
  photoURL: string | null;
}

function extractProfile(result: import('firebase/auth').UserCredential): TwitterProfile {
  const twitterData = result.user.providerData.find((p) => p.providerId === 'twitter.com');
  if (!twitterData) throw new Error('Twitter provider data not found');
  return {
    userId: twitterData.uid,
    username: (twitterData.displayName || '').replace(/\s/g, '') || twitterData.uid,
    displayName: result.user.displayName || twitterData.displayName || '',
    photoURL: result.user.photoURL || twitterData.photoURL || null,
  };
}

/**
 * Sign in with Twitter. Tries popup first, falls back to redirect.
 */
export async function signInWithTwitter(): Promise<TwitterProfile> {
  const app = getFirebaseApp();
  const auth = getAuth(app);
  const provider = new TwitterAuthProvider();

  try {
    // Try popup first (faster UX)
    const result = await signInWithPopup(auth, provider);
    if (!TwitterAuthProvider.credentialFromResult(result)) {
      throw new Error('Twitter authentication failed');
    }
    return extractProfile(result);
  } catch (e: unknown) {
    const err = e as { code?: string };
    // If popup blocked by CSP/browser → fallback to redirect
    if (
      err.code === 'auth/popup-blocked' ||
      err.code === 'auth/popup-closed-by-user' ||
      err.code === 'auth/cancelled-popup-request' ||
      err.code === 'auth/internal-error'
    ) {
      // Save state so we know to check redirect result on return
      sessionStorage.setItem('twitter_auth_pending', '1');
      await signInWithRedirect(auth, provider);
      // This line won't execute — page redirects to Twitter
      throw new Error('Redirecting to Twitter...');
    }
    throw e;
  }
}

/**
 * Check for redirect result on page load (after Twitter redirect back).
 * Call this once on TrustRecovery mount.
 */
export async function checkTwitterRedirectResult(): Promise<TwitterProfile | null> {
  if (!sessionStorage.getItem('twitter_auth_pending')) return null;
  sessionStorage.removeItem('twitter_auth_pending');

  const app = getFirebaseApp();
  const auth = getAuth(app);

  const result = await getRedirectResult(auth);
  if (!result) return null;
  if (!TwitterAuthProvider.credentialFromResult(result)) return null;
  return extractProfile(result);
}
