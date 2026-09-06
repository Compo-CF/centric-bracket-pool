import { describe, expect, it } from 'vitest';
import {
  allocatePrizes, apportion, effectiveSplit, formatMoney, prizePool, totalAwarded,
} from '../prizes.js';
import {
  DEFAULT_PRIZE_RULES, type PrizeRules, type Round, type Standing,
} from '../types.js';

const RULES = DEFAULT_PRIZE_RULES;

function standing(id: string, points: number, rank: number): Standing {
  const byRound = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } as Record<Round, number>;
  return {
    entryId: id, entryName: `Entry ${id}`, ownerName: `Owner ${id}`,
    rank, points, maxPossible: points, correct: 0, byRound,
    champion: null, championAlive: false, tiebreaker: 140,
  };
}

/** Descending points, ranks sharing on ties, as buildStandings produces. */
function board(...points: number[]): Standing[] {
  let rank = 0;
  let last: number | null = null;
  return points.map((p, i) => {
    if (p !== last) { rank = i + 1; last = p; }
    return standing(`e${i + 1}`, p, rank);
  });
}

const allPaid = (rows: Standing[]) => new Set(rows.map((r) => r.entryId));

describe('the pot', () => {
  it('is the entry fee times the paid entries', () => {
    expect(prizePool(30, RULES)).toEqual({
      paidEntries: 30, potCents: 30_000, refundCents: 1_000, payoutPoolCents: 29_000,
    });
  });

  it('takes the last-place refund off the top', () => {
    const pool = prizePool(12, RULES);
    expect(pool.potCents).toBe(12_000);
    expect(pool.refundCents).toBe(1_000);
    expect(pool.payoutPoolCents).toBe(11_000);
  });

  it('pays no refund when there are not more entries than prizes', () => {
    expect(prizePool(3, RULES).refundCents).toBe(0);
    expect(prizePool(4, RULES).refundCents).toBe(1_000);
  });

  it('is empty with nobody paid', () => {
    expect(prizePool(0, RULES)).toMatchObject({ potCents: 0, payoutPoolCents: 0 });
  });
});

describe('apportionment', () => {
  it('splits evenly when it divides cleanly', () => {
    expect(apportion(29_000, [50, 30, 20])).toEqual([14_500, 8_700, 5_800]);
  });

  it('always sums to exactly the total, however awkward the numbers', () => {
    for (let entries = 1; entries <= 200; entries++) {
      const pool = prizePool(entries, RULES);
      const parts = apportion(pool.payoutPoolCents, effectiveSplit(entries, RULES.split));
      expect(parts.reduce((a, b) => a + b, 0)).toBe(pool.payoutPoolCents);
      expect(parts.every((p) => Number.isInteger(p))).toBe(true);
    }
  });

  it('gives leftover cents to the largest fractional share', () => {
    // $100.01 split three ways: 33.34 / 33.34 / 33.33 -- never 33.33 x 3.
    const parts = apportion(10_001, [100 / 3, 100 / 3, 100 / 3]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10_001);
  });

  it('handles a thirds split without losing a cent', () => {
    const parts = apportion(1_000, [50, 30, 20]);
    expect(parts).toEqual([500, 300, 200]);
  });
});

describe('small pools', () => {
  it('redistributes missing places when fewer than three entries paid', () => {
    expect(effectiveSplit(1, RULES.split)).toEqual([100]);
    expect(effectiveSplit(2, RULES.split)).toEqual([62.5, 37.5]);
    expect(effectiveSplit(5, RULES.split)).toEqual([50, 30, 20]);
  });

  it('gives a single paid entry the whole pot', () => {
    const rows = board(100);
    const awards = allocatePrizes(rows, allPaid(rows), RULES);
    expect(awards).toHaveLength(1);
    expect(awards[0]!.totalCents).toBe(1_000);
  });
});

describe('awards', () => {
  it('pays the top three and refunds last place', () => {
    const rows = board(150, 140, 130, 120, 60);
    const awards = allocatePrizes(rows, allPaid(rows), RULES);

    // $50 pot, $10 refund, $40 split 50/30/20.
    expect(awards.map((a) => [a.label, a.totalCents])).toEqual([
      ['1st', 2_000], ['2nd', 1_200], ['3rd', 800], ['Last place', 1_000],
    ]);
    expect(awards[0]!.entryIds).toEqual(['e1']);
    expect(awards[3]!.entryIds).toEqual(['e5']);
  });

  it('accounts for every cent collected', () => {
    for (let entries = 4; entries <= 120; entries++) {
      const rows = board(...Array.from({ length: entries }, (_, i) => 200 - i));
      const awards = allocatePrizes(rows, allPaid(rows), RULES);
      expect(totalAwarded(awards)).toBe(prizePool(entries, RULES).potCents);
    }
  });

  it('pools and splits the places a tie occupies', () => {
    // Two tied for the lead take 1st + 2nd money and halve it; 3rd is unmoved.
    const rows = board(150, 150, 130, 120, 60);
    const awards = allocatePrizes(rows, allPaid(rows), RULES);

    expect(awards[0]!.label).toBe('1st–2nd (tied)');
    expect(awards[0]!.entryIds).toEqual(['e1', 'e2']);
    expect(awards[0]!.totalCents).toBe(3_200);
    expect(awards[0]!.amountEachCents).toEqual([1_600, 1_600]);
    expect(awards[1]!.label).toBe('3rd');
    expect(awards[1]!.entryIds).toEqual(['e3']);
    expect(totalAwarded(awards)).toBe(5_000);
  });

  it('splits an odd tie without losing a cent', () => {
    const rows = board(150, 150, 150, 120, 60, 50, 40);
    const awards = allocatePrizes(rows, allPaid(rows), RULES);
    expect(awards[0]!.entryIds).toHaveLength(3);
    expect(awards[0]!.amountEachCents.reduce((a, b) => a + b, 0))
      .toBe(awards[0]!.totalCents);
    expect(totalAwarded(awards)).toBe(7_000);
  });

  it('lets one person hold more than one paying place', () => {
    // Multiple brackets per person is allowed, so each entry stands alone.
    const rows = board(150, 145, 130, 120, 60);
    const awards = allocatePrizes(rows, allPaid(rows), RULES);
    expect(awards.slice(0, 3).flatMap((a) => a.entryIds)).toEqual(['e1', 'e2', 'e3']);
  });

  it('excludes entries that have not paid', () => {
    const rows = board(150, 140, 130, 120, 60);
    const paid = new Set(['e2', 'e3', 'e4', 'e5']);
    const awards = allocatePrizes(rows, paid, RULES);

    expect(awards.flatMap((a) => a.entryIds)).not.toContain('e1');
    expect(awards[0]!.entryIds).toEqual(['e2']);
    // Four paid entries, so $40 in and $40 out.
    expect(totalAwarded(awards)).toBe(4_000);
  });

  it('never pays the same entry twice in a tiny pool', () => {
    const rows = board(150, 140, 130);
    const awards = allocatePrizes(rows, allPaid(rows), RULES);
    const ids = awards.flatMap((a) => a.entryIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(awards.some((a) => a.position === 'last')).toBe(false);
  });

  it('is empty when nobody has paid', () => {
    const rows = board(150, 140, 130, 120);
    expect(allocatePrizes(rows, new Set(), RULES)).toEqual([]);
  });

  it('honours a different split', () => {
    const rules: PrizeRules = { entryFeeCents: 2_000, split: [60, 25, 15], refundLastPlace: false };
    const rows = board(150, 140, 130, 120, 60);
    const awards = allocatePrizes(rows, allPaid(rows), rules);
    expect(awards.map((a) => a.totalCents)).toEqual([6_000, 2_500, 1_500]);
    expect(totalAwarded(awards)).toBe(10_000);
  });
});

describe('money formatting', () => {
  it('always shows two decimal places', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(1_000)).toBe('$10.00');
    expect(formatMoney(14_500)).toBe('$145.00');
    expect(formatMoney(1_205)).toBe('$12.05');
    expect(formatMoney(7)).toBe('$0.07');
  });
});
