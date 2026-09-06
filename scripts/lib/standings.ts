/**
 * Reads the pieces out of Firestore, computes the standings with the shared
 * implementation, and writes them back.
 *
 * The computation itself lives in src/lib/standings.ts because the admin screen
 * needs it too: marking someone paid changes the prize allocation.
 *
 * ONE aggregated document, never one per entry. A per-entry layout puts a
 * hundred-person pool at roughly 240,000 Firestore reads a day, five times the
 * free tier; this is 2,000. Every viewer reads exactly one document.
 */

import type { Firestore } from '@google-cloud/firestore';

import type { Entry } from '../../src/engine/index.js';
import type { BracketDoc, StandingsDoc } from '../../src/lib/documents.js';
import { computeStandingsDoc } from '../../src/lib/standings.js';

export async function computeStandings(db: Firestore): Promise<StandingsDoc> {
  const [bracketSnap, entriesSnap, configSnap] = await Promise.all([
    db.doc('tournament/bracket').get(),
    db.collection('entries').get(),
    db.doc('config/pool').get(),
  ]);

  if (!bracketSnap.exists) {
    throw new Error('tournament/bracket is missing. Run npm run pool:seed-bracket.');
  }

  const bracket = bracketSnap.data() as BracketDoc;
  const config = configSnap.data() ?? {};
  const entries = entriesSnap.docs.map(
    (d) => ({ id: d.id, ...(d.data() as Omit<Entry, 'id'>) }));

  return computeStandingsDoc({
    entries,
    bracket,
    config: {
      weights: config['weights'],
      prizes: config['prizes'],
      lockTime: config['lockTime'],
    },
  });
}

export async function writeStandings(db: Firestore): Promise<StandingsDoc> {
  const doc = await computeStandings(db);
  await db.doc('tournament/standings').set(doc);
  return doc;
}
