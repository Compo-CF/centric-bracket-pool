/**
 * Pick validation. An entry's pick for a slot must be one of the two teams
 * that entry's own earlier picks send there -- you cannot advance a team you
 * already knocked out. Enforced on submit so that no invalid entry is ever
 * stored, which is what lets the scoring ceiling stay honest.
 */

import { allSlots, feedersOf, parseSlot } from './bracket.js';
import { indexGames } from './results.js';
import { TOTAL_SLOTS, type Entry, type Game, type SlotId, type TeamId } from './types.js';

export interface PickProblem {
  slot: SlotId;
  kind: 'missing' | 'illegal';
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  complete: boolean;
  problems: PickProblem[];
  picksMade: number;
}

/**
 * The two teams an entry may pick in a slot, given its own upstream picks.
 * Round 1 reads the real field; every later round reads the entry's picks.
 */
export function legalTeamsForSlot(
  slot: SlotId,
  picks: Readonly<Record<SlotId, TeamId>>,
  games: readonly Game[] | ReadonlyMap<SlotId, Game>,
): TeamId[] {
  const bySlot = games instanceof Map ? games : indexGames(games as readonly Game[]);
  const { round } = parseSlot(slot);

  if (round === 1) {
    const game = bySlot.get(slot);
    if (!game) return [];
    return [game.teamA, game.teamB].filter((t): t is TeamId => t !== null);
  }

  const feeders = feedersOf(slot);
  if (!feeders) return [];
  return feeders.map((f) => picks[f]).filter((t): t is TeamId => t !== undefined);
}

export function validateEntry(entry: Entry, games: readonly Game[]): ValidationResult {
  const bySlot = indexGames(games);
  const problems: PickProblem[] = [];
  let picksMade = 0;

  for (const slot of allSlots()) {
    const pick = entry.picks[slot];
    if (!pick) {
      problems.push({ slot, kind: 'missing', message: `No pick for ${slot}` });
      continue;
    }
    picksMade += 1;

    const legal = legalTeamsForSlot(slot, entry.picks, bySlot);
    // An upstream gap already reported itself as 'missing'; don't double-report.
    if (legal.length === 0) continue;
    if (!legal.includes(pick)) {
      problems.push({
        slot,
        kind: 'illegal',
        message: `${pick} cannot reach ${slot} (legal: ${legal.join(', ')})`,
      });
    }
  }

  const illegal = problems.some((p) => p.kind === 'illegal');
  return {
    valid: !illegal && picksMade === TOTAL_SLOTS,
    complete: picksMade === TOTAL_SLOTS,
    problems,
    picksMade,
  };
}

/**
 * Drop picks that a change invalidated, so switching a round-1 winner clears
 * that team from every later round instead of leaving an unreachable pick
 * behind. Returns a new picks object.
 */
export function prunePicks(
  picks: Readonly<Record<SlotId, TeamId>>,
  games: readonly Game[],
): Record<SlotId, TeamId> {
  const bySlot = indexGames(games);
  const next: Record<SlotId, TeamId> = { ...picks };

  // Ascending rounds: each slot is checked after its feeders were pruned.
  for (const slot of allSlots()) {
    const pick = next[slot];
    if (!pick) continue;
    const legal = legalTeamsForSlot(slot, next, bySlot);
    if (legal.length > 0 && !legal.includes(pick)) delete next[slot];
  }
  return next;
}

/** Set a pick and clear anything downstream it invalidates. */
export function setPick(
  picks: Readonly<Record<SlotId, TeamId>>,
  slot: SlotId,
  team: TeamId,
  games: readonly Game[],
): Record<SlotId, TeamId> {
  return prunePicks({ ...picks, [slot]: team }, games);
}
