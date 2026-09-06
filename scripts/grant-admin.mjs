/**
 * Grants or revokes the `admin` custom claim that firestore.rules checks for.
 *
 * The rules gate every write to /tournament and /config on `token.admin`, so
 * without this nobody can run the pool -- not even the person who created the
 * Firebase project. Custom claims can only be set from a privileged context,
 * which is why this runs server-side against a service account.
 *
 * Credentials come from serviceAccount.json if present, otherwise from
 * `gcloud auth application-default login`. The subtlefoodie.com organisation
 * enforces iam.disableServiceAccountKeyCreation, so gcloud is usually the only
 * route -- and the better one, since nothing long-lived lands on disk.
 *
 * Usage:
 *   node scripts/grant-admin.mjs someone@centricfiber.com
 *   node scripts/grant-admin.mjs someone@centricfiber.com --revoke
 *
 * The person must have signed in at least once first, so the account exists.
 */

import { getAuth } from 'firebase-admin/auth';

import { initAdmin } from './lib/admin-app.mjs';

const [email, ...flags] = process.argv.slice(2);
const revoke = flags.includes('--revoke');

if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/grant-admin.mjs <email> [--revoke]');
  process.exit(1);
}

const { projectId, via } = await initAdmin();
console.log(`Using ${via}${projectId ? ` for ${projectId}` : ''}.`);

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
