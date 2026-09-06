/**
 * Bracket entry. Picks autosave as a draft; Submit is a separate, explicit
 * step that runs full validation first.
 */

import {
  TOTAL_SLOTS, projectEntryBracket, setPick, validateEntry,
  type Game, type SlotId, type Team, type TeamId,
} from '../engine/index.js';
import { SAMPLE_FIELD_LABEL } from '../data/sampleField.js';
import { touch, type PoolStore, type StoredEntry } from '../lib/store.js';
import {
  escapeHtml, pickCount, renderDesktop, renderMobile,
  type BracketView, type MobilePanel,
} from './bracket.js';

const MOBILE = '(max-width: 900px)';

export interface EntryPageContext {
  store: PoolStore;
  entry: StoredEntry;
  games: readonly Game[];
  teams: ReadonlyMap<TeamId, Team>;
  usingSampleField: boolean;
}

export function mountEntryPage(root: HTMLElement, ctx: EntryPageContext): () => void {
  let entry = ctx.entry;
  let panel: MobilePanel = 1;
  let message: { kind: 'error' | 'notice'; text: string } | null = null;

  const media = window.matchMedia(MOBILE);
  const onMediaChange = () => render();
  media.addEventListener('change', onMediaChange);

  function view(): BracketView {
    return {
      games: projectEntryBracket(ctx.games, entry.picks),
      teams: ctx.teams,
      picks: entry.picks,
      editable: entry.status === 'draft',
    };
  }

  function persist(): void {
    entry = touch(entry);
    void ctx.store.save(entry);
  }

  function render(): void {
    const scrollLeft = root.querySelector<HTMLElement>('.bracket-scroll')?.scrollLeft ?? 0;
    const scrollY = window.scrollY;

    const made = pickCount(entry.picks);
    const pct = Math.round((made / TOTAL_SLOTS) * 100);
    const locked = entry.status !== 'draft';

    root.innerHTML = `
      <nav class="topnav"><a href="#/entries">&larr; My entries</a></nav>
      <div class="entry-bar">
        <h2>${escapeHtml(entry.name)}</h2>
        <div class="progress">
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <span class="progress-text">${made} of ${TOTAL_SLOTS} picks</span>
        </div>
        <div class="actions">
          ${locked ? `<button type="button" id="reopen" class="secondary">Reopen</button>` : `
            <button type="button" id="autofill" class="secondary">Pick favorites</button>
            <button type="button" id="clear" class="secondary">Clear</button>
            <button type="button" id="submit">Submit entry</button>
          `}
        </div>
      </div>
      ${ctx.usingSampleField
        ? `<p><span class="sample-flag">${escapeHtml(SAMPLE_FIELD_LABEL)}</span>
             &nbsp;Not the real field &mdash; replaced on Selection Sunday.</p>`
        : ''}
      ${message ? `<div class="${message.kind}">${escapeHtml(message.text)}</div>` : ''}
      ${locked
        ? '<div class="notice">Submitted. You can reopen and edit until the first tip on Thursday.</div>'
        : ''}
      <div class="bracket-scroll">
        ${media.matches ? renderMobile(view(), panel) : renderDesktop(view())}
      </div>
      <div class="tiebreak">
        <label for="tiebreaker">Tiebreaker &mdash; combined score of the championship game</label>
        <input id="tiebreaker" type="number" min="0" max="400" inputmode="numeric"
               value="${entry.tiebreaker ?? ''}" ${locked ? 'disabled' : ''} />
      </div>
    `;

    const restored = root.querySelector<HTMLElement>('.bracket-scroll');
    if (restored) restored.scrollLeft = scrollLeft;
    window.scrollTo({ top: scrollY });
  }

  function betterSeed(sides: readonly TeamId[]): TeamId {
    const [first, second] = sides as [TeamId, TeamId];
    const a = ctx.teams.get(first);
    const b = ctx.teams.get(second);
    if (!a) return second;
    if (!b) return first;
    return a.seed <= b.seed ? first : second;
  }

  /**
   * Advance the better seed everywhere. Repeats because filling one round
   * creates the matchups for the next; it settles after at most six passes.
   */
  function autofill(): void {
    let picks = { ...entry.picks };
    let changed = true;
    while (changed) {
      changed = false;
      for (const game of projectEntryBracket(ctx.games, picks)) {
        if (picks[game.slot]) continue;
        const sides = [game.teamA, game.teamB].filter((t): t is TeamId => t !== null);
        if (sides.length !== 2) continue;
        picks = setPick(picks, game.slot, betterSeed(sides), ctx.games);
        changed = true;
      }
    }
    entry = { ...entry, picks };
    message = null;
    persist();
    render();
  }

  function submit(): void {
    const result = validateEntry(
      { ...entry, ownerUid: '', ownerEmail: '', ownerName: '', paid: false },
      ctx.games,
    );
    if (!result.complete) {
      const left = TOTAL_SLOTS - result.picksMade;
      message = { kind: 'error', text: `${left} game${left === 1 ? '' : 's'} still to pick.` };
    } else if (!result.valid) {
      message = { kind: 'error', text: result.problems[0]?.message ?? 'This bracket is not valid.' };
    } else if (entry.tiebreaker === null) {
      message = { kind: 'error', text: 'Enter a tiebreaker before submitting.' };
    } else {
      entry = touch({ ...entry, status: 'submitted', submittedAt: new Date().toISOString() });
      void ctx.store.save(entry);
      message = null;
    }
    render();
  }

  function onClick(event: Event): void {
    const target = (event.target as HTMLElement)
      .closest<HTMLElement>('[data-slot][data-team],[data-panel],button');
    if (!target || !root.contains(target)) return;

    const panelChoice = target.dataset['panel'];
    if (panelChoice) {
      panel = panelChoice === 'finals' ? 'finals' : (Number(panelChoice) as MobilePanel);
      render();
      return;
    }

    const slot = target.dataset['slot'] as SlotId | undefined;
    const team = target.dataset['team'] as TeamId | undefined;
    if (slot && team) {
      message = null;
      entry = { ...entry, picks: setPick(entry.picks, slot, team, ctx.games) };
      persist();
      render();
      return;
    }

    switch (target.id) {
      case 'submit': submit(); break;
      case 'autofill': autofill(); break;
      case 'clear':
        entry = { ...entry, picks: {} };
        message = null;
        persist();
        render();
        break;
      case 'reopen':
        entry = touch({ ...entry, status: 'draft', submittedAt: null });
        void ctx.store.save(entry);
        message = null;
        render();
        break;
      default: break;
    }
  }

  function onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.id !== 'tiebreaker') return;
    const value = input.value.trim();
    entry = { ...entry, tiebreaker: value === '' ? null : Number(value) };
    persist();
  }

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  render();

  return () => {
    media.removeEventListener('change', onMediaChange);
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
  };
}
