import { describe, expect, it } from 'vitest';
import { legalTeamsForSlot, prunePicks, setPick, validateEntry } from '../validate.js';
import { TOTAL_SLOTS } from '../types.js';
import { chalkPicks, makeEntry, seededBracket, teamId } from './fixtures.js';

function setup() {
  const { games, teams } = seededBracket();
  return { games, teams, picks: chalkPicks(games, teams) };
}

describe('legal teams for a slot', () => {
  it('reads the real field in round 1', () => {
    const { games } = setup();
    expect(legalTeamsForSlot('R1-01', {}, games)).toEqual([teamId(1, 1), teamId(1, 16)]);
  });

  it('reads the entry own picks in later rounds', () => {
    const { games } = setup();
    const picks = { 'R1-01': teamId(1, 16), 'R1-02': teamId(1, 9) };
    expect(legalTeamsForSlot('R2-01', picks, games)).toEqual([teamId(1, 16), teamId(1, 9)]);
  });

  it('is empty when the feeding picks have not been made', () => {
    const { games } = setup();
    expect(legalTeamsForSlot('R2-01', {}, games)).toEqual([]);
  });
});

describe('validating an entry', () => {
  it('accepts a complete, internally consistent bracket', () => {
    const { games, picks } = setup();
    const result = validateEntry(makeEntry('a', picks), games);
    expect(result.valid).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.picksMade).toBe(TOTAL_SLOTS);
    expect(result.problems).toEqual([]);
  });

  it('counts an in-progress bracket without calling it invalid on missing picks alone', () => {
    const { games } = setup();
    const result = validateEntry(makeEntry('a', { 'R1-01': teamId(1, 1) }), games);
    expect(result.complete).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.picksMade).toBe(1);
    expect(result.problems.every((p) => p.kind === 'missing')).toBe(true);
    expect(result.problems).toHaveLength(TOTAL_SLOTS - 1);
  });

  it('rejects advancing a team the entry already knocked out', () => {
    const { games, picks } = setup();
    const cheating = { ...picks, 'R1-01': teamId(1, 16) };
    const result = validateEntry(makeEntry('a', cheating), games);
    expect(result.valid).toBe(false);
    const illegal = result.problems.filter((p) => p.kind === 'illegal');
    expect(illegal.length).toBeGreaterThan(0);
    expect(illegal[0]!.slot).toBe('R2-01');
    expect(illegal[0]!.message).toMatch(/cannot reach R2-01/);
  });

  it('rejects a team from another region entirely', () => {
    const { games, picks } = setup();
    const result = validateEntry(makeEntry('a', { ...picks, 'R1-01': teamId(3, 5) }), games);
    expect(result.problems.some((p) => p.kind === 'illegal' && p.slot === 'R1-01')).toBe(true);
  });
});

describe('pruning', () => {
  it('leaves a consistent bracket untouched', () => {
    const { games, picks } = setup();
    expect(prunePicks(picks, games)).toEqual(picks);
  });

  it('clears the whole downstream chain when a round-1 pick flips', () => {
    const { games, picks } = setup();
    const pruned = setPick(picks, 'R1-01', teamId(1, 16), games);
    expect(pruned['R1-01']).toBe(teamId(1, 16));
    // The 1 seed was picked to win all six of its games; five are now gone.
    for (const slot of ['R2-01', 'R3-01', 'R4-01', 'R5-01', 'R6-01']) {
      expect(pruned[slot]).toBeUndefined();
    }
  });

  it('keeps picks in untouched parts of the bracket', () => {
    const { games, picks } = setup();
    const pruned = setPick(picks, 'R1-01', teamId(1, 16), games);
    expect(pruned['R1-09']).toBe(picks['R1-09']);
    expect(pruned['R4-02']).toBe(picks['R4-02']);
    expect(pruned['R5-02']).toBe(picks['R5-02']);
  });

  it('produces a bracket that validates cleanly again', () => {
    const { games, picks } = setup();
    const pruned = setPick(picks, 'R1-01', teamId(1, 16), games);
    const problems = validateEntry(makeEntry('a', pruned), games).problems;
    expect(problems.every((p) => p.kind === 'missing')).toBe(true);
  });

  it('is idempotent', () => {
    const { games, picks } = setup();
    const once = prunePicks(picks, games);
    expect(prunePicks(once, games)).toEqual(once);
  });

  it('does not mutate the picks it was given', () => {
    const { games, picks } = setup();
    const before = { ...picks };
    setPick(picks, 'R1-01', teamId(1, 16), games);
    expect(picks).toEqual(before);
  });
});
