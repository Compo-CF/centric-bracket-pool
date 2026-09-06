import { describe, expect, it } from 'vitest';
import {
  ROUNDS, SLOTS_PER_ROUND, buildEmptyBracket, recordResult, seedBracket,
  type Game, type Round, type Team,
} from '../../engine/index.js';
import { field2026 } from '../../engine/__tests__/replay2026.js';
import { matchFinals, matchLiveScores } from '../match.js';
import type { EspnGame } from '../espn.js';
import data from '../../engine/__tests__/fixtures/ncaa-2026.json' with { type: 'json' };

interface RawGame { r: number; a: string; b: string; w: string; sa: number; sb: number }
const RAW = data.games as RawGame[];

function espnGame(raw: RawGame, status: EspnGame['status'] = 'final'): EspnGame {
  return {
    eventId: `e-${raw.a}-${raw.b}`,
    round: raw.r as Round,
    regionName: null,
    isFirstFour: false,
    status,
    tipoff: '2026-03-19T19:00Z',
    competitors: [
      { espnId: raw.a, name: raw.a, seed: null, score: raw.sa, winner: status === 'final' && raw.w === raw.a },
      { espnId: raw.b, name: raw.b, seed: null, score: raw.sb, winner: status === 'final' && raw.w === raw.b },
    ],
  };
}

const teams: Team[] = field2026();
const initial: Game[] = seedBracket(buildEmptyBracket(), teams);

/**
 * Which slot a fixture game belongs to. Derived, never hardcoded: region
 * indices follow the real semi-final pairings, so R1-01 is Arizona v Long
 * Island rather than the fixture's first listed game.
 */
function slotFor(raw: RawGame): string {
  const game = initial.find((g) =>
    (g.teamA === raw.a && g.teamB === raw.b) || (g.teamB === raw.a && g.teamA === raw.b));
  if (!game) throw new Error(`No round-1 slot holds ${raw.a} v ${raw.b}`);
  return game.slot;
}

const DUKE_GAME = RAW.find((g) => g.r === 1 && (g.a === '150' || g.b === '150'))!;

describe('matching the whole 2026 tournament', () => {
  it('places all 63 games, round by round, with nothing left over', () => {
    let games = initial;
    let placed = 0;

    for (const round of ROUNDS) {
      const events = RAW.filter((g) => g.r === round).map((g) => espnGame(g));
      const report = matchFinals(games, teams, events);

      expect(report.unplaced).toEqual([]);
      expect(report.results).toHaveLength(SLOTS_PER_ROUND[round]);
      placed += report.results.length;

      for (const result of report.results) {
        games = recordResult(games, result.slot, {
          winner: result.winner,
          scoreA: result.scoreA,
          scoreB: result.scoreB,
          status: 'final',
          espnEventId: result.espnEventId,
        }, { source: 'sync' });
      }
    }

    expect(placed).toBe(63);
    expect(games.filter((g) => g.winner !== null)).toHaveLength(63);
    expect(games.find((g) => g.slot === 'R6-01')!.winner).toBe('130');
  });

  it('orients scores to the slot, not to ESPN home and away', () => {
    const events = RAW.filter((g) => g.r === 1).map((g) => espnGame(g));
    const report = matchFinals(initial, teams, events);

    for (const result of report.results) {
      const slot = initial.find((g) => g.slot === result.slot)!;
      const raw = RAW.find((g) =>
        (g.a === slot.teamA && g.b === slot.teamB) || (g.b === slot.teamA && g.a === slot.teamB))!;
      const expectedA = raw.a === slot.teamA ? raw.sa : raw.sb;
      expect(result.scoreA).toBe(expectedA);
    }
  });

  it('cannot place a later round before its feeders are decided', () => {
    // R2 games have no matchup yet, so every one of them is reported rather
    // than silently dropped.
    const events = RAW.filter((g) => g.r === 2).map((g) => espnGame(g));
    const report = matchFinals(initial, teams, events);
    expect(report.results).toEqual([]);
    expect(report.unplaced).toHaveLength(16);
    expect(report.unplaced[0]!.reason).toMatch(/no slot currently holds this pair/);
  });
});

describe('guard rails', () => {
  const round1 = RAW.filter((g) => g.r === 1).map((g) => espnGame(g));

  it('reports a team it cannot map instead of guessing', () => {
    const unmapped = teams.map((t) => (t.id === '150' ? { ...t, espnId: null } : t));
    const report = matchFinals(initial, unmapped, round1);
    expect(report.results).toHaveLength(31);
    expect(report.unplaced).toHaveLength(1);
    expect(report.unplaced[0]!.reason).toMatch(/no team mapped to ESPN id 150/);
  });

  it('never overwrites a game an admin has set', () => {
    // Admin says Siena won, ESPN says Duke. The admin decision must stand.
    const slot = slotFor(DUKE_GAME);
    const overridden = recordResult(
      initial, slot, { winner: '2561', overriddenBy: 'admin-uid' }, { source: 'admin' });
    const report = matchFinals(overridden, teams, round1);

    expect(report.skippedOverridden).toEqual([slot]);
    expect(report.results.some((r) => r.slot === slot)).toBe(false);
    expect(overridden.find((g) => g.slot === slot)!.winner).toBe('2561');
  });

  it('ignores a slot that is already decided', () => {
    const slot = slotFor(DUKE_GAME);
    const done = recordResult(initial, slot, { winner: '150' }, { source: 'sync' });
    const report = matchFinals(done, teams, round1);
    expect(report.results.some((r) => r.slot === slot)).toBe(false);
    expect(report.results).toHaveLength(31);
  });

  it('is idempotent -- a second run over the same events changes nothing', () => {
    let games = initial;
    for (const result of matchFinals(games, teams, round1).results) {
      games = recordResult(games, result.slot, { winner: result.winner }, { source: 'sync' });
    }
    expect(matchFinals(games, teams, round1).results).toEqual([]);
  });

  it('skips games that are not final', () => {
    const live = RAW.filter((g) => g.r === 1).map((g) => espnGame(g, 'in_progress'));
    expect(matchFinals(initial, teams, live).results).toEqual([]);
  });
});

describe('live scores', () => {
  it('reports in-progress games against their slots', () => {
    const chosen = RAW.filter((g) => g.r === 1).slice(0, 3);
    const scores = matchLiveScores(initial, teams, chosen.map((g) => espnGame(g, 'in_progress')));
    expect(scores).toHaveLength(3);
    expect(scores.map((s) => s.slot).sort())
      .toEqual(chosen.map(slotFor).sort());
  });

  it('does not report a game that has already been decided', () => {
    const slot = slotFor(DUKE_GAME);
    const done = recordResult(initial, slot, { winner: '150' }, { source: 'sync' });
    expect(matchLiveScores(done, teams, [espnGame(DUKE_GAME, 'in_progress')])).toEqual([]);
  });
});
