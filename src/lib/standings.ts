/**
 * Computing the standings document.
 *
 * Pure, and shared by both writers: the sync job (firebase-admin) and the
 * admin screen (the browser SDK). Marking someone paid changes the prize
 * allocation, so the admin has to be able to recompute without waiting for the
 * next sync -- and having two implementations of who-owes-what would be a
 * genuinely bad idea.
 */

import {
  DEFAULT_PRIZE_RULES, DEFAULT_WEIGHTS, allocatePrizes, buildStandings,
  pointsRemaining,
  type Entry, type PrizeRules, type Round,
} from '../engine/index.js';
import type { BracketDoc, StandingsDoc } from './documents.js';

/** Both Firestore SDKs expose toDate() on a Timestamp; neither type is shared. */
interface TimestampLike { toDate?: () => Date }

export interface StandingsInput {
  /** Every entry. Drafts are filtered out here, not by the caller. */
  entries: readonly Entry[];
  bracket: Pick<BracketDoc, 'teams' | 'games'>;
  config: {
    weights?: Record<Round, number>;
    prizes?: PrizeRules;
    lockTime?: TimestampLike | string | null;
  };
  now?: Date;
}

function isLocked(lockTime: StandingsInput['config']['lockTime'], now: Date): boolean {
  if (!lockTime) return false;
  if (typeof lockTime === 'string') return new Date(lockTime).getTime() <= now.getTime();
  if (typeof lockTime.toDate === 'function') return lockTime.toDate().getTime() <= now.getTime();
  return false;
}

export function computeStandingsDoc(input: StandingsInput): StandingsDoc {
  const now = input.now ?? new Date();

  // Scoring weights and prize rules are separate settings that both live on
  // config/pool. Conflating them would score the tournament in dollars.
  const weights = input.config.weights ?? DEFAULT_WEIGHTS;
  const prizes = input.config.prizes ?? DEFAULT_PRIZE_RULES;

  // Only submitted brackets are ranked. A half-finished draft on the
  // leaderboard would read as someone doing badly rather than not being done.
  const submitted = input.entries.filter(
    (e) => (e as unknown as { status?: string }).status === 'submitted');

  const rows = buildStandings(submitted, input.bracket.games, input.bracket.teams, { weights });
  const paidIds = new Set(submitted.filter((e) => e.paid).map((e) => e.id));

  return {
    updatedAt: now.toISOString(),
    locked: isLocked(input.config.lockTime, now),
    entryCount: submitted.length,
    paidCount: paidIds.size,
    potCents: paidIds.size * prizes.entryFeeCents,
    pointsRemaining: pointsRemaining(input.bracket.games, weights),
    gamesDecided: input.bracket.games.filter((g) => g.winner !== null).length,
    rows,
    prizes: allocatePrizes(rows, paidIds, prizes),
  };
}
