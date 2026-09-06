import { describe, expect, it } from 'vitest';
import {
  CHAMPIONSHIP_SLOT, buildStandings, championshipTotal, evaluateEntry,
  pickDistribution, pointsRemaining, tiebreakDistance,
} from '../scoring.js';
import { indexTeams } from '../bracket.js';
import { recordResult } from '../results.js';
import { DEFAULT_WEIGHTS, PERFECT_SCORE } from '../types.js';
import {
  GAME_TOTAL, chalkPicks, makeEntry, playChalk, playChalkThroughRound,
  seededBracket, teamId,
} from './fixtures.js';

function setup() {
  const { games, teams } = seededBracket();
  const picks = chalkPicks(games, teams);
  return { games, teams, picks, index: indexTeams(teams) };
}

describe('a perfect bracket', () => {
  it('scores exactly 192', () => {
    const { games, teams, picks, index } = setup();
    const played = playChalk(games, teams);
    const result = evaluateEntry(makeEntry('perfect', picks), played, index);
    expect(result.points).toBe(PERFECT_SCORE);
    expect(result.correct).toBe(63);
  });

  it('earns exactly 32 points in every round', () => {
    const { games, teams, picks, index } = setup();
    const played = playChalk(games, teams);
    const result = evaluateEntry(makeEntry('perfect', picks), played, index);
    expect(result.byRound).toEqual({ 1: 32, 2: 32, 3: 32, 4: 32, 5: 32, 6: 32 });
  });

  it('has a ceiling equal to its score once the tournament is over', () => {
    const { games, teams, picks, index } = setup();
    const played = playChalk(games, teams);
    const result = evaluateEntry(makeEntry('perfect', picks), played, index);
    expect(result.maxPossible).toBe(result.points);
  });
});

describe('the ceiling', () => {
  it('starts at 192 for a complete entry before any game is played', () => {
    const { games, picks, index } = setup();
    const result = evaluateEntry(makeEntry('a', picks), games, index);
    expect(result.points).toBe(0);
    expect(result.maxPossible).toBe(PERFECT_SCORE);
  });

  it('stays at 192 while every pick keeps winning', () => {
    const { games, teams, picks, index } = setup();
    const played = playChalkThroughRound(games, teams, 1);
    const result = evaluateEntry(makeEntry('a', picks), played, index);
    expect(result.points).toBe(32);
    expect(result.maxPossible).toBe(PERFECT_SCORE);
  });

  it('drops by the whole cascade when a picked champion loses in round 1', () => {
    const { games, picks, index } = setup();
    // The 16 seed knocks out the region-1 top seed, which this entry had
    // winning all six of its games: 1 + 2 + 4 + 8 + 16 + 32 = 63 points gone.
    const upset = recordResult(games, 'R1-01', { winner: teamId(1, 16) });
    const result = evaluateEntry(makeEntry('a', picks), upset, index);
    expect(result.points).toBe(0);
    expect(result.maxPossible).toBe(PERFECT_SCORE - 63);
    expect(result.championAlive).toBe(false);
  });

  it('ignores a pick for a slot that team could never reach', () => {
    const { games, index } = setup();
    // Region 1 plays into R5-01, never R5-02, so this pick is worth nothing
    // even though the team is very much alive.
    const nonsense = makeEntry('bad', { 'R5-02': teamId(1, 1) });
    expect(evaluateEntry(nonsense, games, index).maxPossible).toBe(0);

    const legitimate = makeEntry('good', { 'R5-01': teamId(1, 1) });
    expect(evaluateEntry(legitimate, games, index).maxPossible).toBe(DEFAULT_WEIGHTS[5]);
  });

  it('is zero for an entry with no picks', () => {
    const { games, index } = setup();
    const result = evaluateEntry(makeEntry('empty', {}), games, index);
    expect(result).toMatchObject({ points: 0, maxPossible: 0, correct: 0, champion: null });
    expect(result.championAlive).toBe(false);
  });

  it('never counts an eliminated team, even in a slot it had reached', () => {
    const { games, teams, index } = setup();
    const played = playChalkThroughRound(games, teams, 1);
    const entry = makeEntry('a', { 'R2-01': teamId(1, 16) }); // lost in round 1
    expect(evaluateEntry(entry, played, index).maxPossible).toBe(0);
  });
});

describe('the champion flag', () => {
  it('tracks the title pick, not the current leader', () => {
    const { games, teams, picks, index } = setup();
    const played = playChalkThroughRound(games, teams, 4);
    const result = evaluateEntry(makeEntry('a', picks), played, index);
    expect(result.champion).toBe(teamId(1, 1));
    expect(result.championAlive).toBe(true);
    expect(picks[CHAMPIONSHIP_SLOT]).toBe(teamId(1, 1));
  });
});

describe('tiebreaker', () => {
  it('rewards the closest guess that did not go over', () => {
    expect(tiebreakDistance(GAME_TOTAL, GAME_TOTAL)).toBe(0);
    expect(tiebreakDistance(GAME_TOTAL - 5, GAME_TOTAL)).toBe(5);
    expect(tiebreakDistance(GAME_TOTAL - 20, GAME_TOTAL)).toBe(20);
  });

  it('ranks anyone over the total behind everyone under it', () => {
    const under = tiebreakDistance(GAME_TOTAL - 40, GAME_TOTAL);
    const over = tiebreakDistance(GAME_TOTAL + 1, GAME_TOTAL);
    expect(over).toBeGreaterThan(under);
  });

  it('puts a missing guess last', () => {
    expect(tiebreakDistance(null, GAME_TOTAL)).toBe(Number.POSITIVE_INFINITY);
  });

  it('is inert until the championship is final', () => {
    const { games, teams } = setup();
    expect(championshipTotal(games)).toBeNull();
    expect(tiebreakDistance(999, null)).toBe(0);
    expect(championshipTotal(playChalk(games, teams))).toBe(GAME_TOTAL);
  });
});

describe('standings', () => {
  it('ranks by points and shares a rank on a tie', () => {
    const { games, teams, picks } = setup();
    const played = playChalkThroughRound(games, teams, 1);
    const standings = buildStandings(
      [makeEntry('a', picks), makeEntry('b', picks), makeEntry('c', {})],
      played,
      teams,
    );
    expect(standings.map((s) => s.points)).toEqual([32, 32, 0]);
    expect(standings.map((s) => s.rank)).toEqual([1, 1, 3]);
  });

  it('breaks a points tie on the higher ceiling', () => {
    const { games, teams, picks } = setup();
    const standings = buildStandings(
      [makeEntry('narrow', { 'R1-01': teamId(1, 1) }), makeEntry('full', picks)],
      games,
      teams,
    );
    expect(standings[0]!.entryId).toBe('full');
    expect(standings[0]!.maxPossible).toBe(PERFECT_SCORE);
    expect(standings[1]!.maxPossible).toBe(1);
  });

  it('breaks a points and ceiling tie on the tiebreaker', () => {
    const { games, teams, picks } = setup();
    const played = playChalk(games, teams);
    const standings = buildStandings(
      [
        makeEntry('over', picks, { tiebreaker: GAME_TOTAL + 10 }),
        makeEntry('exact', picks, { tiebreaker: GAME_TOTAL }),
        makeEntry('under', picks, { tiebreaker: GAME_TOTAL - 3 }),
      ],
      played,
      teams,
    );
    expect(standings.map((s) => s.entryId)).toEqual(['exact', 'under', 'over']);
    expect(standings.every((s) => s.rank === 1)).toBe(true);
  });

  it('is stable regardless of input order', () => {
    const { games, teams, picks } = setup();
    const played = playChalkThroughRound(games, teams, 2);
    const entries = [makeEntry('a', picks), makeEntry('b', picks), makeEntry('c', picks)];
    expect(buildStandings(entries, played, teams))
      .toEqual(buildStandings([...entries].reverse(), played, teams));
  });

  it('carries the round breakdown through', () => {
    const { games, teams, picks } = setup();
    const played = playChalkThroughRound(games, teams, 2);
    const standings = buildStandings([makeEntry('a', picks)], played, teams);
    expect(standings[0]!.byRound).toEqual({ 1: 32, 2: 32, 3: 0, 4: 0, 5: 0, 6: 0 });
  });
});

describe('pool-wide numbers', () => {
  it('counts down the points still on the board', () => {
    const { games, teams } = setup();
    expect(pointsRemaining(games)).toBe(PERFECT_SCORE);
    expect(pointsRemaining(playChalkThroughRound(games, teams, 1))).toBe(PERFECT_SCORE - 32);
    expect(pointsRemaining(playChalk(games, teams))).toBe(0);
  });

  it('reports how the pool split on a slot', () => {
    const { picks } = setup();
    const contrarian = { ...picks, 'R1-01': teamId(1, 16) };
    const dist = pickDistribution(
      [makeEntry('a', picks), makeEntry('b', picks), makeEntry('c', contrarian)],
      'R1-01',
    );
    expect(dist.get(teamId(1, 1))).toBe(2);
    expect(dist.get(teamId(1, 16))).toBe(1);
  });
});
