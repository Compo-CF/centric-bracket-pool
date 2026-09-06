/**
 * Grants or revokes the `admin` custom claim that firestore.rules checks for.
 *
 * The rules gate every write to /tournament and /config on `token.admin`, so
 * without this nobody can run the pool -- not even the person who created the
 * Firebase project. Custom claims can only be set from a privileged context,
 * which is why this runs server-side against a service account.
 *
 * Setup:
 *   Firebase console -> Project settings -> Service accounts
 *   -> Generate new private key -> save as serviceAccount.json in the repo root.
 *   It is gitignored. Do not commit it, and do not paste it anywhere.
 *
 * Usage:
 *   node scripts/grant-admin.mjs someone@centricfiber.com
 *   node scripts/grant-admin.mjs someone@centricfiber.com --revoke
 *
 * The person must have signed in at least once first, so the account exists.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const here = dirname(fileURLToPath(import.meta.url));
const keyPath = resolve(here, '..', 'serviceAccount.json');

const [email, ...flags] = process.argv.slice(2);
const revoke = flags.includes('--revoke');

if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/grant-admin.mjs <email> [--revoke]');
  process.exit(1);
}

if (!existsSync(keyPath)) {
  console.error(`No service account key at ${keyPath}`);
  console.error('Firebase console -> Project settings -> Service accounts ->');
  console.error('Generate new private key, and save it there as serviceAccount.json.');
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) });

try {
  const user = await getAuth().getUserByEmail(email);
  const existing = user.customClaims ?? {};

  await getAuth().setCustomUserClaims(user.uid, revoke
    ? { ...existing, admin: false }
    : { ...existing, admin: true });

  console.log(`${revoke ? 'Revoked' : 'Granted'} admin for ${email} (${user.uid}).`);
  console.log('They need to sign out and back in for the new token to take effect.');
} catch (error) {
  if (error?.code === 'auth/user-not-found') {
    console.error(`No account for ${email} yet.`);
    console.error('Ask them to sign in to the pool once, then run this again.');
    process.exit(1);
  }
  throw error;
}
