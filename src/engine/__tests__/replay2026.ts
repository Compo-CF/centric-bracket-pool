/**
 * Replays the real 2026 men's tournament through the engine.
 *
 * The point is not to re-test arithmetic already covered by unit tests. It is
 * to check the bracket MODEL against a bracket that actually happened: if the
 * feed rule or the seed pairings are wrong anywhere, the slots this code
 * generates will not line up with the games that were really played, and the
 * replay cannot complete.
 */

import { buildEmptyBracket, indexTeams, r1SlotFor, seedBracket, slotId } from '../bracket.js';
import { recordResult } from '../results.js';
import { setPick } from '../validate.js';
import {
  ROUNDS, SLOTS_PER_ROUND,
  type Game, type RegionIndex, type Round, type SlotId, type Team, type TeamId,
} from '../types.js';

import data from './fixtures/ncaa-2026.json' with { type: 'json' };

interface RawGame { r: number; a: string; b: string; w: string; sa: number; sb: number }

/**
 * Region indices have to reflect who actually met in the semi-finals, not
 * alphabetical order: regions 1 and 2 feed R5-01, regions 3 and 4 feed R5-02.
 */
export function regionIndices(): Map<string, RegionIndex> {
  const out = new Map<string, RegionIndex>();
  data.semis.forEach((pair, semi) => {
    pair.forEach((name, side) => {
      out.set(name, ((semi * 2) + side + 1) as RegionIndex);
    });
  });
  return out;
}

export function field2026(): Team[] {
  const regions = regionIndices();
  return data.field.map((t) => {
    const region = regions.get(t.region);
    if (!region) throw new Error(`Unknown region ${t.region}`);
    return {
      id: t.id, name: t.name, seed: t.seed, region, espnId: t.id, eliminated: false,
    };
  });
}

export interface ReplaySnapshot {
  round: Round;
  games: Game[];
}

export interface Replay {
  teams: Team[];
  /** Bracket before any game is played. */
  initial: Game[];
  /** State after each round, rounds 1 to 6. */
  snapshots: ReplaySnapshot[];
  /** Final state, all 63 decided. */
  final: Game[];
  /** Actual winner of every slot, i.e. a perfect bracket. */
  actual: Record<SlotId, TeamId>;
  championshipTotal: number;
}

function slotsOf(round: Round): SlotId[] {
  return Array.from({ length: SLOTS_PER_ROUND[round] }, (_, i) => slotId(round, i + 1));
}

/**
 * Walks the tournament round by round. Each slot is matched to a real game by
 * the pair of teams standing in it -- the same way the results sync job will
 * match an ESPN event to a slot -- so nothing here depends on inferring slot
 * numbers from ESPN's own labelling.
 */
export function replay2026(): Replay {
  const teams = field2026();
  const initial = seedBracket(buildEmptyBracket(), teams);
  let games = initial;

  const unplayed: RawGame[] = [...(data.games as RawGame[])];
  const actual: Record<SlotId, TeamId> = {};
  const snapshots: ReplaySnapshot[] = [];

  for (const round of ROUNDS) {
    for (const slot of slotsOf(round)) {
      const game = games.find((g) => g.slot === slot);
      if (!game?.teamA || !game.teamB) {
        throw new Error(`${slot} has no matchup after round ${round - 1}`);
      }

      const at = unplayed.findIndex((m) =>
        m.r === round &&
        ((m.a === game.teamA && m.b === game.teamB) ||
         (m.b === game.teamA && m.a === game.teamB)));

      if (at === -1) {
        throw new Error(
          `No real 2026 game for ${slot}: ${game.teamA} v ${game.teamB}. ` +
          `The bracket model does not match the tournament that was played.`);
      }

      const [match] = unplayed.splice(at, 1) as [RawGame];
      const flipped = match.a !== game.teamA;
      games = recordResult(games, slot, {
        winner: match.w,
        scoreA: flipped ? match.sb : match.sa,
        scoreB: flipped ? match.sa : match.sb,
        status: 'final',
      });
      actual[slot] = match.w;
    }
    snapshots.push({ round, games });
  }

  if (unplayed.length > 0) {
    throw new Error(`${unplayed.length} real games were never matched to a slot`);
  }

  const finalGame = (data.games as RawGame[]).at(-1)!;
  return {
    teams,
    initial,
    snapshots,
    final: games,
    actual,
    championshipTotal: finalGame.sa + finalGame.sb,
  };
}

/** A bracket that picks the better seed in every game. */
export function chalkBracket(games: readonly Game[], teams: readonly Team[]): Record<SlotId, TeamId> {
  const index = indexTeams(teams);
  let picks: Record<SlotId, TeamId> = {};
  let changed = true;
  while (changed) {
    changed = false;
    for (const round of ROUNDS) {
      for (const slot of slotsOf(round)) {
        if (picks[slot]) continue;
        const sides = round === 1
          ? [games.find((g) => g.slot === slot)?.teamA, games.find((g) => g.slot === slot)?.teamB]
          : [picks[slotId((round - 1) as Round, 2 * Number(slot.slice(3)) - 1)],
             picks[slotId((round - 1) as Round, 2 * Number(slot.slice(3)))]];
        const both = sides.filter((t): t is TeamId => !!t);
        if (both.length !== 2) continue;
        const [x, y] = both as [TeamId, TeamId];
        const better = index.get(x)!.seed <= index.get(y)!.seed ? x : y;
        picks = setPick(picks, slot, better, games);
        changed = true;
      }
    }
  }
  return picks;
}

export { r1SlotFor };
export const CHAMPION_2026 = (data.games as RawGame[]).at(-1)!.w;
