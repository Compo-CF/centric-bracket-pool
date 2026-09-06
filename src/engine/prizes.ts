/**
 * Prize money.
 *
 * All arithmetic is in integer cents. Percentages of a pot never divide evenly,
 * and floating-point dollars would leave the payouts a cent short of the money
 * actually collected -- the one bug in a cash pool nobody forgives.
 *
 * Structure: everyone pays the same entry fee. Last place gets their fee back
 * off the top; whatever remains is split between 1st, 2nd and 3rd.
 */

import { DEFAULT_PRIZE_RULES, type PrizeRules, type Standing } from './types.js';

export interface PrizePool {
  paidEntries: number;
  potCents: number;
  refundCents: number;
  payoutPoolCents: number;
}

/**
 * A refund only makes sense once there are more entries than prize positions;
 * with three or fewer, last place is already winning something.
 */
export function prizePool(paidEntries: number, rules: PrizeRules): PrizePool {
  const entries = Math.max(0, paidEntries);
  const potCents = entries * rules.entryFeeCents;
  const refundCents = rules.refundLastPlace && entries > 3 ? rules.entryFeeCents : 0;
  return { paidEntries: entries, potCents, refundCents, payoutPoolCents: potCents - refundCents };
}

/**
 * Largest-remainder apportionment, so the parts always sum to exactly the
 * whole. Leftover cents go to the largest fractional shares, ties broken
 * toward the higher finishing position.
 */
export function apportion(totalCents: number, percentages: readonly number[]): number[] {
  if (percentages.length === 0) return [];
  const exact = percentages.map((p) => (totalCents * p) / 100);
  const out = exact.map((v) => Math.floor(v));
  let left = totalCents - out.reduce((a, b) => a + b, 0);
  const byFraction = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byFraction) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

/** With fewer than three paid entries the missing places' shares redistribute. */
export function effectiveSplit(
  paidEntries: number,
  split: readonly [number, number, number],
): number[] {
  const places = Math.min(3, Math.max(0, paidEntries));
  const kept = split.slice(0, places);
  const total = kept.reduce((a, b) => a + b, 0);
  if (total === 0) return kept.map(() => 0);
  return kept.map((p) => (p / total) * 100);
}

export interface PrizeAward {
  /** 1, 2, 3, or 'last' for the consolation refund. */
  position: 1 | 2 | 3 | 'last';
  label: string;
  /** More than one entry when they finish level on points. */
  entryIds: string[];
  entryNames: string[];
  /** Per entry, in the same order as entryIds. Ties can differ by a cent. */
  amountEachCents: number[];
  totalCents: number;
}

export const PLACE_LABELS = ['1st', '2nd', '3rd'] as const;

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Who gets paid what.
 *
 * Only paid entries are eligible -- an unsubmitted cheque should not win the
 * pool -- so positions are derived from the paid subset rather than reusing
 * the leaderboard's own ranks, which are computed over everyone.
 *
 * Entries level on points pool the places they occupy and split them evenly:
 * two tied for the lead share 1st and 2nd money, and 3rd is still 3rd.
 *
 * Last place is the final row of the standings, which means the same
 * tiebreaker that decides the top of the board also decides the bottom.
 */
export function allocatePrizes(
  standings: readonly Standing[],
  paidEntryIds: ReadonlySet<string>,
  rules: PrizeRules = DEFAULT_PRIZE_RULES,
): PrizeAward[] {
  const eligible = standings.filter((s) => paidEntryIds.has(s.entryId));
  if (eligible.length === 0) return [];

  const pool = prizePool(eligible.length, rules);
  const placeCents = apportion(
    pool.payoutPoolCents,
    effectiveSplit(eligible.length, rules.split),
  );

  const awards: PrizeAward[] = [];
  let position = 1;
  let index = 0;

  while (index < eligible.length && position <= placeCents.length) {
    const points = eligible[index]!.points;
    const group: Standing[] = [];
    while (index < eligible.length && eligible[index]!.points === points) {
      group.push(eligible[index]!);
      index += 1;
    }

    const occupied: number[] = [];
    for (let p = position; p < position + group.length; p++) {
      if (p <= placeCents.length) occupied.push(p);
    }

    if (occupied.length > 0) {
      const totalCents = occupied.reduce((sum, p) => sum + (placeCents[p - 1] ?? 0), 0);
      const each = apportion(totalCents, group.map(() => 100 / group.length));
      awards.push({
        position: occupied[0] as 1 | 2 | 3,
        label: occupied.length === 1
          ? `${PLACE_LABELS[occupied[0]! - 1]}`
          : `${PLACE_LABELS[occupied[0]! - 1]}–${PLACE_LABELS[occupied[occupied.length - 1]! - 1]} (tied)`,
        entryIds: group.map((g) => g.entryId),
        entryNames: group.map((g) => g.entryName),
        amountEachCents: each,
        totalCents,
      });
    }
    position += group.length;
  }

  if (pool.refundCents > 0) {
    const last = eligible[eligible.length - 1]!;
    const alreadyPaid = awards.some((a) => a.entryIds.includes(last.entryId));
    if (!alreadyPaid) {
      awards.push({
        position: 'last',
        label: 'Last place',
        entryIds: [last.entryId],
        entryNames: [last.entryName],
        amountEachCents: [pool.refundCents],
        totalCents: pool.refundCents,
      });
    }
  }

  return awards;
}

/** Every cent collected is accounted for. Used as a self-check in the UI. */
export function totalAwarded(awards: readonly PrizeAward[]): number {
  return awards.reduce((sum, a) => sum + a.totalCents, 0);
}
