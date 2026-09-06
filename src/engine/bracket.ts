/**
 * Slot arithmetic. The whole tournament tree is derived from one rule:
 *
 *     R{n}-{k}  feeds into  R{n+1}-{ceil(k/2)}
 *
 * Odd k lands in the destination's teamA, even k in teamB. That holds across
 * region boundaries and all the way to the title game, so there is no
 * adjacency table anywhere in this codebase.
 */

import {
  ROUNDS, SLOTS_PER_ROUND, SEED_PAIRS, TOTAL_SLOTS,
  type Game, type Round, type RegionIndex, type SlotId, type Team, type TeamId,
} from './types.js';

const SLOT_RE = /^R([1-6])-(\d{2})$/;

export function slotId(round: Round, k: number): SlotId {
  if (k < 1 || k > SLOTS_PER_ROUND[round]) {
    throw new RangeError(`Round ${round} has no slot ${k}`);
  }
  return `R${round}-${String(k).padStart(2, '0')}`;
}

export function parseSlot(slot: SlotId): { round: Round; k: number } {
  const m = SLOT_RE.exec(slot);
  if (!m) throw new Error(`Malformed slot id: ${slot}`);
  const round = Number(m[1]) as Round;
  const k = Number(m[2]);
  if (k < 1 || k > SLOTS_PER_ROUND[round]) {
    throw new RangeError(`Round ${round} has no slot ${k}`);
  }
  return { round, k };
}

/** All 63 slots, round 1 first, ascending within each round. */
export function allSlots(): SlotId[] {
  const out: SlotId[] = [];
  for (const round of ROUNDS) {
    for (let k = 1; k <= SLOTS_PER_ROUND[round]; k++) out.push(slotId(round, k));
  }
  return out;
}

/** Where this game's winner goes next, or null for the championship. */
export function feedsInto(slot: SlotId): { slot: SlotId; position: 'A' | 'B' } | null {
  const { round, k } = parseSlot(slot);
  if (round === 6) return null;
  return {
    slot: slotId((round + 1) as Round, Math.ceil(k / 2)),
    position: k % 2 === 1 ? 'A' : 'B',
  };
}

/** The two games whose winners meet in this slot, or null for round 1. */
export function feedersOf(slot: SlotId): [SlotId, SlotId] | null {
  const { round, k } = parseSlot(slot);
  if (round === 1) return null;
  const prev = (round - 1) as Round;
  return [slotId(prev, 2 * k - 1), slotId(prev, 2 * k)];
}

/** Region 1-4 for rounds 1-4; null for the Final Four and Championship. */
export function regionOf(slot: SlotId): RegionIndex | null {
  const { round, k } = parseSlot(slot);
  if (round >= 5) return null;
  return Math.ceil(k / 2 ** (4 - round)) as RegionIndex;
}

/**
 * The inclusive range of round-1 slot numbers sitting beneath this slot.
 * Used to answer "can this team still reach this game?" arithmetically.
 */
export function leafRange(slot: SlotId): [number, number] {
  const { round, k } = parseSlot(slot);
  const width = 2 ** (round - 1);
  return [(k - 1) * width + 1, k * width];
}

/** Seed -> position within a region, from the fixed NCAA pairing order. */
const SEED_OFFSET: ReadonlyMap<number, number> = (() => {
  const m = new Map<number, number>();
  SEED_PAIRS.forEach(([hi, lo], i) => { m.set(hi, i + 1); m.set(lo, i + 1); });
  return m;
})();

/** The round-1 slot number (1-32) a given region+seed line always occupies. */
export function r1SlotIndexFor(region: RegionIndex, seed: number): number {
  const offset = SEED_OFFSET.get(seed);
  if (offset === undefined) throw new RangeError(`No such seed: ${seed}`);
  return (region - 1) * 8 + offset;
}

export function r1SlotFor(region: RegionIndex, seed: number): SlotId {
  return slotId(1, r1SlotIndexFor(region, seed));
}

/** True if a team seeded here could still, in principle, play in this slot. */
export function canReachSlot(region: RegionIndex, seed: number, slot: SlotId): boolean {
  const leaf = r1SlotIndexFor(region, seed);
  const [lo, hi] = leafRange(slot);
  return leaf >= lo && leaf <= hi;
}

/** An empty 63-game tournament with no teams placed. */
export function buildEmptyBracket(): Game[] {
  return allSlots().map((slot) => {
    const { round } = parseSlot(slot);
    return {
      slot,
      round,
      region: regionOf(slot),
      teamA: null,
      teamB: null,
      winner: null,
      scoreA: null,
      scoreB: null,
      status: 'scheduled' as const,
      tipoff: null,
      espnEventId: null,
      overriddenBy: null,
    };
  });
}

/**
 * Place a 64-team field into round 1. Better seed takes teamA.
 * Throws on a malformed field rather than silently producing a broken bracket
 * -- this runs once on Selection Sunday and a bad field must not go live.
 */
export function seedBracket(games: Game[], teams: readonly Team[]): Game[] {
  if (teams.length !== 64) {
    throw new Error(`Expected a 64-team field, got ${teams.length}. ` +
      `Resolve the First Four before seeding.`);
  }
  const bySlot = new Map(games.map((g) => [g.slot, { ...g }]));
  const seen = new Set<string>();

  for (const team of teams) {
    const key = `${team.region}-${team.seed}`;
    if (seen.has(key)) {
      throw new Error(`Two teams on the same seed line: region ${team.region} seed ${team.seed}`);
    }
    seen.add(key);

    const target = bySlot.get(r1SlotFor(team.region, team.seed));
    if (!target) throw new Error(`No round-1 slot for ${team.name}`);

    const pair = SEED_PAIRS.find((p) => p.includes(team.seed));
    if (!pair) throw new RangeError(`No such seed: ${team.seed}`);
    if (team.seed === Math.min(pair[0], pair[1])) target.teamA = team.id;
    else target.teamB = team.id;
  }

  if (seen.size !== 64) throw new Error(`Field covers ${seen.size} seed lines, expected 64`);
  return [...bySlot.values()];
}

/** Index a field by team id, for the lookups scoring needs. */
export function indexTeams(teams: readonly Team[]): Map<TeamId, Team> {
  return new Map(teams.map((t) => [t.id, t]));
}

export { TOTAL_SLOTS };
