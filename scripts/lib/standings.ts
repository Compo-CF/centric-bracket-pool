/**
 * Computes and writes tournament/standings.
 *
 * Lives in lib because two callers need it: the manual rebuild script, and the
 * results sync job, which recomputes standings in the same pass as it records
 * a winner.
 *
 * ONE aggregated document, never one per entry. A per-entry layout puts a
 * hundred-person pool at roughly 240,000 Firestore reads a day, five times the
 * free tier; this is 2,000. Every viewer reads exactly one document.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { BracketDoc, StandingsDoc } from '../../src/lib/documents.js';

import {
  DEFAULT_PRIZE_RULES, DEFAULT_WEIGHTS, allocatePrizes, buildStandings,
  pointsRemaining,
  type Entry, type PrizeRules, type Round,
} from '../../src/engine/index.js';

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

  // Scoring weights and prize rules are separate settings that both live on
  // config/pool. Conflating them would score the tournament in dollars.
  const weights = (config['weights'] as Record<Round, number>) ?? DEFAULT_WEIGHTS;
  const prizes: PrizeRules = (config['prizes'] as PrizeRules) ?? DEFAULT_PRIZE_RULES;

  // Only submitted brackets are ranked. A half-finished draft on the
  // leaderboard would read as someone doing badly rather than not being done.
  const entries: Entry[] = entriesSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Entry, 'id'>) }))
    .filter((e) => (e as unknown as { status?: string }).status === 'submitted');

  const rows = buildStandings(entries, bracket.games, bracket.teams, { weights });
  const paidIds = new Set(entries.filter((e) => e.paid).map((e) => e.id));

  const lockTime = config['lockTime'] as { toDate?: () => Date } | undefined;
  const locked = typeof lockTime?.toDate === 'function'
    ? lockTime.toDate().getTime() <= Date.now()
    : false;

  return {
    updatedAt: new Date().toISOString(),
    locked,
    entryCount: entries.length,
    paidCount: paidIds.size,
    potCents: paidIds.size * prizes.entryFeeCents,
    pointsRemaining: pointsRemaining(bracket.games, weights),
    gamesDecided: bracket.games.filter((g) => g.winner !== null).length,
    rows,
    prizes: allocatePrizes(rows, paidIds, prizes),
  };
}

export async function writeStandings(db: Firestore): Promise<StandingsDoc> {
  const doc = await computeStandings(db);
  await db.doc('tournament/standings').set(doc);
  return doc;
}
