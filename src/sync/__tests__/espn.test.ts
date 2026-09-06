import { describe, expect, it } from 'vitest';
import {
  finals, inProgress, parseHeadline, parseScoreboard, scoreboardUrl, tournamentGames,
} from '../espn.js';
import sample from './fixtures/espn-sample.json' with { type: 'json' };

const games = parseScoreboard(sample);

describe('scoreboard url', () => {
  it('takes a single date or an inclusive range', () => {
    expect(scoreboardUrl('20270318')).toContain('dates=20270318');
    expect(scoreboardUrl('20270318', '20270405')).toContain('dates=20270318-20270405');
    expect(scoreboardUrl('20270318')).toContain('groups=100');
  });
});

describe('headlines', () => {
  it('reads the round and region out of a real headline', () => {
    expect(parseHeadline("NCAA Men's Basketball Championship - East Region - 1st Round"))
      .toEqual({ round: 1, regionName: 'East', isFirstFour: false });
    expect(parseHeadline("NCAA Men's Basketball Championship - West Region - Sweet 16"))
      .toEqual({ round: 3, regionName: 'West', isFirstFour: false });
    expect(parseHeadline("NCAA Men's Basketball Championship - Final Four"))
      .toEqual({ round: 5, regionName: null, isFirstFour: false });
    expect(parseHeadline("NCAA Men's Basketball Championship - National Championship"))
      .toEqual({ round: 6, regionName: null, isFirstFour: false });
  });

  it('flags the First Four, which this pool does not score', () => {
    const parsed = parseHeadline("NCAA Men's Basketball Championship - South Region - First Four");
    expect(parsed.isFirstFour).toBe(true);
    expect(parsed.round).toBeNull();
  });

  it('accepts wording ESPN has used for the same rounds', () => {
    expect(parseHeadline('x - Regional Final').round).toBe(4);
    expect(parseHeadline('x - National Semifinal').round).toBe(5);
  });

  it('returns null rather than guessing at an unknown label', () => {
    expect(parseHeadline('x - Consolation').round).toBeNull();
    expect(parseHeadline('').round).toBeNull();
  });
});

describe('parsing a real response', () => {
  it('reads both events', () => {
    expect(games).toHaveLength(2);
  });

  it('parses the championship game', () => {
    const game = games.find((g) => g.round === 6)!;
    expect(game.eventId).toBe('401856600');
    expect(game.status).toBe('final');
    expect(game.regionName).toBeNull();
    expect(game.competitors.map((c) => c.name)).toEqual(['Michigan', 'UConn']);
    expect(game.competitors.map((c) => c.score)).toEqual([69, 63]);
    expect(game.competitors.map((c) => c.seed)).toEqual([1, 2]);
    expect(game.competitors.find((c) => c.winner)?.espnId).toBe('130');
  });

  it('converts scores from strings to numbers', () => {
    const game = games.find((g) => g.round === 6)!;
    expect(typeof game.competitors[0]!.score).toBe('number');
  });

  it('excludes the First Four from scoreable games', () => {
    expect(games.some((g) => g.isFirstFour)).toBe(true);
    expect(tournamentGames(games)).toHaveLength(1);
    expect(finals(games)).toHaveLength(1);
    expect(finals(games)[0]!.round).toBe(6);
  });

  it('reports nothing in progress when everything is final', () => {
    expect(inProgress(games)).toEqual([]);
  });
});

describe('when the endpoint misbehaves', () => {
  // The endpoint is undocumented. A shape change should make games go missing,
  // which the sync job reports, rather than throw and take scoring offline.
  it('survives anything that is not a scoreboard', () => {
    expect(parseScoreboard(null)).toEqual([]);
    expect(parseScoreboard({})).toEqual([]);
    expect(parseScoreboard({ events: 'nope' })).toEqual([]);
    expect(parseScoreboard('<html>error</html>')).toEqual([]);
  });

  it('drops an event without exactly two competitors', () => {
    expect(parseScoreboard({ events: [{ id: '1', competitions: [{ competitors: [] }] }] }))
      .toEqual([]);
    expect(parseScoreboard({ events: [{ id: '1', competitions: [{ competitors: [{}] }] }] }))
      .toEqual([]);
  });

  it('keeps an event whose fields are missing, with nulls rather than throwing', () => {
    const parsed = parseScoreboard({
      events: [{ id: '9', competitions: [{ competitors: [{}, {}] }] }],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.round).toBeNull();
    expect(parsed[0]!.status).toBe('scheduled');
    expect(parsed[0]!.competitors[0]!.score).toBeNull();
    expect(parsed[0]!.competitors[0]!.seed).toBeNull();
  });

  it('treats an unfinished game as not final', () => {
    const parsed = parseScoreboard({
      events: [{
        id: '9',
        status: { type: { name: 'STATUS_IN_PROGRESS' } },
        competitions: [{
          notes: [{ headline: "x - East Region - 1st Round" }],
          competitors: [{ team: { id: 'a' }, score: '40' }, { team: { id: 'b' }, score: '38' }],
        }],
      }],
    });
    expect(parsed[0]!.status).toBe('in_progress');
    expect(finals(parsed)).toEqual([]);
    expect(inProgress(parsed)).toHaveLength(1);
  });
});
