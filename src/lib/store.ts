/**
 * Where entries live. The UI only ever talks to this interface, so swapping
 * the local implementation for Firestore is a one-file change once the
 * Firebase project exists.
 *
 * Methods are async even in the local implementation, so the call sites are
 * already shaped correctly for a network round trip.
 */

import type { SlotId, TeamId } from '../engine/types.js';

export type EntryStatus = 'draft' | 'submitted';

export interface StoredEntry {
  id: string;
  name: string;
  picks: Record<SlotId, TeamId>;
  tiebreaker: number | null;
  status: EntryStatus;
  updatedAt: string;
  submittedAt: string | null;
}

export interface PoolStore {
  /** 'local' means entries live in this browser only. Surfaced in the UI. */
  readonly mode: 'local' | 'firestore';
  list(): Promise<StoredEntry[]>;
  get(id: string): Promise<StoredEntry | null>;
  save(entry: StoredEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

const KEY = 'centric-bracket-pool/entries/v1';

/**
 * Browser-local store, used until Firebase is wired up. Every accessor is
 * guarded: private windows, cleared site data and locked-down browsers can all
 * make localStorage throw rather than simply return null.
 */
export class LocalStore implements PoolStore {
  readonly mode = 'local' as const;

  private read(): StoredEntry[] {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as StoredEntry[]) : [];
    } catch {
      return [];
    }
  }

  private write(entries: StoredEntry[]): void {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {
      // Nothing useful to do; the session keeps working, it just will not
      // survive a reload. The UI warns when the store is local anyway.
    }
  }

  async list(): Promise<StoredEntry[]> {
    return this.read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<StoredEntry | null> {
    return this.read().find((e) => e.id === id) ?? null;
  }

  async save(entry: StoredEntry): Promise<void> {
    const all = this.read();
    const at = all.findIndex((e) => e.id === entry.id);
    if (at >= 0) all[at] = entry;
    else all.push(entry);
    this.write(all);
  }

  async remove(id: string): Promise<void> {
    this.write(this.read().filter((e) => e.id !== id));
  }
}

export function newEntry(name: string): StoredEntry {
  return {
    id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name,
    picks: {},
    tiebreaker: null,
    status: 'draft',
    updatedAt: new Date().toISOString(),
    submittedAt: null,
  };
}

export function touch(entry: StoredEntry): StoredEntry {
  return { ...entry, updatedAt: new Date().toISOString() };
}

/** Adapt a stored entry to the shape the scoring engine expects. */
export function toEngineEntry(
  entry: StoredEntry,
  owner: { uid: string; email: string; name: string },
): {
  id: string; ownerUid: string; ownerEmail: string; ownerName: string;
  name: string; picks: Record<SlotId, TeamId>; tiebreaker: number | null;
  submittedAt: string | null; paid: boolean;
} {
  return {
    id: entry.id,
    ownerUid: owner.uid,
    ownerEmail: owner.email,
    ownerName: owner.name,
    name: entry.name,
    picks: entry.picks,
    tiebreaker: entry.tiebreaker,
    submittedAt: entry.submittedAt,
    paid: false,
  };
}
