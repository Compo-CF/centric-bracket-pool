/**
 * Bracket rendering.
 *
 * Desktop gets the classic shape: regions 1 and 2 on the left flowing right,
 * regions 3 and 4 on the right flowing left, Final Four down the middle.
 * Mobile is a different layout rather than a squeezed one -- one region at a
 * time as a vertical stack of tappable rows.
 *
 * Connectors are drawn in CSS from the flex geometry: every match wrapper in a
 * column is flex:1, so half a wrapper's height is exactly half the distance to
 * its sibling's centre. No measurement, no JavaScript.
 */

import { ROUND_NAMES, SLOTS_PER_ROUND } from '../engine/types.js';
import type { Game, Round, RegionIndex, SlotId, Team, TeamId } from '../engine/types.js';
import { regionName } from '../data/sampleField.js';

export interface BracketView {
  games: readonly Game[];
  teams: ReadonlyMap<TeamId, Team>;
  picks: Readonly<Record<SlotId, TeamId>>;
  /** Set false once the entry is submitted or the pool has locked. */
  editable: boolean;
  /**
   * Slots to mark as decided by hand. Only the admin view passes this: an
   * overridden game is one the sync job will never touch again, so it needs to
   * be visible at a glance rather than buried in a document.
   */
  overridden?: ReadonlySet<SlotId>;
  /**
   * Show final scores beside each team. On for views of what actually
   * happened; off for an entry, where the bracket is a prediction and a score
   * would imply the game had been played.
   */
  showScores?: boolean;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function bySlot(games: readonly Game[]): Map<SlotId, Game> {
  return new Map(games.map((g) => [g.slot, g]));
}

/** Slots in a region for a given round, in bracket order. */
function slotsFor(round: Round, region: RegionIndex): SlotId[] {
  const perRegion = SLOTS_PER_ROUND[round] / 4;
  const first = (region - 1) * perRegion + 1;
  return Array.from({ length: perRegion }, (_, i) =>
    `R${round}-${String(first + i).padStart(2, '0')}`);
}

function teamRow(
  slot: SlotId,
  teamId: TeamId | null,
  view: BracketView,
  side: 'a' | 'b',
  score: number | null = null,
): string {
  if (!teamId) {
    return `<span class="team empty" data-side="${side}"><span class="seed"></span><span class="tname">TBD</span></span>`;
  }
  const team = view.teams.get(teamId);
  const label = team ? team.name : teamId;
  const seed = team ? String(team.seed) : '';
  const picked = view.picks[slot] === teamId;
  const classes = ['team', picked ? 'picked' : ''].filter(Boolean).join(' ');
  const tag = view.editable ? 'button' : 'span';
  const attrs = view.editable
    ? ` type="button" data-slot="${slot}" data-team="${escapeHtml(teamId)}"` +
      ` aria-pressed="${picked}"`
    : '';
  const scoreCell = view.showScores && score !== null
    ? `<span class="tscore">${score}</span>`
    : '';

  return `<${tag} class="${classes}" data-side="${side}"${attrs}>` +
    `<span class="seed">${seed}</span>` +
    `<span class="tname">${escapeHtml(label)}</span>` +
    scoreCell +
    `</${tag}>`;
}

function matchEl(slot: SlotId, view: BracketView, games: Map<SlotId, Game>): string {
  const game = games.get(slot);
  if (!game) return '';
  const decided = view.picks[slot] !== undefined;
  const manual = view.overridden?.has(slot) === true;
  return `<div class="match${decided ? ' done' : ''}${manual ? ' manual' : ''}"` +
    ` data-slot="${slot}">` +
    teamRow(slot, game.teamA, view, 'a', game.scoreA) +
    teamRow(slot, game.teamB, view, 'b', game.scoreB) +
    `</div>`;
}

function wrapped(slot: SlotId, view: BracketView, games: Map<SlotId, Game>): string {
  return `<div class="match-wrap">${matchEl(slot, view, games)}</div>`;
}

function regionEl(region: RegionIndex, view: BracketView, games: Map<SlotId, Game>): string {
  const rounds = ([1, 2, 3, 4] as Round[]).map((round) =>
    `<div class="round" data-round="${round}">` +
      slotsFor(round, region).map((slot) => wrapped(slot, view, games)).join('') +
    `</div>`).join('');
  return `<section class="region" aria-label="${escapeHtml(regionName(region))} region">` +
    `<h3 class="region-label">${escapeHtml(regionName(region))}</h3>` +
    `<div class="rounds">${rounds}</div>` +
  `</section>`;
}

export function renderDesktop(view: BracketView): string {
  const games = bySlot(view.games);
  return `
    <div class="bracket" role="group" aria-label="Tournament bracket">
      <div class="wing">
        ${regionEl(1, view, games)}
        ${regionEl(2, view, games)}
      </div>
      <div class="finals">
        <h3 class="region-label">Final Four</h3>
        <div class="match-wrap">${matchEl('R5-01', view, games)}</div>
        <div class="match-wrap champ">
          <span class="champ-label">Championship</span>
          ${matchEl('R6-01', view, games)}
        </div>
        <div class="match-wrap">${matchEl('R5-02', view, games)}</div>
      </div>
      <div class="wing mirror">
        ${regionEl(3, view, games)}
        ${regionEl(4, view, games)}
      </div>
    </div>
  `;
}

/** Which panel the mobile layout is showing: a region, or the Final Four. */
export type MobilePanel = RegionIndex | 'finals';

export function renderMobile(view: BracketView, panel: MobilePanel): string {
  const games = bySlot(view.games);

  const tabs = ([1, 2, 3, 4] as RegionIndex[]).map((region) => {
    const active = panel === region;
    return `<button type="button" class="tab${active ? ' active' : ''}"` +
      ` data-panel="${region}" aria-current="${active}">` +
      `${escapeHtml(regionName(region))}</button>`;
  }).join('') +
  `<button type="button" class="tab${panel === 'finals' ? ' active' : ''}"` +
  ` data-panel="finals" aria-current="${panel === 'finals'}">Final Four</button>`;

  const body = panel === 'finals'
    ? [5, 6].map((round) =>
        `<h4 class="round-label">${escapeHtml(ROUND_NAMES[round as Round])}</h4>` +
        (round === 5
          ? ['R5-01', 'R5-02'].map((s) => matchEl(s, view, games)).join('')
          : matchEl('R6-01', view, games))
      ).join('')
    : ([1, 2, 3, 4] as Round[]).map((round) =>
        `<h4 class="round-label">${escapeHtml(ROUND_NAMES[round])}</h4>` +
        slotsFor(round, panel).map((slot) => matchEl(slot, view, games)).join('')
      ).join('');

  return `
    <div class="mobile-bracket">
      <div class="tabs" role="tablist">${tabs}</div>
      <div class="panel-body">${body}</div>
    </div>
  `;
}

/** How many of the 63 picks are made, for the progress readout. */
export function pickCount(picks: Readonly<Record<SlotId, TeamId>>): number {
  return Object.keys(picks).length;
}
