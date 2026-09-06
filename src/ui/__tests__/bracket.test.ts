import { describe, expect, it } from 'vitest';
import {
  buildEmptyBracket, recordResult, seedBracket, type Game, type SlotId, type TeamId,
} from '../../engine/index.js';
import { field2026 } from '../../engine/__tests__/replay2026.js';
import { renderDesktop, renderMobile, type BracketView } from '../bracket.js';

const teams = field2026();
const teamIndex = new Map(teams.map((t) => [t.id, t]));
const initial = seedBracket(buildEmptyBracket(), teams);

/** The shape the admin results panel builds: winners drive the highlight. */
function adminView(games: Game[], overridden: SlotId[] = []): BracketView {
  const picks: Record<SlotId, TeamId> = {};
  for (const game of games) if (game.winner) picks[game.slot] = game.winner;
  return {
    games,
    teams: teamIndex,
    picks,
    editable: true,
    overridden: new Set(overridden),
  };
}

const R1_ARIZONA = 'R1-01';

describe('the admin results bracket', () => {
  it('makes every round-one team clickable', () => {
    const html = renderDesktop(adminView(initial));
    expect(html).toContain(`data-slot="${R1_ARIZONA}"`);
    expect(html).toContain('data-team="12"');
    expect((html.match(/data-team=/g) ?? []).length).toBe(64);
  });

  it('renders later rounds as TBD, not as clickable teams', () => {
    const html = renderDesktop(adminView(initial));
    expect(html).toContain('TBD');
    // 64 round-one competitors are clickable; the other 62 sides are not.
    expect((html.match(/class="team empty"/g) ?? []).length).toBe(62);
  });

  it('highlights the winner once a game is decided', () => {
    const decided = recordResult(initial, R1_ARIZONA, { winner: '12' }, { source: 'sync' });
    const html = renderDesktop(adminView(decided));
    expect(html).toMatch(/class="team picked"[^>]*data-slot="R1-01"[^>]*data-team="12"/);
    expect(html).toContain('aria-pressed="true"');
  });

  it('carries the winner into the next round as a clickable team', () => {
    let games = recordResult(initial, 'R1-01', { winner: '12' }, { source: 'sync' });
    games = recordResult(games, 'R1-02', { winner: '222' }, { source: 'sync' });
    const html = renderDesktop(adminView(games));
    // R2-01 now has a real matchup, so both sides became buttons.
    expect((html.match(/class="team empty"/g) ?? []).length).toBe(60);
  });

  it('flags a game an admin decided by hand', () => {
    const decided = recordResult(
      initial, R1_ARIZONA, { winner: '12', overriddenBy: 'a@b.com' }, { source: 'admin' });
    const html = renderDesktop(adminView(decided, [R1_ARIZONA]));
    expect(html).toContain('class="match done manual"');
  });

  it('leaves games the sync job decided unflagged', () => {
    const decided = recordResult(initial, R1_ARIZONA, { winner: '12' }, { source: 'sync' });
    const html = renderDesktop(adminView(decided));
    expect(html).not.toContain('manual');
  });

  it('escapes team names rather than injecting them raw', () => {
    const nasty = teams.map((t) => (t.id === '12' ? { ...t, name: '<img src=x>' } : t));
    const html = renderDesktop({ ...adminView(initial), teams: new Map(nasty.map((t) => [t.id, t])) });
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
  });
});

describe('the mobile results bracket', () => {
  it('shows one region at a time with a Final Four tab', () => {
    const html = renderMobile(adminView(initial), 1);
    expect(html).toContain('data-panel="1"');
    expect(html).toContain('data-panel="finals"');
    expect((html.match(/data-team=/g) ?? []).length).toBe(16);
  });

  it('switches to another region', () => {
    const html = renderMobile(adminView(initial), 3);
    expect(html).toContain('class="tab active" data-panel="3"');
  });

  it('shows the Final Four panel with no teams yet', () => {
    const html = renderMobile(adminView(initial), 'finals');
    expect(html).toContain('Final Four');
    expect(html).toContain('Championship');
    expect((html.match(/data-team=/g) ?? []).length).toBe(0);
  });
});
