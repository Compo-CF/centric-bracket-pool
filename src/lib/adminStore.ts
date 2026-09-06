/**
 * Admin writes from the browser.
 *
 * Everything here needs the `admin` custom claim; firestore.rules rejects it
 * otherwise, so a non-admin who reaches this code gets a permission error
 * rather than a silent no-op.
 *
 * Every state-changing action writes an audit row and recomputes standings, so
 * the leaderboard can never sit stale behind an admin decision and there is
 * always a record of who changed what.
 */

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  type Firestore,
} from 'firebase/firestore';

import { applyEliminations, recordResult, type Entry, type Game } from '../engine/index.js';
import { db } from './firebase.js';
import type { BracketDoc, StandingsDoc } from './documents.js';
import { computeStandingsDoc } from './standings.js';

export interface AdminSnapshot {
  bracket: BracketDoc;
  entries: Entry[];
  config: Record<string, unknown>;
}

function database(): Firestore {
  return db();
}

export async function loadAdminSnapshot(): Promise<AdminSnapshot> {
  const [bracketSnap, entriesSnap, configSnap] = await Promise.all([
    getDoc(doc(database(), 'tournament', 'bracket')),
    getDocs(collection(database(), 'entries')),
    getDoc(doc(database(), 'config', 'pool')),
  ]);

  if (!bracketSnap.exists()) {
    throw new Error('tournament/bracket is missing. An admin runs npm run pool:seed-bracket.');
  }

  return {
    bracket: bracketSnap.data() as BracketDoc,
    entries: entriesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Entry, 'id'>) })),
    config: (configSnap.data() ?? {}) as Record<string, unknown>,
  };
}

async function audit(action: string, detail: Record<string, unknown>, by: string): Promise<void> {
  await setDoc(doc(collection(database(), 'audit')), {
    at: new Date().toISOString(), action, by, ...detail,
  });
}

export async function rebuildStandings(snapshot: AdminSnapshot): Promise<StandingsDoc> {
  const standings = computeStandingsDoc({
    entries: snapshot.entries,
    bracket: snapshot.bracket,
    config: {
      weights: snapshot.config['weights'] as never,
      prizes: snapshot.config['prizes'] as never,
      lockTime: snapshot.config['lockTime'] as never,
    },
  });
  await setDoc(doc(database(), 'tournament', 'standings'), standings);
  return standings;
}

/** Only an admin can move this; the rules forbid an entrant changing their own. */
export async function setPaid(
  snapshot: AdminSnapshot, entryId: string, paid: boolean, by: string,
): Promise<AdminSnapshot> {
  await updateDoc(doc(database(), 'entries', entryId), { paid });
  await audit('set-paid', { entryId, paid }, by);

  const next: AdminSnapshot = {
    ...snapshot,
    entries: snapshot.entries.map((e) => (e.id === entryId ? { ...e, paid } : e)),
  };
  await rebuildStandings(next);
  return next;
}

/**
 * Set or clear a winner by hand. Stamps overriddenBy, which the sync job
 * checks and never touches again -- the season ESPN gets a result wrong is the
 * season this is the only way to run the pool.
 */
export async function setResult(
  snapshot: AdminSnapshot,
  slot: string,
  winner: string | null,
  by: string,
  scores?: { scoreA: number | null; scoreB: number | null },
): Promise<AdminSnapshot> {
  const games: Game[] = recordResult(snapshot.bracket.games, slot, {
    winner,
    status: winner ? 'final' : 'scheduled',
    overriddenBy: by,
    ...(scores ? { scoreA: scores.scoreA, scoreB: scores.scoreB } : {}),
  }, { source: 'admin' });

  const bracket: BracketDoc = {
    ...snapshot.bracket,
    updatedAt: new Date().toISOString(),
    teams: applyEliminations(snapshot.bracket.teams, games),
    games,
  };

  await setDoc(doc(database(), 'tournament', 'bracket'), bracket);
  await audit(winner ? 'set-result' : 'clear-result', { slot, winner }, by);

  const next: AdminSnapshot = { ...snapshot, bracket };
  await rebuildStandings(next);
  return next;
}

/**
 * Record a final score without touching the winner.
 *
 * Not cosmetic for the championship: the tiebreaker is that game's combined
 * score, so an admin who sets the title game by hand and leaves the score
 * blank would leave every tie in the pool unresolvable.
 */
export async function setScore(
  snapshot: AdminSnapshot, slot: string, scoreA: number | null, scoreB: number | null, by: string,
): Promise<AdminSnapshot> {
  const game = snapshot.bracket.games.find((g) => g.slot === slot);
  if (!game) throw new Error(`No such slot: ${slot}`);

  const games: Game[] = recordResult(snapshot.bracket.games, slot, {
    winner: game.winner,
    scoreA,
    scoreB,
    status: game.status,
    overriddenBy: by,
  }, { source: 'admin' });

  const bracket: BracketDoc = {
    ...snapshot.bracket,
    updatedAt: new Date().toISOString(),
    teams: snapshot.bracket.teams,
    games,
  };

  await setDoc(doc(database(), 'tournament', 'bracket'), bracket);
  await audit('set-score', { slot, scoreA, scoreB }, by);

  const next: AdminSnapshot = { ...snapshot, bracket };
  await rebuildStandings(next);
  return next;
}

export async function setPoolOpen(open: boolean, by: string): Promise<void> {
  await updateDoc(doc(database(), 'config', 'pool'), { isOpen: open });
  await audit('set-pool-open', { open }, by);
}
