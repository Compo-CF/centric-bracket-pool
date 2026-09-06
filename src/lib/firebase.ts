/**
 * Firebase initialisation. Vite inlines import.meta.env.VITE_* at build time by
 * literal match, so each variable has to be written out -- dynamic lookup like
 * import.meta.env[name] silently yields undefined in a production build.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const ALLOWED_EMAIL_DOMAIN =
  import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN || 'centricfiber.com';

export const MICROSOFT_TENANT_ID = import.meta.env.VITE_MICROSOFT_TENANT_ID || '';

/** Which settings are missing, so the shell can say so instead of white-screening. */
export function missingConfig(): string[] {
  const required: Record<string, string | undefined> = {
    VITE_FIREBASE_API_KEY: firebaseConfig.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: firebaseConfig.authDomain,
    VITE_FIREBASE_PROJECT_ID: firebaseConfig.projectId,
    VITE_FIREBASE_APP_ID: firebaseConfig.appId,
    VITE_MICROSOFT_TENANT_ID: MICROSOFT_TENANT_ID,
  };
  return Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
}

export function isConfigured(): boolean {
  return missingConfig().length === 0;
}

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;

function getApp(): FirebaseApp {
  if (!app) {
    const missing = missingConfig();
    if (missing.length) {
      throw new Error(`Firebase is not configured. Missing: ${missing.join(', ')}`);
    }
    app = initializeApp(firebaseConfig);
  }
  return app;
}

export function auth(): Auth {
  if (!authInstance) authInstance = getAuth(getApp());
  return authInstance;
}

export function db(): Firestore {
  if (!dbInstance) dbInstance = getFirestore(getApp());
  return dbInstance;
}
