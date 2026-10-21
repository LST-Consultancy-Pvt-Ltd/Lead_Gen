/**
 * Local drafts for the Lead form, so typed data survives a session expiry
 * (redirect to login) and can be restored after signing back in.
 *
 * Drafts are keyed by user id — another user signing in on the same browser never
 * sees them — and expire after DRAFT_TTL_MS.
 */

export const DRAFT_PREFIX = 'leadforge-draft:';
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // matches the refresh-token window
/** Dispatched on window right before the app logs out because the session ended. */
export const SESSION_EXPIRED_EVENT = 'leadforge:session-expired';

const VERSION = 1;

export interface DraftRecord<T> {
  v: number;
  savedAt: number;
  /** Set when the draft was flushed because the session expired mid-edit. */
  interrupted: boolean;
  values: T;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): DraftStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function draftKey(userId: string, formId: string) {
  return `${DRAFT_PREFIX}${userId}:${formId}`;
}

export function saveDraft<T>(
  userId: string | null | undefined,
  formId: string,
  values: T,
  opts: { interrupted?: boolean; storage?: DraftStorage | null; now?: number } = {},
) {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  if (!userId || !storage) return;
  const record: DraftRecord<T> = { v: VERSION, savedAt: opts.now ?? Date.now(), interrupted: !!opts.interrupted, values };
  try {
    storage.setItem(draftKey(userId, formId), JSON.stringify(record));
  } catch {
    // Quota exceeded / storage disabled — drafts are best-effort
  }
}

export function loadDraft<T>(
  userId: string | null | undefined,
  formId: string,
  opts: { storage?: DraftStorage | null; now?: number } = {},
): DraftRecord<T> | null {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  if (!userId || !storage) return null;
  const key = draftKey(userId, formId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw) as DraftRecord<T>;
    const fresh = record?.v === VERSION && record.values && (opts.now ?? Date.now()) - record.savedAt <= DRAFT_TTL_MS;
    if (!fresh) {
      storage.removeItem(key);
      return null;
    }
    return record;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function clearDraft(userId: string | null | undefined, formId: string, storage: DraftStorage | null = defaultStorage()) {
  if (!userId || !storage) return;
  try { storage.removeItem(draftKey(userId, formId)); } catch { /* ignore */ }
}

/** True when any field outside `ignore` holds user-entered data (non-empty string / array). */
export function hasDraftContent(values: Record<string, unknown> | null | undefined, ignore: string[] = []) {
  if (!values) return false;
  return Object.entries(values).some(([k, v]) => {
    if (ignore.includes(k)) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'string') return v.trim() !== '';
    return v != null && v !== false;
  });
}
