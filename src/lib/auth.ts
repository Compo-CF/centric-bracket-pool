/**
 * Sign-in via the Centric Entra tenant.
 *
 * Deliberately not email magic links: Defender for Office 365 Safe Links
 * pre-fetches URLs in inbound mail and can consume a one-time sign-in link
 * before the recipient ever clicks it.
 */

import {
  OAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect,
  signOut as fbSignOut, type User,
} from 'firebase/auth';
import { ALLOWED_EMAIL_DOMAIN, MICROSOFT_TENANT_ID, auth } from './firebase.js';

export class AuthError extends Error {}

function microsoftProvider(): OAuthProvider {
  const provider = new OAuthProvider('microsoft.com');
  provider.setCustomParameters({
    // Restricting to the tenant is what actually keeps personal Microsoft
    // accounts out. The email-domain check below is a second lock.
    tenant: MICROSOFT_TENANT_ID,
    prompt: 'select_account',
  });
  provider.addScope('email');
  provider.addScope('openid');
  provider.addScope('profile');
  return provider;
}

export function isCompanyUser(user: User | null): boolean {
  const email = user?.email?.toLowerCase();
  return !!email && email.endsWith(`@${ALLOWED_EMAIL_DOMAIN.toLowerCase()}`);
}

/**
 * Popups are blocked often enough on locked-down work machines that the
 * redirect fallback is not optional.
 */
export async function signIn(): Promise<User> {
  const provider = microsoftProvider();
  try {
    const credential = await signInWithPopup(auth(), provider);
    return await assertCompany(credential.user);
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user'
      || code === 'auth/cancelled-popup-request') {
      await signInWithRedirect(auth(), provider);
      // The redirect navigates away; this promise never settles.
      return new Promise<User>(() => {});
    }
    throw error;
  }
}

async function assertCompany(user: User): Promise<User> {
  if (isCompanyUser(user)) return user;
  const attempted = user.email ?? 'that account';
  await fbSignOut(auth());
  throw new AuthError(
    `${attempted} is not a ${ALLOWED_EMAIL_DOMAIN} address. Sign in with your Centric account.`,
  );
}

/**
 * Reads the `admin` custom claim off the ID token. The claim is set out of
 * band by scripts/grant-admin.mjs and only reaches the browser on the next
 * sign-in, so someone newly made admin has to sign out and back in.
 */
export async function hasAdminClaim(user: User): Promise<boolean> {
  try {
    const token = await user.getIdTokenResult();
    return token.claims['admin'] === true;
  } catch {
    return false;
  }
}

export function signOut(): Promise<void> {
  return fbSignOut(auth());
}

export function onUserChange(handler: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth(), (user) => {
    handler(user && isCompanyUser(user) ? user : null);
  });
}

export type { User };
