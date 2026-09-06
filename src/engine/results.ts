/**
 * Turning game outcomes into bracket state. Propagation is a full recompute
 * rather than an incremental patch: it is idempotent, and an admin correcting
 * a wrongly-entered winner correctly clears everything downstream of it.
 */

import { feedsInto, parseSlot } from './bracket.js';
import {
  ROUNDS, SLOTS_PER_ROUND,
  type Game, type GameStatus, type Round, type SlotId, type Team, type TeamId,
} from './types.js';

export function isDecided(game: Game): boolean {
  return game.winner !== null;
}

export function indexGames(games: readonly Game[]): Map<SlotId, Game> {
  return new Map(games.map((g) => [g.slot, g]));
}

/**
 * Recompute every teamA/teamB above round 1 from the winners currently set.
 * Walking rounds in ascending order guarantees each feeder is resolved before
 * the game it feeds.
 */
export function propagateWinners(games: readonly Game[]): Game[] {
  const bySlot = new Map(games.map((g) => [g.slot, { ...g }]));

  for (const round of ROUNDS) {
    if (round === 6) break;
    for (let k = 1; k <= SLOTS_PER_ROUND[round]; k++) {
      const source = bySlot.get(`R${round}-${String(k).padStart(2, '0')}`);
      if (!source) continue;
      const dest = feedsInto(source.slot);
      if (!dest) continue;
      const target = bySlot.get(dest.slot);
      if (!target) continue;
      if (dest.position === 'A') target.teamA = source.winner;
      else target.teamB = source.winner;
    }
  }

  return [...bySlot.values()];
}

/** Every team that has lost a decided game. */
export function deriveEliminated(games: readonly Game[]): Set<TeamId> {
  const out = new Set<TeamId>();
  for (const g of games) {
    if (!isDecided(g)) continue;
    for (const side of [g.teamA, g.teamB]) {
      if (side && side !== g.winner) out.add(side);
    }
  }
  return out;
}

export function applyEliminations(teams: readonly Team[], games: readonly Game[]): Team[] {
  const dead = deriveEliminated(games);
  return teams.map((t) => (t.eliminated === dead.has(t.id) ? t : { ...t, eliminated: dead.has(t.id) }));
}

export interface ResultInput {
  winner: TeamId | null;
  scoreA?: number | null;
  scoreB?: number | null;
  status?: GameStatus;
  espnEventId?: string | null;
  /** Set for admin edits; leave undefined for the sync job. */
  overriddenBy?: string;
}

export class ResultError extends Error {}

/**
 * Record one game's outcome and repropagate. Rejects a winner that is not one
 * of the two teams in the slot -- the commonest symptom of a bad ESPN mapping,
 * and one we want loud rather than silently scoring the pool wrong.
 */
export function recordResult(
  games: readonly Game[],
  slot: SlotId,
  input: ResultInput,
  opts: { source: 'sync' | 'admin' } = { source: 'admin' },
): Game[] {
  parseSlot(slot);
  const bySlot = new Map(games.map((g) => [g.slot, { ...g }]));
  const game = bySlot.get(slot);
  if (!game) throw new ResultError(`No such slot: ${slot}`);

  // An admin decision is final. The sync job must never undo it.
  if (opts.source === 'sync' && game.overriddenBy) return [...bySlot.values()];

  if (input.winner !== null && input.winner !== game.teamA && input.winner !== game.teamB) {
    throw new ResultError(
      `${input.winner} is not playing in ${slot} (${game.teamA ?? 'TBD'} v ${game.teamB ?? 'TBD'})`,
    );
  }

  game.winner = input.winner;
  if (input.scoreA !== undefined) game.scoreA = input.scoreA;
  if (input.scoreB !== undefined) game.scoreB = input.scoreB;
  game.status = input.status ?? (input.winner ? 'final' : game.status);
  if (input.espnEventId !== undefined) game.espnEventId = input.espnEventId;
  if (opts.source === 'admin' && input.overriddenBy) game.overriddenBy = input.overriddenBy;

  return propagateWinners([...bySlot.values()]);
}

/** Convenience: propagate and recompute eliminations in one call. */
export function settle(
  games: readonly Game[],
  teams: readonly Team[],
): { games: Game[]; teams: Team[]; eliminated: Set<TeamId> } {
  const next = propagateWinners(games);
  const eliminated = deriveEliminated(next);
  return { games: next, teams: applyEliminations(teams, next), eliminated };
}

export function gamesByRound(games: readonly Game[], round: Round): Game[] {
  return games.filter((g) => g.round === round);
}
