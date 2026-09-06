import { describe, expect, it } from 'vitest';
import {
  allSlots, buildEmptyBracket, canReachSlot, feedersOf, feedsInto, leafRange,
  parseSlot, r1SlotIndexFor, regionOf, seedBracket, slotId,
} from '../bracket.js';
import { SLOTS_PER_ROUND, TOTAL_SLOTS, type Round } from '../types.js';
import { makeField, teamId } from './fixtures.js';

describe('slot ids', () => {
  it('covers exactly 63 slots', () => {
    expect(allSlots()).toHaveLength(TOTAL_SLOTS);
  });

  it('has the right number of slots per round', () => {
    const counts = allSlots().reduce((acc, s) => {
      const round = parseSlot(s).round;
      acc[round] = (acc[round] ?? 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    expect(counts).toEqual({ 1: 32, 2: 16, 3: 8, 4: 4, 5: 2, 6: 1 });
  });

  it('round-trips through parse', () => {
    for (const slot of allSlots()) {
      const { round, k } = parseSlot(slot);
      expect(slotId(round, k)).toBe(slot);
    }
  });

  it('rejects malformed and out-of-range ids', () => {
    expect(() => parseSlot('R7-01')).toThrow();
    expect(() => parseSlot('R1-33')).toThrow();
    expect(() => parseSlot('R1-1')).toThrow();
    expect(() => parseSlot('nonsense')).toThrow();
    expect(() => slotId(6 as Round, 2)).toThrow();
  });
});

describe('the feed rule', () => {
  it('pairs adjacent slots into the next round', () => {
    expect(feedsInto('R1-01')).toEqual({ slot: 'R2-01', position: 'A' });
    expect(feedsInto('R1-02')).toEqual({ slot: 'R2-01', position: 'B' });
    expect(feedsInto('R1-07')).toEqual({ slot: 'R2-04', position: 'A' });
    expect(feedsInto('R1-08')).toEqual({ slot: 'R2-04', position: 'B' });
  });

  it('crosses region boundaries into the Final Four', () => {
    expect(feedsInto('R4-01')).toEqual({ slot: 'R5-01', position: 'A' });
    expect(feedsInto('R4-02')).toEqual({ slot: 'R5-01', position: 'B' });
    expect(feedsInto('R4-03')).toEqual({ slot: 'R5-02', position: 'A' });
    expect(feedsInto('R4-04')).toEqual({ slot: 'R5-02', position: 'B' });
    expect(feedsInto('R5-01')).toEqual({ slot: 'R6-01', position: 'A' });
    expect(feedsInto('R5-02')).toEqual({ slot: 'R6-01', position: 'B' });
  });

  it('terminates at the championship', () => {
    expect(feedsInto('R6-01')).toBeNull();
  });

  it('feedersOf is the exact inverse of feedsInto, for every slot', () => {
    for (const slot of allSlots()) {
      const dest = feedsInto(slot);
      if (!dest) continue;
      const feeders = feedersOf(dest.slot)!;
      expect(feeders[dest.position === 'A' ? 0 : 1]).toBe(slot);
    }
  });

  it('gives every slot above round 1 exactly two feeders', () => {
    const destinations = new Map<string, string[]>();
    for (const slot of allSlots()) {
      const dest = feedsInto(slot);
      if (!dest) continue;
      destinations.set(dest.slot, [...(destinations.get(dest.slot) ?? []), slot]);
    }
    expect(destinations.size).toBe(TOTAL_SLOTS - SLOTS_PER_ROUND[1]);
    for (const feeders of destinations.values()) expect(feeders).toHaveLength(2);
  });
});

describe('regions', () => {
  it('splits rounds 1-4 into four regions', () => {
    expect(regionOf('R1-01')).toBe(1);
    expect(regionOf('R1-08')).toBe(1);
    expect(regionOf('R1-09')).toBe(2);
    expect(regionOf('R1-32')).toBe(4);
    expect(regionOf('R2-04')).toBe(1);
    expect(regionOf('R2-05')).toBe(2);
    expect(regionOf('R3-02')).toBe(1);
    expect(regionOf('R3-03')).toBe(2);
    expect(regionOf('R4-01')).toBe(1);
    expect(regionOf('R4-04')).toBe(4);
  });

  it('has no region for the Final Four or Championship', () => {
    expect(regionOf('R5-01')).toBeNull();
    expect(regionOf('R6-01')).toBeNull();
  });

  it('gives each region exactly 8 round-1 slots', () => {
    const counts = [1, 2, 3, 4].map(
      (r) => allSlots().filter((s) => parseSlot(s).round === 1 && regionOf(s) === r).length,
    );
    expect(counts).toEqual([8, 8, 8, 8]);
  });
});

describe('leaf ranges', () => {
  it('widen by a factor of two each round', () => {
    expect(leafRange('R1-05')).toEqual([5, 5]);
    expect(leafRange('R2-01')).toEqual([1, 2]);
    expect(leafRange('R2-04')).toEqual([7, 8]);
    expect(leafRange('R3-01')).toEqual([1, 4]);
    expect(leafRange('R4-01')).toEqual([1, 8]);
    expect(leafRange('R5-01')).toEqual([1, 16]);
    expect(leafRange('R6-01')).toEqual([1, 32]);
  });
});

describe('seed lines', () => {
  it('places seed pairs in NCAA bracket order', () => {
    expect(r1SlotIndexFor(1, 1)).toBe(1);
    expect(r1SlotIndexFor(1, 16)).toBe(1);
    expect(r1SlotIndexFor(1, 8)).toBe(2);
    expect(r1SlotIndexFor(1, 9)).toBe(2);
    expect(r1SlotIndexFor(1, 5)).toBe(3);
    expect(r1SlotIndexFor(1, 2)).toBe(8);
    expect(r1SlotIndexFor(1, 15)).toBe(8);
  });

  it('offsets each region by eight slots', () => {
    expect(r1SlotIndexFor(2, 1)).toBe(9);
    expect(r1SlotIndexFor(3, 1)).toBe(17);
    expect(r1SlotIndexFor(4, 15)).toBe(32);
  });

  it('puts the 1 and 2 seeds on opposite sides of their region', () => {
    expect(canReachSlot(1, 1, 'R3-01')).toBe(true);
    expect(canReachSlot(1, 2, 'R3-01')).toBe(false);
    expect(canReachSlot(1, 2, 'R3-02')).toBe(true);
    expect(canReachSlot(1, 1, 'R4-01')).toBe(true);
    expect(canReachSlot(1, 2, 'R4-01')).toBe(true);
  });

  it('keeps regions apart until the Final Four', () => {
    expect(canReachSlot(2, 1, 'R4-01')).toBe(false);
    expect(canReachSlot(2, 1, 'R4-02')).toBe(true);
    expect(canReachSlot(2, 1, 'R5-01')).toBe(true);
    expect(canReachSlot(3, 1, 'R5-01')).toBe(false);
    expect(canReachSlot(3, 1, 'R5-02')).toBe(true);
  });

  it('lets every team reach the championship', () => {
    for (let region = 1; region <= 4; region++) {
      for (let seed = 1; seed <= 16; seed++) {
        expect(canReachSlot(region as 1 | 2 | 3 | 4, seed, 'R6-01')).toBe(true);
      }
    }
  });
});

describe('seeding the field', () => {
  it('places all 64 teams with the better seed in teamA', () => {
    const games = seedBracket(buildEmptyBracket(), makeField());
    const r1 = games.filter((g) => g.round === 1);
    expect(r1).toHaveLength(32);
    expect(r1.every((g) => g.teamA !== null && g.teamB !== null)).toBe(true);

    expect(games.find((g) => g.slot === 'R1-01')).toMatchObject({
      teamA: teamId(1, 1), teamB: teamId(1, 16),
    });
    expect(games.find((g) => g.slot === 'R1-02')).toMatchObject({
      teamA: teamId(1, 8), teamB: teamId(1, 9),
    });
    expect(games.find((g) => g.slot === 'R1-09')).toMatchObject({
      teamA: teamId(2, 1), teamB: teamId(2, 16),
    });
  });

  it('leaves rounds 2-6 empty', () => {
    const games = seedBracket(buildEmptyBracket(), makeField());
    const later = games.filter((g) => g.round > 1);
    expect(later.every((g) => g.teamA === null && g.teamB === null)).toBe(true);
  });

  it('refuses a field that is not exactly 64 teams', () => {
    expect(() => seedBracket(buildEmptyBracket(), makeField().slice(0, 63)))
      .toThrow(/64-team field/);
    expect(() => seedBracket(buildEmptyBracket(), [...makeField(), makeField()[0]!]))
      .toThrow(/64-team field/);
  });

  it('refuses two teams on the same seed line', () => {
    const field = makeField();
    field[1] = { ...field[1]!, id: 'imposter', seed: field[0]!.seed, region: field[0]!.region };
    expect(() => seedBracket(buildEmptyBracket(), field)).toThrow(/same seed line/);
  });
});
