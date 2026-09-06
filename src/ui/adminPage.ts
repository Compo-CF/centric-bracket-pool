/**
 * The control room.
 *
 * Two jobs matter here: recording who has paid, and correcting a result ESPN
 * got wrong or never delivered. Both write an audit row and recompute the
 * standings, so the leaderboard never sits stale behind an admin decision.
 */

import {
  TOTAL_SLOTS, formatMoney,
  type Game, type Team, type TeamId,
} from '../engine/index.js';
import {
  loadAdminSnapshot, rebuildStandings, setPaid, setPoolOpen, setResult, setScore,
  type AdminSnapshot,
} from '../lib/adminStore.js';
import {
  escapeHtml, renderDesktop, renderMobile,
  type BracketView, type MobilePanel,
} from './bracket.js';

interface Notice { kind: 'error' | 'notice'; text: string }

const statusOf = (entry: { status?: string }): string => entry.status ?? 'draft';

export function mountAdminPage(
  root: HTMLElement,
  header: () => string,
  admin: { uid: string; email: string },
): () => void {
  let snapshot: AdminSnapshot | null = null;
  let notice: Notice | null = null;
  let busy = false;
  let disposed = false;
  let panel: MobilePanel = 1;

  const mobile = window.matchMedia('(max-width: 900px)');
  const onMediaChange = () => render();
  mobile.addEventListener('change', onMediaChange);

  function entryFee(): number {
    const prizes = snapshot?.config['prizes'] as { entryFeeCents?: number } | undefined;
    return prizes?.entryFeeCents ?? 1000;
  }

  function paymentsPanel(): string {
    const entries = [...(snapshot?.entries ?? [])].sort((a, b) =>
      a.ownerName.localeCompare(b.ownerName) || a.name.localeCompare(b.name));

    if (entries.length === 0) {
      return '<div class="panel"><h2>Payments</h2><p>No brackets yet.</p></div>';
    }

    const paid = entries.filter((e) => e.paid);
    const submitted = entries.filter((e) => statusOf(e as never) === 'submitted');
    const owed = (entries.length - paid.length) * entryFee();

    const rows = entries.map((entry) => {
      const isSubmitted = statusOf(entry as never) === 'submitted';
      const picks = Object.keys(entry.picks ?? {}).length;
      return `<tr>
        <td>${escapeHtml(entry.name)}<span class="owner">${escapeHtml(entry.ownerName)}</span></td>
        <td><span class="status-pill${isSubmitted ? ' submitted' : ''}">${
          isSubmitted ? 'Submitted' : 'Draft'}</span></td>
        <td class="num soft">${picks}/${TOTAL_SLOTS}</td>
        <td><button type="button" class="${entry.paid ? 'secondary' : ''}"
              data-paid="${escapeHtml(entry.id)}" data-value="${entry.paid ? 'false' : 'true'}">
              ${entry.paid ? 'Mark unpaid' : 'Mark paid'}</button></td>
      </tr>`;
    }).join('');

    return `<div class="panel">
      <h2>Payments</h2>
      <dl class="decisions">
        <div class="decision"><dt>Brackets</dt><dd>${entries.length}</dd></div>
        <div class="decision"><dt>Submitted</dt><dd>${submitted.length}</dd></div>
        <div class="decision"><dt>Paid</dt><dd>${paid.length}</dd></div>
        <div class="decision"><dt>Pot</dt><dd>${formatMoney(paid.length * entryFee())}</dd></div>
        <div class="decision"><dt>Outstanding</dt><dd>${formatMoney(owed)}</dd></div>
      </dl>
      <div class="scroller"><table class="board">
        <thead><tr><th>Bracket</th><th>Status</th><th class="num">Picks</th><th>Payment</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="meta">Only paid brackets are eligible for prize money. Marking one
      recomputes the standings straight away.</p>
    </div>`;
  }

  function resultsPanel(): string {
    const bracket = snapshot?.bracket;
    if (!bracket) return '';

    const decided = bracket.games.filter((g: Game) => g.winner !== null).length;
    const overridden = new Set(
      bracket.games.filter((g: Game) => g.overriddenBy).map((g: Game) => g.slot));

    // Winners drive the highlight, so the bracket reads as the tournament so
    // far rather than as somebody's picks.
    const picks: Record<string, TeamId> = {};
    for (const game of bracket.games) {
      if (game.winner) picks[game.slot] = game.winner;
    }

    const view: BracketView = {
      games: bracket.games,
      teams: new Map(bracket.teams.map((t: Team) => [t.id, t])),
      picks,
      editable: true,
      overridden,
      showScores: true,
    };

    return `<div class="panel">
      <h2>Results</h2>
      <p class="meta">${decided} of ${TOTAL_SLOTS} games decided. Click a team to
      make them the winner; click them again to undo. A game set here is marked
      <span class="status-pill admin">manual</span> and the sync job will never
      touch it again.</p>
      <div class="bracket-scroll">
        ${mobile.matches ? renderMobile(view, panel) : renderDesktop(view)}
      </div>
    </div>`;
  }

  function scoresPanel(): string {
    const bracket = snapshot?.bracket;
    if (!bracket) return '';

    const decided = bracket.games.filter((g: Game) => g.winner !== null);
    if (decided.length === 0) return '';

    const named = new Map(bracket.teams.map((t: Team) => [t.id, t.name]));
    const missing = decided.filter((g: Game) => g.scoreA === null || g.scoreB === null);
    const title = bracket.games.find((g: Game) => g.slot === 'R6-01');
    const titleNeedsScore = title?.winner !== null && title?.winner !== undefined
      && (title.scoreA === null || title.scoreB === null);

    const rows = decided.map((game: Game) => `<tr>
      <td class="mono">${game.slot}</td>
      <td>${escapeHtml(named.get(game.teamA ?? '') ?? '?')}</td>
      <td><input type="number" min="0" max="200" inputmode="numeric"
            class="score-input" data-score-a="${game.slot}"
            value="${game.scoreA ?? ''}" /></td>
      <td>${escapeHtml(named.get(game.teamB ?? '') ?? '?')}</td>
      <td><input type="number" min="0" max="200" inputmode="numeric"
            class="score-input" data-score-b="${game.slot}"
            value="${game.scoreB ?? ''}" /></td>
      <td><button type="button" class="secondary" data-save-score="${game.slot}">Save</button></td>
    </tr>`).join('');

    return `<div class="panel">
      <h2>Scores</h2>
      ${titleNeedsScore ? `<div class="error"><strong>The championship has no score.</strong>
        The tiebreaker is that game's combined total, so until this is filled in
        every tie in the pool -- including last place -- cannot be settled.</div>` : ''}
      <p class="meta">The sync job fills these in from ESPN. They only need
      touching for a game set by hand.
      ${missing.length > 0
        ? `<strong>${missing.length} of ${decided.length} decided game${
            decided.length === 1 ? '' : 's'} still without a score.</strong>`
        : 'All decided games have scores.'}</p>
      <div class="scroller"><table class="board"><tbody>${rows}</tbody></table></div>
    </div>`;
  }

  function settingsPanel(): string {
    const open = snapshot?.config['isOpen'] === true;
    const sample = snapshot?.bracket.isSampleField === true;
    return `<div class="panel">
      <h2>Pool</h2>
      ${sample ? `<div class="notice"><strong>Sample field.</strong> Import the real
        one on Selection Sunday with <code>npm run pool:import-field</code>.</div>` : ''}
      <p>Entries are <strong>${open ? 'open' : 'closed'}</strong>.</p>
      <div class="actions">
        <button type="button" id="toggle-open" class="secondary">${
          open ? 'Close entries' : 'Open entries'}</button>
        <button type="button" id="rebuild" class="secondary">Rebuild standings</button>
      </div>
      <p class="meta">Closing entries stops new brackets and edits immediately,
      whatever the lock time says.</p>
    </div>`;
  }

  function render(): void {
    if (disposed) return;
    root.className = 'shell wide';
    if (!snapshot) {
      root.innerHTML = `${header()}<p class="loading">Loading&hellip;</p>`;
      return;
    }
    root.innerHTML = `
      ${header()}
      ${notice ? `<div class="${notice.kind}">${escapeHtml(notice.text)}</div>` : ''}
      ${busy ? '<p class="loading">Saving&hellip;</p>' : ''}
      ${settingsPanel()}
      ${paymentsPanel()}
      ${resultsPanel()}
      ${scoresPanel()}
    `;
  }

  async function guard(work: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    notice = null;
    render();
    try {
      await work();
    } catch (error) {
      notice = {
        kind: 'error',
        text: error instanceof Error ? error.message : 'That did not work.',
      };
    } finally {
      busy = false;
      render();
    }
  }

  function onClick(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!target || !snapshot) return;

    // Mobile region tabs.
    const panelChoice = target.dataset['panel'];
    if (panelChoice) {
      panel = panelChoice === 'finals' ? 'finals' : (Number(panelChoice) as MobilePanel);
      render();
      return;
    }

    // A team in the bracket. Clicking the current winner undoes it, so there
    // is no separate clear control to hunt for.
    const bracketSlot = target.dataset['slot'];
    const team = target.dataset['team'];
    if (bracketSlot && team) {
      const game = snapshot.bracket.games.find((g: Game) => g.slot === bracketSlot);
      const winner = game?.winner === team ? null : team;
      void guard(async () => {
        snapshot = await setResult(snapshot!, bracketSlot, winner, admin.email);
        notice = {
          kind: 'notice',
          text: winner ? `${bracketSlot} set.` : `${bracketSlot} cleared.`,
        };
      });
      return;
    }

    const paidId = target.dataset['paid'];
    if (paidId) {
      const value = target.dataset['value'] === 'true';
      void guard(async () => {
        snapshot = await setPaid(snapshot!, paidId, value, admin.email);
        notice = { kind: 'notice', text: `Marked ${value ? 'paid' : 'unpaid'}.` };
      });
      return;
    }

    const saveScore = target.dataset['saveScore'];
    if (saveScore) {
      const read = (attr: string): number | null => {
        const input = root.querySelector<HTMLInputElement>(`[data-${attr}="${saveScore}"]`);
        const raw = input?.value.trim() ?? '';
        return raw === '' ? null : Number(raw);
      };
      const scoreA = read('score-a');
      const scoreB = read('score-b');
      if ((scoreA !== null && !Number.isFinite(scoreA))
        || (scoreB !== null && !Number.isFinite(scoreB))) {
        notice = { kind: 'error', text: 'Scores must be numbers.' };
        render();
        return;
      }
      void guard(async () => {
        snapshot = await setScore(snapshot!, saveScore, scoreA, scoreB, admin.email);
        notice = { kind: 'notice', text: `${saveScore} score saved.` };
      });
      return;
    }

    if (target.id === 'toggle-open') {
      const next = snapshot.config['isOpen'] !== true;
      void guard(async () => {
        await setPoolOpen(next, admin.email);
        snapshot = { ...snapshot!, config: { ...snapshot!.config, isOpen: next } };
        notice = { kind: 'notice', text: `Entries ${next ? 'opened' : 'closed'}.` };
      });
      return;
    }

    if (target.id === 'rebuild') {
      void guard(async () => {
        const result = await rebuildStandings(snapshot!);
        notice = {
          kind: 'notice',
          text: `Standings rebuilt: ${result.entryCount} entries, ` +
            `${result.paidCount} paid, pot ${formatMoney(result.potCents)}.`,
        };
      });
    }
  }

  root.addEventListener('click', onClick);
  render();

  void loadAdminSnapshot()
    .then((loaded) => { snapshot = loaded; render(); })
    .catch((error: Error) => {
      if (disposed) return;
      root.innerHTML = `${header()}<div class="error">${escapeHtml(error.message)}</div>`;
    });

  return () => {
    disposed = true;
    mobile.removeEventListener('change', onMediaChange);
    root.removeEventListener('click', onClick);
  };
}
