/**
 * Prints the live state of the pool: settings, entries, admins.
 *
 * Reads with admin credentials, so it shows what is actually stored rather
 * than what the rules let a browser see. Useful for checking a deploy landed
 * and for spotting a config document that is subtly the wrong shape --
 * lockTime as a string rather than a Timestamp, say, which the rules compare
 * against request.time and would silently mis-evaluate.
 *
 * Usage:
 *   npm run pool:status
 */

import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import { initAdmin } from './lib/admin-app.js';
import { run } from './lib/exit.js';

await run(async () => {
  const { projectId } = await initAdmin();
  const db = getFirestore();

  console.log(`\n=== ${projectId} ===\n`);

  const config = await db.doc('config/pool').get();
  if (!config.exists) {
    console.log('config/pool  MISSING -- run npm run pool:seed-config --');
  } else {
    const data = config.data() ?? {};
    const lock = data['lockTime'];
    const lockOk = lock instanceof Timestamp;
    console.log('config/pool');
    console.log(`  name              ${data['name']} (${data['year']})`);
    console.log(`  isOpen            ${data['isOpen']}`);
    console.log(`  lockTime          ${lockOk ? lock.toDate().toISOString() : String(lock)}`);
    console.log(`  lockTime type     ${lockOk ? 'Timestamp (correct)' : 'NOT A TIMESTAMP -- rules will misbehave'}`);
    console.log(`  entry fee         $${(data['prizes']?.entryFeeCents ?? 0) / 100}`);
    console.log(`  split             ${(data['prizes']?.split ?? []).join('/')}`);
    console.log(`  refund last       ${data['prizes']?.refundLastPlace}`);
    console.log(`  max per person    ${data['maxEntriesPerUser']}`);
  }

  const entries = await db.collection('entries').get();
  console.log(`\nentries           ${entries.size}`);
  for (const doc of entries.docs) {
    const d = doc.data() as Record<string, unknown>;
    const picks = Object.keys((d['picks'] as object) ?? {}).length;
    console.log(`  ${doc.id}  ${d['name'] ?? '?'}  ${d['status'] ?? '?'}  ` +
      `${picks}/63 picks  paid=${d['paid'] === true}  owner=${d['ownerEmail'] ?? 'MISSING'}`);
  }

  const users = await getAuth().listUsers(100);
  const admins = users.users.filter((u) => u.customClaims?.admin === true);
  console.log(`\nusers             ${users.users.length}`);
  console.log(`admins            ${admins.length ? admins.map((u) => u.email).join(', ') : 'none'}`);
  console.log('');

});
