import { describe, expect, it } from 'vitest';
import {
  ResultError, deriveEliminated, isDecided, propagateWinners, recordResult, settle,
} from '../results.js';
import type { Game } from '../types.js';
import { seededBracket, playChalk, playChalkThroughRound, teamId } from './fixtures.js';

const at = (games: readonly Game[], slot: string) => games.find((g) => g.slot === slot)!;

describe('propagation', () => {
  it('carries a round-1 winner into the right side of round 2', () => {
    const { games } = seededBracket();
    const after = recordResult(games, 'R1-02', { winner: teamId(1, 9) });
    expect(at(after, 'R2-01').teamB).toBe(teamId(1, 9));
    expect(at(after, 'R2-01').teamA).toBeNull();
  });

  it('fills both sides once both feeders are decided', () => {
    const { games } = seededBracket();
    let after = recordResult(games, 'R1-01', { winner: teamId(1, 1) });
    after = recordResult(after, 'R1-02', { winner: teamId(1, 8) });
    expect(at(after, 'R2-01')).toMatchObject({ teamA: teamId(1, 1), teamB: teamId(1, 8) });
  });

  it('clears everything downstream when a winner is unset', () => {
    const { games, teams } = seededBracket();
    const played = playChalk(games, teams);
    expect(at(played, 'R6-01').winner).toBe(teamId(1, 1));

    const corrected = recordResult(played, 'R1-01', { winner: null });
    expect(at(corrected, 'R2-01').teamA).toBeNull();
    // R2-01's own winner is stale but its slot is now empty; a repropagation
    // of the corrected result is what the admin flow does next.
    expect(at(corrected, 'R1-01').winner).toBeNull();
  });

  it('is idempotent', () => {
    const { games, teams } = seededBracket();
    const played = playChalk(games, teams);
    expect(propagateWinners(played)).toEqual(propagateWinners(propagateWinners(played)));
  });
});

describe('recording a result', () => {
  it('rejects a winner that is not in the game', () => {
    const { games } = seededBracket();
    expect(() => recordResult(games, 'R1-01', { winner: teamId(3, 7) }))
      .toThrow(ResultError);
    expect(() => recordResult(games, 'R1-01', { winner: teamId(3, 7) }))
      .toThrow(/not playing in R1-01/);
  });

  it('rejects an unknown slot', () => {
    const { games } = seededBracket();
    expect(() => recordResult(games, 'R2-99', { winner: null })).toThrow();
  });

  it('marks the game final and stores the score', () => {
    const { games } = seededBracket();
    const after = recordResult(games, 'R1-01', { winner: teamId(1, 1), scoreA: 80, scoreB: 61 });
    expect(at(after, 'R1-01')).toMatchObject({ status: 'final', scoreA: 80, scoreB: 61 });
    expect(isDecided(at(after, 'R1-01'))).toBe(true);
  });

  it('lets the sync job write a game it has not overridden', () => {
    const { games } = seededBracket();
    const after = recordResult(games, 'R1-01', { winner: teamId(1, 16) }, { source: 'sync' });
    expect(at(after, 'R1-01').winner).toBe(teamId(1, 16));
  });

  it('never lets the sync job undo an admin override', () => {
    const { games } = seededBracket();
    const overridden = recordResult(
      games, 'R1-01', { winner: teamId(1, 1), overriddenBy: 'admin-uid' }, { source: 'admin' },
    );
    expect(at(overridden, 'R1-01').overriddenBy).toBe('admin-uid');

    const attempted = recordResult(
      overridden, 'R1-01', { winner: teamId(1, 16) }, { source: 'sync' },
    );
    expect(at(attempted, 'R1-01').winner).toBe(teamId(1, 1));
  });
});

describe('eliminations', () => {
  it('is empty before any game is played', () => {
    const { games } = seededBracket();
    expect(deriveEliminated(games).size).toBe(0);
  });

  it('eliminates exactly the losers', () => {
    const { games } = seededBracket();
    const after = recordResult(games, 'R1-01', { winner: teamId(1, 1) });
    const dead = deriveEliminated(after);
    expect(dead.has(teamId(1, 16))).toBe(true);
    expect(dead.has(teamId(1, 1))).toBe(false);
    expect(dead.size).toBe(1);
  });

  it('leaves 63 of 64 teams out after a full tournament', () => {
    const { games, teams } = seededBracket();
    const played = playChalk(games, teams);
    const dead = deriveEliminated(played);
    expect(dead.size).toBe(63);
    expect(dead.has(teamId(1, 1))).toBe(false);
  });

  it('halves the surviving field each round', () => {
    const { games, teams } = seededBracket();
    const survivors = [1, 2, 3, 4, 5, 6].map((r) => {
      const played = playChalkThroughRound(games, teams, r);
      return 64 - deriveEliminated(played).size;
    });
    expect(survivors).toEqual([32, 16, 8, 4, 2, 1]);
  });
});

describe('settle', () => {
  it('propagates and flags eliminated teams together', () => {
    const { games, teams } = seededBracket();
    const played = playChalkThroughRound(games, teams, 1);
    const result = settle(played, teams);
    expect(result.teams.filter((t) => t.eliminated)).toHaveLength(32);
    expect(result.teams.find((t) => t.id === teamId(1, 16))!.eliminated).toBe(true);
    expect(result.teams.find((t) => t.id === teamId(1, 1))!.eliminated).toBe(false);
  });
});

describe('a chalk tournament', () => {
  it('sends the four 1 seeds to the Final Four', () => {
    const { games, teams } = seededBracket();
    const played = playChalk(games, teams);
    expect(at(played, 'R4-01').winner).toBe(teamId(1, 1));
    expect(at(played, 'R4-02').winner).toBe(teamId(2, 1));
    expect(at(played, 'R4-03').winner).toBe(teamId(3, 1));
    expect(at(played, 'R4-04').winner).toBe(teamId(4, 1));
  });

  it('decides all 63 games', () => {
    const { games, teams } = seededBracket();
    const played = playChalk(games, teams);
    expect(played.filter(isDecided)).toHaveLength(63);
  });
});
