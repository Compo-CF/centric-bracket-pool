/**
 * Scoring, ceilings and ranking.
 *
 * Points are the easy half. The number people actually refresh for is
 * maxPossible -- the ceiling an entry can still reach if every surviving pick
 * wins out. It is also the tiebreak key, so it has to be exactly right.
 */

import { canReachSlot } from './bracket.js';
import { deriveEliminated, isDecided } from './results.js';
import {
  DEFAULT_WEIGHTS, ROUNDS,
  type Entry, type Game, type PoolConfig, type Round, type Standing,
  type Team, type TeamId,
} from './types.js';

export const CHAMPIONSHIP_SLOT = 'R6-01';

function emptyByRound(): Record<Round, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
}

export interface EntryEvaluation {
  points: number;
  maxPossible: number;
  correct: number;
  byRound: Record<Round, number>;
  champion: TeamId | null;
  championAlive: boolean;
}

/**
 * Score one entry and compute its ceiling in a single pass.
 *
 * A future slot contributes to the ceiling only if the picked team is both
 * still alive AND could actually reach that slot. The second check makes the
 * ceiling honest even for an entry that was never validated -- without it, a
 * nonsense pick would inflate someone's ceiling forever.
 */
export function evaluateEntry(
  entry: Entry,
  games: readonly Game[],
  teams: ReadonlyMap<TeamId, Team>,
  weights: Record<Round, number> = DEFAULT_WEIGHTS,
  eliminated?: ReadonlySet<TeamId>,
): EntryEvaluation {
  const dead = eliminated ?? deriveEliminated(games);
  const byRound = emptyByRound();
  let points = 0;
  let correct = 0;
  let reachable = 0;

  for (const game of games) {
    const pick = entry.picks[game.slot];
    const weight = weights[game.round];

    if (isDecided(game)) {
      if (pick && pick === game.winner) {
        points += weight;
        byRound[game.round] += weight;
        correct += 1;
      }
      continue;
    }

    if (!pick || dead.has(pick)) continue;
    const team = teams.get(pick);
    if (!team) continue;
    if (!canReachSlot(team.region, team.seed, game.slot)) continue;
    reachable += weight;
  }

  const champion = entry.picks[CHAMPIONSHIP_SLOT] ?? null;

  return {
    points,
    maxPossible: points + reachable,
    correct,
    byRound,
    champion,
    championAlive: champion !== null && !dead.has(champion),
  };
}

/**
 * Tiebreaker distance, lower is better. Closest to the real championship
 * total without going over; anyone over ranks behind everyone under.
 */
export function tiebreakDistance(guess: number | null, actual: number | null): number {
  if (guess === null) return Number.POSITIVE_INFINITY;
  if (actual === null) return 0;
  return guess <= actual ? actual - guess : 1_000_000 + (guess - actual);
}

/** Combined score of the title game, once it is final. Null until then. */
export function championshipTotal(games: readonly Game[]): number | null {
  const final = games.find((g) => g.slot === CHAMPIONSHIP_SLOT);
  if (!final || !isDecided(final) || final.scoreA === null || final.scoreB === null) return null;
  return final.scoreA + final.scoreB;
}

/**
 * Rank every entry. Order is points, then ceiling, then the tiebreaker, then
 * submission time so the ordering is stable across recomputes. Entries level
 * on points share a rank, and the next distinct score skips accordingly.
 */
export function buildStandings(
  entries: readonly Entry[],
  games: readonly Game[],
  teams: readonly Team[],
  config?: Pick<PoolConfig, 'weights'>,
): Standing[] {
  const weights = config?.weights ?? DEFAULT_WEIGHTS;
  const teamIndex = new Map(teams.map((t) => [t.id, t]));
  const dead = deriveEliminated(games);
  const actualTotal = championshipTotal(games);

  const rows = entries.map((entry) => {
    const evaluation = evaluateEntry(entry, games, teamIndex, weights, dead);
    return {
      entry,
      evaluation,
      distance: tiebreakDistance(entry.tiebreaker, actualTotal),
    };
  });

  rows.sort((a, b) =>
    b.evaluation.points - a.evaluation.points ||
    b.evaluation.maxPossible - a.evaluation.maxPossible ||
    a.distance - b.distance ||
    (a.entry.submittedAt ?? '').localeCompare(b.entry.submittedAt ?? '') ||
    a.entry.id.localeCompare(b.entry.id),
  );

  const standings: Standing[] = [];
  let rank = 0;
  let lastPoints: number | null = null;

  rows.forEach((row, i) => {
    if (row.evaluation.points !== lastPoints) {
      rank = i + 1;
      lastPoints = row.evaluation.points;
    }
    standings.push({
      entryId: row.entry.id,
      entryName: row.entry.name,
      ownerName: row.entry.ownerName,
      rank,
      points: row.evaluation.points,
      maxPossible: row.evaluation.maxPossible,
      correct: row.evaluation.correct,
      byRound: row.evaluation.byRound,
      champion: row.evaluation.champion,
      championAlive: row.evaluation.championAlive,
      tiebreaker: row.entry.tiebreaker,
    });
  });

  return standings;
}

/** Points still on the board across all undecided games. */
export function pointsRemaining(
  games: readonly Game[],
  weights: Record<Round, number> = DEFAULT_WEIGHTS,
): number {
  return games.reduce((sum, g) => (isDecided(g) ? sum : sum + weights[g.round]), 0);
}

/** How the pool split on a given slot, for the scoreboard's pick-share column. */
export function pickDistribution(
  entries: readonly Entry[],
  slot: string,
): Map<TeamId, number> {
  const counts = new Map<TeamId, number>();
  for (const entry of entries) {
    const pick = entry.picks[slot];
    if (!pick) continue;
    counts.set(pick, (counts.get(pick) ?? 0) + 1);
  }
  return counts;
}

export { ROUNDS };
