/**
 * Parsing ESPN's public college-basketball scoreboard.
 *
 * The endpoint is undocumented and unofficial. Every field is therefore read
 * defensively: a shape change should make games go missing, which the sync job
 * reports and an admin can override, rather than throw and take the whole
 * pool's scoring offline mid-weekend.
 *
 * Pure. The browser uses it to show live scores, and the sync job uses it to
 * settle finals; neither path fetches from here.
 */

import type { Round } from '../engine/types.js';

export const SCOREBOARD_BASE =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';

export type EspnStatus = 'scheduled' | 'in_progress' | 'final';

export interface EspnCompetitor {
  espnId: string;
  name: string;
  seed: number | null;
  score: number | null;
  winner: boolean;
}

export interface EspnGame {
  eventId: string;
  /** Null when the headline is not a round this pool scores. */
  round: Round | null;
  regionName: string | null;
  isFirstFour: boolean;
  status: EspnStatus;
  tipoff: string | null;
  competitors: EspnCompetitor[];
}

/** Dates are YYYYMMDD. Pass one for a single day, two for an inclusive range. */
export function scoreboardUrl(from: string, to?: string): string {
  const dates = to ? `${from}-${to}` : from;
  return `${SCOREBOARD_BASE}?dates=${dates}&groups=100&limit=300`;
}

const ROUND_LABELS: Record<string, Round> = {
  '1st round': 1,
  '2nd round': 2,
  'sweet 16': 3,
  'elite 8': 4,
  'regional final': 4,
  'final four': 5,
  'national semifinal': 5,
  'national championship': 6,
};

/**
 * Headlines look like
 *   "NCAA Men's Basketball Championship - East Region - 1st Round"
 *   "NCAA Men's Basketball Championship - National Championship"
 */
export function parseHeadline(headline: string): {
  round: Round | null; regionName: string | null; isFirstFour: boolean;
} {
  const parts = headline.split(' - ').map((p) => p.trim());
  const label = (parts.at(-1) ?? '').toLowerCase();
  const regionPart = parts.find((p) => /\bRegion$/i.test(p));
  return {
    round: ROUND_LABELS[label] ?? null,
    regionName: regionPart ? regionPart.replace(/\s*Region$/i, '') : null,
    isFirstFour: label === 'first four',
  };
}

function statusOf(name: string | undefined): EspnStatus {
  switch (name) {
    case 'STATUS_FINAL':
      return 'final';
    case 'STATUS_IN_PROGRESS':
    case 'STATUS_HALFTIME':
    case 'STATUS_END_PERIOD':
      return 'in_progress';
    default:
      return 'scheduled';
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

type Bag = Record<string, unknown>;
const asBag = (v: unknown): Bag => (v && typeof v === 'object' ? v as Bag : {});
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function parseScoreboard(payload: unknown): EspnGame[] {
  return asArray(asBag(payload)['events']).flatMap((raw): EspnGame[] => {
    const event = asBag(raw);
    const comp = asBag(asArray(event['competitions'])[0]);
    const headline = String(asBag(asArray(comp['notes'])[0])['headline'] ?? '');
    const { round, regionName, isFirstFour } = parseHeadline(headline);

    const competitors = asArray(comp['competitors']).map((c): EspnCompetitor => {
      const entry = asBag(c);
      const team = asBag(entry['team']);
      return {
        espnId: String(team['id'] ?? entry['id'] ?? ''),
        name: String(team['shortDisplayName'] ?? team['displayName'] ?? team['abbreviation'] ?? ''),
        seed: toNumber(asBag(entry['curatedRank'])['current']),
        score: toNumber(entry['score']),
        winner: entry['winner'] === true,
      };
    });

    // Two competitors or it is not a game we can place in a bracket slot.
    if (competitors.length !== 2) return [];

    return [{
      eventId: String(event['id'] ?? comp['id'] ?? ''),
      round,
      regionName,
      isFirstFour,
      status: statusOf(String(asBag(asBag(event['status'])['type'])['name'] ?? '')),
      tipoff: typeof event['date'] === 'string' ? event['date'] : null,
      competitors,
    }];
  });
}

/** Games this pool scores: a recognised round, and not a play-in. */
export function tournamentGames(games: readonly EspnGame[]): EspnGame[] {
  return games.filter((g) => g.round !== null && !g.isFirstFour);
}

export function finals(games: readonly EspnGame[]): EspnGame[] {
  return tournamentGames(games).filter((g) =>
    g.status === 'final' && g.competitors.some((c) => c.winner));
}

export function inProgress(games: readonly EspnGame[]): EspnGame[] {
  return tournamentGames(games).filter((g) => g.status === 'in_progress');
}
