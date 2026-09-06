/**
 * Placing ESPN games into bracket slots.
 *
 * Matching is by the pair of teams standing in a slot, never by ESPN's own
 * round or region labels. That was validated against the real 2026 tournament:
 * all 63 slots matched, so the sync job never has to infer a slot number from
 * a headline that could change wording between seasons.
 *
 * Pure, so the whole matcher is testable without a network or a database.
 */

import { isDecided } from '../engine/results.js';
import type { Game, SlotId, Team, TeamId } from '../engine/types.js';
import type { EspnGame } from './espn.js';
import { finals, inProgress } from './espn.js';

export interface SlotResult {
  slot: SlotId;
  winner: TeamId;
  /** Oriented to the slot's teamA/teamB, not to ESPN's home/away. */
  scoreA: number | null;
  scoreB: number | null;
  espnEventId: string;
}

export interface LiveScore {
  slot: SlotId;
  scoreA: number | null;
  scoreB: number | null;
  espnEventId: string;
}

export interface MatchReport {
  results: SlotResult[];
  /** Final games that could not be placed, with why. Surfaced, never swallowed. */
  unplaced: { eventId: string; teams: string[]; reason: string }[];
  /** Slots left alone because an admin had already set them. */
  skippedOverridden: SlotId[];
}

function espnIdIndex(teams: readonly Team[]): Map<string, TeamId> {
  const out = new Map<string, TeamId>();
  for (const team of teams) {
    if (team.espnId) out.set(team.espnId, team.id);
  }
  return out;
}

function findSlot(games: readonly Game[], a: TeamId, b: TeamId): Game | undefined {
  return games.find((g) =>
    (g.teamA === a && g.teamB === b) || (g.teamA === b && g.teamB === a));
}

/**
 * Turn finished ESPN games into results for the slots they belong to.
 *
 * Deliberately conservative: anything ambiguous is reported as unplaced rather
 * than guessed at, because a wrong winner silently rescores the whole pool.
 */
export function matchFinals(
  games: readonly Game[],
  teams: readonly Team[],
  espnGames: readonly EspnGame[],
): MatchReport {
  const byEspnId = espnIdIndex(teams);
  const results: SlotResult[] = [];
  const unplaced: MatchReport['unplaced'] = [];
  const skippedOverridden: SlotId[] = [];
  const claimed = new Set<SlotId>();

  for (const event of finals(espnGames)) {
    const [first, second] = event.competitors as [EspnGame['competitors'][0], EspnGame['competitors'][1]];
    const names = [first.name, second.name];

    const teamA = byEspnId.get(first.espnId);
    const teamB = byEspnId.get(second.espnId);
    if (!teamA || !teamB) {
      unplaced.push({
        eventId: event.eventId, teams: names,
        reason: `no team mapped to ESPN id ${!teamA ? first.espnId : second.espnId}`,
      });
      continue;
    }

    const slot = findSlot(games, teamA, teamB);
    if (!slot) {
      unplaced.push({
        eventId: event.eventId, teams: names,
        reason: 'no slot currently holds this pair -- an upstream result is probably missing',
      });
      continue;
    }

    if (slot.overriddenBy) {
      skippedOverridden.push(slot.slot);
      continue;
    }
    if (isDecided(slot)) continue;
    if (claimed.has(slot.slot)) {
      unplaced.push({
        eventId: event.eventId, teams: names,
        reason: `${slot.slot} was already matched by another event`,
      });
      continue;
    }

    const winnerEspn = first.winner ? first : second;
    const winner = byEspnId.get(winnerEspn.espnId);
    if (!winner) {
      unplaced.push({ eventId: event.eventId, teams: names, reason: 'winner not mapped' });
      continue;
    }

    const flipped = slot.teamA !== teamA;
    results.push({
      slot: slot.slot,
      winner,
      scoreA: flipped ? second.score : first.score,
      scoreB: flipped ? first.score : second.score,
      espnEventId: event.eventId,
    });
    claimed.add(slot.slot);
  }

  return { results, unplaced, skippedOverridden };
}

/**
 * Scores for games currently being played, for the client to show between
 * sync runs. Never written to Firestore -- the browser is not a trusted writer.
 */
export function matchLiveScores(
  games: readonly Game[],
  teams: readonly Team[],
  espnGames: readonly EspnGame[],
): LiveScore[] {
  const byEspnId = espnIdIndex(teams);
  const out: LiveScore[] = [];

  for (const event of inProgress(espnGames)) {
    const [first, second] = event.competitors as [EspnGame['competitors'][0], EspnGame['competitors'][1]];
    const teamA = byEspnId.get(first.espnId);
    const teamB = byEspnId.get(second.espnId);
    if (!teamA || !teamB) continue;

    const slot = findSlot(games, teamA, teamB);
    if (!slot || isDecided(slot)) continue;

    const flipped = slot.teamA !== teamA;
    out.push({
      slot: slot.slot,
      scoreA: flipped ? second.score : first.score,
      scoreB: flipped ? first.score : second.score,
      espnEventId: event.eventId,
    });
  }
  return out;
}
