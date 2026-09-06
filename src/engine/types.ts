/**
 * Core tournament types. This module has no Firebase dependency and no I/O --
 * everything in src/engine is pure so it can be unit tested in isolation and
 * run identically in the browser and in the results sync job.
 */

export type Round = 1 | 2 | 3 | 4 | 5 | 6;
export type RegionIndex = 1 | 2 | 3 | 4;

/** e.g. "R1-01" ... "R6-01" */
export type SlotId = string;
export type TeamId = string;

export type GameStatus = 'scheduled' | 'in_progress' | 'final';

export const ROUNDS: readonly Round[] = [1, 2, 3, 4, 5, 6];

export const ROUND_NAMES: Record<Round, string> = {
  1: 'Round of 64',
  2: 'Round of 32',
  3: 'Sweet 16',
  4: 'Elite Eight',
  5: 'Final Four',
  6: 'Championship',
};

/** 2^(6-n) slots per round: 32, 16, 8, 4, 2, 1 -- 63 in total. */
export const SLOTS_PER_ROUND: Record<Round, number> = {
  1: 32, 2: 16, 3: 8, 4: 4, 5: 2, 6: 1,
};

/**
 * The doubling ladder. Each round is worth exactly 32 points in aggregate,
 * so no single round decides the pool. Overridable via PoolConfig.weights.
 */
export const DEFAULT_WEIGHTS: Record<Round, number> = {
  1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32,
};

export const PERFECT_SCORE = 192;
export const TOTAL_SLOTS = 63;

/** Fixed NCAA seed pairings, in bracket order top to bottom within a region. */
export const SEED_PAIRS: readonly (readonly [number, number])[] = [
  [1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15],
];

export interface Team {
  id: TeamId;
  name: string;
  /** 1-16 */
  seed: number;
  region: RegionIndex;
  /** Set during admin mapping on Selection Sunday. Null until then. */
  espnId: string | null;
  eliminated: boolean;
}

export interface Game {
  slot: SlotId;
  round: Round;
  /** Null for the Final Four and Championship, which are region-agnostic. */
  region: RegionIndex | null;
  teamA: TeamId | null;
  teamB: TeamId | null;
  winner: TeamId | null;
  scoreA: number | null;
  scoreB: number | null;
  status: GameStatus;
  /** ISO 8601 */
  tipoff: string | null;
  espnEventId: string | null;
  /** Admin uid. Once set, the sync job never touches this game again. */
  overriddenBy: string | null;
}

export interface Entry {
  id: string;
  ownerUid: string;
  ownerEmail: string;
  ownerName: string;
  /** People submit more than one, so entries are named. */
  name: string;
  picks: Record<SlotId, TeamId>;
  /** Predicted combined score of the championship game. */
  tiebreaker: number | null;
  submittedAt: string | null;
  paid: boolean;
}

export interface Standing {
  entryId: string;
  entryName: string;
  ownerName: string;
  rank: number;
  points: number;
  maxPossible: number;
  correct: number;
  byRound: Record<Round, number>;
  champion: TeamId | null;
  championAlive: boolean;
  tiebreaker: number | null;
}

export interface PoolConfig {
  year: number;
  name: string;
  /** ISO 8601. Entries are frozen at first tip, after the First Four resolves. */
  lockTime: string;
  weights: Record<Round, number>;
  isOpen: boolean;
  maxEntriesPerUser: number;
}
