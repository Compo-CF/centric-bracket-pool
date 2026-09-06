/**
 * Shapes of the Firestore documents, defined once.
 *
 * Both sides of every document live in this repo -- the scripts write them,
 * the browser reads them -- so a duplicated interface would drift silently and
 * show up as a blank column on the leaderboard rather than a type error.
 */

import type {
  Game, PrizeRules, Round, Standing, Team,
} from '../engine/index.js';

/** tournament/standings -- one aggregated document, read by every viewer. */
export interface StandingsDoc {
  updatedAt: string;
  /**
   * Whether entries have locked. Computed server-side so the leaderboard needs
   * one read rather than also fetching config/pool, and so champion picks stay
   * hidden until the deadline without the client deciding that for itself.
   */
  locked: boolean;
  entryCount: number;
  paidCount: number;
  potCents: number;
  pointsRemaining: number;
  gamesDecided: number;
  rows: Standing[];
  prizes: PrizeAwardDoc[];
}

export interface PrizeAwardDoc {
  position: 1 | 2 | 3 | 'last';
  label: string;
  entryIds: string[];
  entryNames: string[];
  amountEachCents: number[];
  totalCents: number;
}

/** tournament/bracket -- the field and all 63 slots, in one document. */
export interface BracketDoc {
  isSampleField: boolean;
  updatedAt: string;
  teams: Team[];
  games: Game[];
}

/** config/pool -- lockTime is a Firestore Timestamp, not a string. */
export interface PoolConfigDoc {
  year: number;
  name: string;
  weights: Record<Round, number>;
  isOpen: boolean;
  maxEntriesPerUser: number;
  prizes: PrizeRules;
}
