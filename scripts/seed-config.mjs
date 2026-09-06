/**
 * Creates the config/pool document.
 *
 * This is not optional. firestore.rules calls
 *   get(/databases/$(database)/documents/config/pool).data
 * to read lockTime and isOpen, so while that document is missing every rule
 * that touches it errors and denies. The symptom is a permission error on
 * every entry read and write, with a working database and correct rules --
 * which is a miserable thing to debug.
 *
 * Writes with admin credentials, which bypass rules, so this works before
 * anyone is an admin. Credentials come from serviceAccount.json if present,
 * otherwise from `gcloud auth application-default login`.
 *
 * Usage:
 *   node scripts/seed-config.mjs
 *   node scripts/seed-config.mjs --lock 2027-03-19T16:00:00Z
 *   node scripts/seed-config.mjs --force        (overwrite existing settings)
 */

import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import { initAdmin } from './lib/admin-app.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const lockArg = args[args.indexOf('--lock') + 1];

// Placeholder: the NCAA has not published the 2027 schedule in final form.
// Entries must lock at the first tip on Thursday, after the First Four.
const DEFAULT_LOCK = '2027-03-18T16:00:00Z';
const lockIso = args.includes('--lock') && lockArg ? lockArg : DEFAULT_LOCK;
const lockDate = new Date(lockIso);

if (Number.isNaN(lockDate.getTime())) {
  console.error(`Not a valid ISO 8601 timestamp: ${lockIso}`);
  process.exit(1);
}

const { projectId, via } = await initAdmin();
console.log(`Using ${via}${projectId ? ` for ${projectId}` : ''}.`);

const db = getFirestore();
const ref = db.doc('config/pool');

const existing = await ref.get();
if (existing.exists && !force) {
  console.log('config/pool already exists. Current settings:');
  console.log(JSON.stringify(existing.data(), null, 2));
  console.log('\nPass --force to overwrite.');
  process.exit(0);
}

const config = {
  year: 2027,
  name: 'Centric Bracket Pool',
  // Firestore Timestamp, not a string: the rules compare it with request.time.
  lockTime: Timestamp.fromDate(lockDate),
  weights: { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 },
  isOpen: true,
  maxEntriesPerUser: 5,
  prizes: {
    entryFeeCents: 1000,
    split: [50, 30, 20],
    refundLastPlace: true,
  },
};

await ref.set(config);

console.log(`Wrote config/pool${force && existing.exists ? ' (overwritten)' : ''}.`);
console.log(JSON.stringify({ ...config, lockTime: lockDate.toISOString() }, null, 2));

if (!args.includes('--lock')) {
  console.log('\nlockTime is a PLACEHOLDER.');
  console.log('Set the real first tip once the NCAA publishes the 2027 schedule:');
  console.log('  node scripts/seed-config.mjs --lock <ISO timestamp> --force');
}
