/**
 * The real entry store. Same PoolStore interface as LocalStore, so nothing in
 * the UI changes.
 *
 * Shapes every write to satisfy firestore.rules, which are stricter than the
 * client needs to be:
 *   - create must carry ownerUid == the signed-in uid, and paid == false
 *   - update must not reassign ownerUid or change paid
 * The owner fields therefore live on the Firestore document but not on
 * StoredEntry, and are attached on write and dropped on read.
 */

import {
  collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where,
  type Firestore,
} from 'firebase/firestore';

import { db } from './firebase.js';
import type { PoolStore, StoredEntry } from './store.js';

interface EntryDoc extends StoredEntry {
  ownerUid: string;
  ownerEmail: string;
  ownerName: string;
}

export interface Owner {
  uid: string;
  email: string;
  name: string;
}

const COLLECTION = 'entries';

function toStored(id: string, data: EntryDoc): StoredEntry {
  return {
    id,
    name: data.name ?? 'Bracket',
    picks: data.picks ?? {},
    tiebreaker: data.tiebreaker ?? null,
    status: data.status === 'submitted' ? 'submitted' : 'draft',
    updatedAt: data.updatedAt ?? new Date(0).toISOString(),
    submittedAt: data.submittedAt ?? null,
    paid: data.paid === true,
  };
}

export class FirestoreStore implements PoolStore {
  readonly mode = 'firestore' as const;

  private readonly database: Firestore;

  constructor(private readonly owner: Owner) {
    this.database = db();
  }

  /**
   * Only this person's entries. Reading everyone else's is allowed after lock
   * and is what the leaderboard will do, separately.
   */
  async list(): Promise<StoredEntry[]> {
    const snapshot = await getDocs(query(
      collection(this.database, COLLECTION),
      where('ownerUid', '==', this.owner.uid),
    ));
    return snapshot.docs
      .map((d) => toStored(d.id, d.data() as EntryDoc))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<StoredEntry | null> {
    const snapshot = await getDoc(doc(this.database, COLLECTION, id));
    if (!snapshot.exists()) return null;
    return toStored(snapshot.id, snapshot.data() as EntryDoc);
  }

  /**
   * A full replace rather than a merge, so a pick removed by pruning actually
   * disappears instead of lingering in the stored map.
   *
   * `paid` is deliberately written from the existing document, never from the
   * caller: the rules reject an update that changes it, and an entrant must
   * not be able to mark their own bracket paid.
   */
  async save(entry: StoredEntry): Promise<void> {
    const ref = doc(this.database, COLLECTION, entry.id);
    const existing = await getDoc(ref);
    const paid = existing.exists() ? (existing.data() as EntryDoc).paid === true : false;

    const payload: EntryDoc = {
      ...entry,
      paid,
      ownerUid: this.owner.uid,
      ownerEmail: this.owner.email,
      ownerName: this.owner.name,
    };
    await setDoc(ref, payload);
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.database, COLLECTION, id));
  }
}
