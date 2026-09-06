/**
 * The results sync: ESPN -> bracket -> standings, in one pass.
 *
 * Shared between the CLI and the scheduled Actions job so there is one code
 * path, and so anything that goes wrong in CI can be reproduced by hand with
 * the same arguments.
 */

import type { Firestore } from '@google-cloud/firestore';

import { applyEliminations, recordResult } from '../../src/engine/results.js';
import type { Game, Team } from '../../src/engine/types.js';
import { parseScoreboard, scoreboardUrl } from '../../src/sync/espn.js';
import { matchFinals, type MatchReport } from '../../src/sync/match.js';
import type { BracketDoc } from '../../src/lib/documents.js';
import { writeStandings } from './standings.js';

export interface SyncOptions {
  from: string;
  to?: string;
  dryRun?: boolean;
}

export interface SyncOutcome {
  url: string;
  eventsSeen: number;
  recorded: { slot: string; winner: string; name: string }[];
  report: MatchReport;
  gamesDecided: number;
  dryRun: boolean;
}

export async function fetchScoreboard(from: string, to?: string): Promise<unknown> {
  const url = scoreboardUrl(from, to);
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`ESPN returned ${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

export async function runSync(db: Firestore, options: SyncOptions): Promise<SyncOutcome> {
  const bracketRef = db.doc('tournament/bracket');
  const snapshot = await bracketRef.get();
  if (!snapshot.exists) {
    throw new Error('tournament/bracket is missing. Run npm run pool:seed-bracket.');
  }

  const bracket = snapshot.data() as BracketDoc;
  const teams: Team[] = bracket.teams;
  let games: Game[] = bracket.games;

  const url = scoreboardUrl(options.from, options.to);
  const espnGames = parseScoreboard(await fetchScoreboard(options.from, options.to));
  const report = matchFinals(games, teams, espnGames);

  const named = new Map(teams.map((t) => [t.id, t.name]));
  const recorded: SyncOutcome['recorded'] = [];

  for (const result of report.results) {
    games = recordResult(games, result.slot, {
      winner: result.winner,
      scoreA: result.scoreA,
      scoreB: result.scoreB,
      status: 'final',
      espnEventId: result.espnEventId,
    }, { source: 'sync' });
    recorded.push({
      slot: result.slot,
      winner: result.winner,
      name: named.get(result.winner) ?? result.winner,
    });
  }

  if (!options.dryRun && recorded.length > 0) {
    await bracketRef.set({
      ...bracket,
      updatedAt: new Date().toISOString(),
      teams: applyEliminations(teams, games),
      games,
    });
    // Standings are recomputed in the same pass, so the leaderboard can never
    // sit stale behind a recorded result.
    await writeStandings(db);
  }

  return {
    url,
    eventsSeen: espnGames.length,
    recorded,
    report,
    gamesDecided: games.filter((g) => g.winner !== null).length,
    dryRun: options.dryRun === true,
  };
}

/** YYYYMMDD for a date offset from today, in UTC. */
export function dateStamp(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
