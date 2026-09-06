/**
 * Synthetic field and helpers. Team ids encode region and seed (r1s01) so any
 * failing assertion names the exact seed line that broke.
 */

import { allSlots, seedBracket, buildEmptyBracket } from '../bracket.js';
import { recordResult } from '../results.js';
import { legalTeamsForSlot } from '../validate.js';
import type { Entry, Game, RegionIndex, SlotId, Team, TeamId } from '../types.js';

export const WINNING_SCORE = 75;
export const LOSING_SCORE = 65;
export const GAME_TOTAL = WINNING_SCORE + LOSING_SCORE; // 140

export function teamId(region: number, seed: number): TeamId {
  return `r${region}s${String(seed).padStart(2, '0')}`;
}

/** A full, well-formed 64-team field. */
export function makeField(): Team[] {
  const teams: Team[] = [];
  for (let region = 1 as RegionIndex; region <= 4; region++) {
    for (let seed = 1; seed <= 16; seed++) {
      teams.push({
        id: teamId(region, seed),
        name: `Region ${region} Seed ${seed}`,
        seed,
        region: region as RegionIndex,
        espnId: null,
        eliminated: false,
      });
    }
  }
  return teams;
}

export function seededBracket(): { games: Game[]; teams: Team[] } {
  const teams = makeField();
  return { games: seedBracket(buildEmptyBracket(), teams), teams };
}

export function indexBySeed(teams: readonly Team[]): Map<TeamId, Team> {
  return new Map(teams.map((t) => [t.id, t]));
}

function betterSeed(candidates: readonly TeamId[], teams: ReadonlyMap<TeamId, Team>): TeamId {
  let best = candidates[0]!;
  for (const c of candidates) {
    if (teams.get(c)!.seed < teams.get(best)!.seed) best = c;
  }
  return best;
}

/** A bracket where the better seed always advances. */
export function chalkPicks(games: readonly Game[], teams: readonly Team[]): Record<SlotId, TeamId> {
  const index = indexBySeed(teams);
  const picks: Record<SlotId, TeamId> = {};
  for (const slot of allSlots()) {
    const legal = legalTeamsForSlot(slot, picks, games);
    if (legal.length === 0) continue;
    picks[slot] = betterSeed(legal, index);
  }
  return picks;
}

/** Play the tournament out with the better seed always winning. */
export function playChalk(games: readonly Game[], teams: readonly Team[]): Game[] {
  const index = indexBySeed(teams);
  let current = [...games];
  for (const slot of allSlots()) {
    const game = current.find((g) => g.slot === slot)!;
    const sides = [game.teamA, game.teamB].filter((t): t is TeamId => t !== null);
    if (sides.length !== 2) continue;
    const winner = betterSeed(sides, index);
    current = recordResult(current, slot, {
      winner,
      scoreA: game.teamA === winner ? WINNING_SCORE : LOSING_SCORE,
      scoreB: game.teamB === winner ? WINNING_SCORE : LOSING_SCORE,
      status: 'final',
    });
  }
  return current;
}

/** Play only the first n rounds, better seed winning. */
export function playChalkThroughRound(
  games: readonly Game[],
  teams: readonly Team[],
  lastRound: number,
): Game[] {
  const index = indexBySeed(teams);
  let current = [...games];
  for (const slot of allSlots()) {
    const game = current.find((g) => g.slot === slot)!;
    if (game.round > lastRound) break;
    const sides = [game.teamA, game.teamB].filter((t): t is TeamId => t !== null);
    if (sides.length !== 2) continue;
    const winner = betterSeed(sides, index);
    current = recordResult(current, slot, {
      winner,
      scoreA: game.teamA === winner ? WINNING_SCORE : LOSING_SCORE,
      scoreB: game.teamB === winner ? WINNING_SCORE : LOSING_SCORE,
      status: 'final',
    });
  }
  return current;
}

export function makeEntry(
  id: string,
  picks: Record<SlotId, TeamId>,
  overrides: Partial<Entry> = {},
): Entry {
  return {
    id,
    ownerUid: `uid-${id}`,
    ownerEmail: `${id}@centricfiber.com`,
    ownerName: `Owner ${id}`,
    name: `Entry ${id}`,
    picks,
    tiebreaker: GAME_TOTAL,
    submittedAt: '2027-03-18T16:00:00.000Z',
    paid: false,
    ...overrides,
  };
}
