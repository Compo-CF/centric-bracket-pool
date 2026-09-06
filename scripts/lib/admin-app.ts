/**
 * Credentials for the local scripts and the scheduled job.
 *
 * Three credential shapes have to work:
 *   1. serviceAccount.json in the repo root, if one ever exists.
 *   2. gcloud user credentials, from `gcloud auth application-default login`.
 *   3. Workload Identity Federation, which google-github-actions/auth writes
 *      as an "external_account" file in CI.
 *
 * Firestore therefore comes from @google-cloud/firestore rather than
 * firebase-admin. firebase-admin only accepts a service account certificate or
 * its own ApplicationDefaultCredential and rejects external_account outright,
 * so the scheduled job authenticated correctly and then failed to build a
 * client. @google-cloud/firestore is the library firebase-admin wraps, and it
 * reads all three through google-auth-library.
 *
 * firebase-admin is kept only for Auth, which nothing in CI touches.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { Firestore } from '@google-cloud/firestore';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { GoogleAuth } from 'google-auth-library';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const KEY_PATH = resolve(root, 'serviceAccount.json');

export interface AdminContext {
  projectId: string;
  via: string;
}

let context: AdminContext | undefined;
let db: Firestore | undefined;
let auth: Auth | undefined;

/** Read the project id from .firebaserc so it is configured in one place. */
function projectIdFromFirebaserc(): string | undefined {
  const path = resolve(root, '.firebaserc');
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as
      { projects?: { default?: string } };
    const id = parsed.projects?.default;
    return id && id !== 'REPLACE_WITH_PROJECT_ID' ? id : undefined;
  } catch {
    return undefined;
  }
}

function reportNoCredentials(): void {
  console.error('No usable credentials found.\n');
  console.error('Sign in with gcloud (recommended -- no key file, and the');
  console.error('subtlefoodie.com org policy blocks key creation anyway):\n');
  console.error('  gcloud auth application-default login\n');
  console.error('Or put a serviceAccount.json in the repo root, which needs the org');
  console.error('policy iam.disableServiceAccountKeyCreation relaxed for this project.');
}

/**
 * Async because credentials only fail when a token is first requested. Probing
 * one up front turns a stack trace several lines into the work into a clear
 * message before anything starts.
 */
export async function initAdmin(): Promise<AdminContext> {
  if (context) return context;

  const fromFile = projectIdFromFirebaserc();

  if (existsSync(KEY_PATH)) {
    const key = JSON.parse(readFileSync(KEY_PATH, 'utf8')) as Record<string, unknown>;
    context = {
      projectId: fromFile ?? String(key['project_id'] ?? ''),
      via: 'serviceAccount.json',
    };
    return context;
  }

  const projectId = fromFile ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? '';
  if (!projectId) {
    console.error('No project id. Set projects.default in .firebaserc.');
    process.exit(1);
  }

  try {
    const client = await new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    }).getClient();
    const probe = await client.getAccessToken();
    if (!probe.token) throw new Error('no access token');
  } catch {
    reportNoCredentials();
    process.exit(1);
  }

  context = { projectId, via: 'application default credentials' };
  return context;
}

/** Firestore, via the client that understands every credential shape. */
export function firestore(): Firestore {
  if (!db) {
    const projectId = context?.projectId ?? projectIdFromFirebaserc();
    db = existsSync(KEY_PATH)
      ? new Firestore({ projectId, keyFilename: KEY_PATH })
      : new Firestore({ projectId });
  }
  return db;
}

/**
 * firebase-admin Auth, for custom claims and listing users. Local only: the
 * sync job's service account has no Identity Toolkit access, and firebase-admin
 * cannot build a credential from a Workload Identity Federation file anyway.
 */
export function adminAuth(): Auth {
  if (!auth) {
    initializeApp(existsSync(KEY_PATH)
      ? { credential: cert(JSON.parse(readFileSync(KEY_PATH, 'utf8')) as never) }
      : { credential: applicationDefault(), projectId: context?.projectId });
    auth = getAuth();
  }
  return auth;
}
