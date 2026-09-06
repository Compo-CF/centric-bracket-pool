/**
 * The control room.
 *
 * Two jobs matter here: recording who has paid, and correcting a result ESPN
 * got wrong or never delivered. Both write an audit row and recompute the
 * standings, so the leaderboard never sits stale behind an admin decision.
 */

import {
  ROUNDS, ROUND_NAMES, TOTAL_SLOTS, formatMoney,
  type Game, type Round, type Team, type TeamId,
} from '../engine/index.js';
import {
  loadAdminSnapshot, rebuildStandings, setPaid, setPoolOpen, setResult,
  type AdminSnapshot,
} from '../lib/adminStore.js';
import { escapeHtml } from './bracket.js';

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
    const named = new Map(bracket.teams.map((t: Team) => [t.id, t.name]));
    const decided = bracket.games.filter((g: Game) => g.winner !== null).length;

    const sections = ROUNDS.map((round: Round) => {
      const playable = bracket.games.filter((g: Game) => g.round === round && g.teamA && g.teamB);
      if (playable.length === 0) return '';

      const rows = playable.map((game: Game) => {
        const pick = (team: TeamId) => `<button type="button"
          class="${game.winner === team ? '' : 'secondary'}"
          data-slot="${game.slot}" data-winner="${escapeHtml(team)}">${
          escapeHtml(named.get(team) ?? team)}</button>`;
        return `<tr>
          <td class="mono">${game.slot}${game.overriddenBy
            ? ' <span class="status-pill admin">manual</span>' : ''}</td>
          <td class="picks">${pick(game.teamA as TeamId)} ${pick(game.teamB as TeamId)}</td>
          <td>${game.winner
            ? `<button type="button" class="secondary" data-slot="${game.slot}" data-clear="1">Clear</button>`
            : '<span class="meta">undecided</span>'}</td>
        </tr>`;
      }).join('');

      return `<h3 class="round-label">${escapeHtml(ROUND_NAMES[round])}</h3>
        <div class="scroller"><table class="board"><tbody>${rows}</tbody></table></div>`;
    }).join('');

    return `<div class="panel">
      <h2>Results</h2>
      <p class="meta">${decided} of ${TOTAL_SLOTS} games decided. Setting one by hand
      marks it manual, and the sync job will never touch it again.</p>
      ${sections || '<p>No games have a matchup yet.</p>'}
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
    root.className = 'shell';
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

    const paidId = target.dataset['paid'];
    if (paidId) {
      const value = target.dataset['value'] === 'true';
      void guard(async () => {
        snapshot = await setPaid(snapshot!, paidId, value, admin.email);
        notice = { kind: 'notice', text: `Marked ${value ? 'paid' : 'unpaid'}.` };
      });
      return;
    }

    const slot = target.dataset['slot'];
    if (slot) {
      const clear = target.dataset['clear'] === '1';
      const winner = clear ? null : target.dataset['winner'] ?? null;
      void guard(async () => {
        snapshot = await setResult(snapshot!, slot, winner, admin.email);
        notice = { kind: 'notice', text: `${slot} ${clear ? 'cleared' : 'set'}.` };
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
    root.removeEventListener('click', onClick);
  };
}
