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
 *   npm run pool:grant-admin -- someone@centricfiber.com
 *   npm run pool:grant-admin -- someone@centricfiber.com --revoke
 *
 * The person must have signed in at least once first, so the account exists.
 */


import { adminAuth, initAdmin } from './lib/admin-app.js';
import { ScriptExit, run } from './lib/exit.js';

await run(async () => {
  const [email, ...flags] = process.argv.slice(2);
  const revoke = flags.includes('--revoke');

  if (!email || !email.includes('@')) {
    console.error('Usage: npm run pool:grant-admin -- <email> [--revoke]');
    throw new ScriptExit(1);
  }

  const { projectId, via } = await initAdmin();
  console.log(`Using ${via}${projectId ? ` for ${projectId}` : ''}.`);

  try {
    const user = await adminAuth().getUserByEmail(email);
    const existing = user.customClaims ?? {};

    await adminAuth().setCustomUserClaims(user.uid, revoke
      ? { ...existing, admin: false }
      : { ...existing, admin: true });

    console.log(`${revoke ? 'Revoked' : 'Granted'} admin for ${email} (${user.uid}).`);
    console.log('They need to sign out and back in for the new token to take effect.');
  } catch (error) {
    if ((error as { code?: string })?.code === 'auth/user-not-found') {
      console.error(`No account for ${email} yet.`);
      console.error('Ask them to sign in to the pool once, then run this again.');
      throw new ScriptExit(1);
    }
    throw error;
  }

});
