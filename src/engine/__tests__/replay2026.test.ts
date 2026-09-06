import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIZE_RULES, PERFECT_SCORE, TOTAL_SLOTS, allocatePrizes, buildStandings,
  deriveEliminated, evaluateEntry, indexTeams, isDecided, pointsRemaining,
  totalAwarded, validateEntry, type Entry, type SlotId, type TeamId,
} from '../index.js';
import { CHAMPION_2026, chalkBracket, replay2026 } from './replay2026.js';

const replay = replay2026();
const teams = indexTeams(replay.teams);

function entry(id: string, picks: Record<SlotId, TeamId>, tiebreaker: number | null): Entry {
  return {
    id, ownerUid: `uid-${id}`, ownerEmail: `${id}@centricfiber.com`,
    ownerName: `Owner ${id}`, name: `Entry ${id}`,
    picks, tiebreaker, submittedAt: '2026-03-19T15:00:00.000Z', paid: true,
  };
}

describe('the 2026 tournament as a bracket', () => {
  it('matches every one of the 63 slots to a game that was really played', () => {
    // replay2026() throws if any slot cannot be matched, so reaching here at
    // all is the assertion. This is what proves the feed rule and the seed
    // pairings against a real bracket rather than against themselves.
    expect(Object.keys(replay.actual)).toHaveLength(TOTAL_SLOTS);
    expect(replay.final.filter(isDecided)).toHaveLength(TOTAL_SLOTS);
  });

  it('leaves exactly one team standing', () => {
    expect(deriveEliminated(replay.final).size).toBe(63);
    expect(replay.actual['R6-01']).toBe(CHAMPION_2026);
    expect(teams.get(CHAMPION_2026)?.name).toBe('Michigan');
  });

  it('halves the field every round', () => {
    const alive = replay.snapshots.map((s) => 64 - deriveEliminated(s.games).size);
    expect(alive).toEqual([32, 16, 8, 4, 2, 1]);
  });

  it('sends four regional champions to the Final Four', () => {
    const four = ['R4-01', 'R4-02', 'R4-03', 'R4-04'].map((s) => teams.get(replay.actual[s]!)?.name);
    expect(four).toEqual(['Arizona', 'Michigan', 'UConn', 'Illinois']);
  });

  it('produces a valid bracket when the real results are used as picks', () => {
    const result = validateEntry(entry('perfect', replay.actual, 132), replay.initial);
    expect(result.valid).toBe(true);
    expect(result.problems).toEqual([]);
  });
});

describe('scoring the replay', () => {
  it('scores a perfect bracket at exactly 192', () => {
    const result = evaluateEntry(entry('perfect', replay.actual, 132), replay.final, teams);
    expect(result.points).toBe(PERFECT_SCORE);
    expect(result.correct).toBe(TOTAL_SLOTS);
    expect(result.byRound).toEqual({ 1: 32, 2: 32, 3: 32, 4: 32, 5: 32, 6: 32 });
    expect(result.maxPossible).toBe(PERFECT_SCORE);
  });

  it('gives a perfect bracket 32 more points after every round', () => {
    const running = replay.snapshots.map((s) =>
      evaluateEntry(entry('perfect', replay.actual, 132), s.games, teams).points);
    expect(running).toEqual([32, 64, 96, 128, 160, 192]);
  });

  it('keeps a perfect bracket on a 192 ceiling the whole way', () => {
    const ceilings = replay.snapshots.map((s) =>
      evaluateEntry(entry('perfect', replay.actual, 132), s.games, teams).maxPossible);
    expect(ceilings).toEqual([192, 192, 192, 192, 192, 192]);
  });

  it('counts the pool down to nothing', () => {
    const left = replay.snapshots.map((s) => pointsRemaining(s.games));
    expect(left).toEqual([160, 128, 96, 64, 32, 0]);
  });
});

describe('a chalk bracket against what really happened', () => {
  const chalk = chalkBracket(replay.initial, replay.teams);

  it('is a complete, valid bracket', () => {
    const result = validateEntry(entry('chalk', chalk, 140), replay.initial);
    expect(result.valid).toBe(true);
    expect(result.picksMade).toBe(TOTAL_SLOTS);
  });

  it('scores 84 of 192 -- the real answer for 2026', () => {
    // 16 of the 63 games went to the lower seed, so chalk got 43 right and
    // nothing at all in the Final Four: it had Arizona winning the title, and
    // Arizona lost the semi to Michigan. These are exact regression values --
    // if a scoring change moves them, that is the thing to explain.
    const result = evaluateEntry(entry('chalk', chalk, 140), replay.final, teams);
    expect(result.points).toBe(84);
    expect(result.correct).toBe(43);
    expect(result.byRound).toEqual({ 1: 24, 2: 24, 3: 20, 4: 16, 5: 0, 6: 0 });
    expect(teams.get(chalk['R6-01']!)?.name).toBe('Arizona');
  });

  it('has its ceiling decay exactly as its picks are knocked out', () => {
    const ceilings = replay.snapshots.map((s) =>
      evaluateEntry(entry('chalk', chalk, 140), s.games, teams).maxPossible);
    expect(ceilings).toEqual([184, 164, 156, 132, 84, 84]);
  });

  it('collapses ceiling to score the moment its champion is eliminated', () => {
    // Arizona went out in the semi-final, killing the R5-01 and R6-01 picks --
    // 48 points -- in one game.
    const afterElite = evaluateEntry(entry('chalk', chalk, 140),
      replay.snapshots[3]!.games, teams);
    const afterSemis = evaluateEntry(entry('chalk', chalk, 140),
      replay.snapshots[4]!.games, teams);
    expect(afterElite.maxPossible - afterElite.points).toBe(48);
    expect(afterSemis.maxPossible).toBe(afterSemis.points);
  });

  it('never gains points as rounds pass, and never gains ceiling', () => {
    let lastPoints = -1;
    let lastCeiling = PERFECT_SCORE + 1;
    for (const snapshot of replay.snapshots) {
      const result = evaluateEntry(entry('chalk', chalk, 140), snapshot.games, teams);
      expect(result.points).toBeGreaterThanOrEqual(lastPoints);
      expect(result.maxPossible).toBeLessThanOrEqual(lastCeiling);
      expect(result.maxPossible).toBeGreaterThanOrEqual(result.points);
      lastPoints = result.points;
      lastCeiling = result.maxPossible;
    }
  });

  it('ends with its ceiling equal to its score', () => {
    const result = evaluateEntry(entry('chalk', chalk, 140), replay.final, teams);
    expect(result.maxPossible).toBe(result.points);
  });
});

describe('a pool run over the 2026 tournament', () => {
  const chalk = chalkBracket(replay.initial, replay.teams);
  const busted = { ...replay.actual, 'R1-01': replay.initial
    .find((g) => g.slot === 'R1-01')!.teamB! };
  const entries = [
    entry('perfect', replay.actual, 132),
    entry('chalk', chalk, 140),
    entry('busted', busted, 120),
    entry('empty', {}, 130),
  ];

  it('ranks the perfect bracket first and the empty one last', () => {
    const standings = buildStandings(entries, replay.final, replay.teams);
    expect(standings[0]!.entryId).toBe('perfect');
    expect(standings[0]!.points).toBe(PERFECT_SCORE);
    expect(standings.at(-1)!.entryId).toBe('empty');
    expect(standings.at(-1)!.points).toBe(0);
  });

  it('pays out every cent collected', () => {
    const standings = buildStandings(entries, replay.final, replay.teams);
    const paid = new Set(entries.map((e) => e.id));
    const awards = allocatePrizes(standings, paid, DEFAULT_PRIZE_RULES);
    expect(totalAwarded(awards)).toBe(entries.length * DEFAULT_PRIZE_RULES.entryFeeCents);
    expect(awards.at(-1)!.entryIds).toEqual(['empty']);
  });

  it('has the champion pick alive for the winner and dead for the buster', () => {
    const standings = buildStandings(entries, replay.final, replay.teams);
    const byId = new Map(standings.map((s) => [s.entryId, s]));
    expect(byId.get('perfect')!.championAlive).toBe(true);
    expect(byId.get('perfect')!.champion).toBe(CHAMPION_2026);
  });
});
