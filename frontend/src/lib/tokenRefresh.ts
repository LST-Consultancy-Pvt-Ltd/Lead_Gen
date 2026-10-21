/**
 * Single-flight access-token refresh, shared by every request in the tab and
 * serialised across tabs.
 *
 * The backend keeps one refresh token per user and rotates it on every refresh, so
 * two refreshes racing with the same token would make one of them fail (or look
 * like token reuse). This module guarantees:
 *  - concurrent 401s in one tab trigger a single /auth/refresh call;
 *  - across tabs, refreshes run one at a time (Web Locks), and a tab that finds the
 *    tokens already rotated by another tab reuses them instead of refreshing again.
 */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(accessToken: string, refreshToken: string): void;
}

export type RefreshRequest = (refreshToken: string) => Promise<TokenPair>;
export type LockRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

/** Thrown when there is no refresh token to use — the session is already gone. */
export class SessionExpiredError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export const REFRESH_LOCK_NAME = 'leadforge-token-refresh';

/** Web Locks when available (all modern browsers), otherwise run directly. */
export const browserLock: LockRunner = (name, fn) => {
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  return locks?.request ? locks.request(name, fn) : fn();
};

/** True when a refresh failure means the session is over (vs. a network / server hiccup). */
export function isSessionEndedError(err: any): boolean {
  if (err instanceof SessionExpiredError) return true;
  const status = err?.response?.status;
  return status === 401 || status === 403;
}

/**
 * Validates the post-login `redirect` param: only same-origin dashboard paths are
 * allowed (no protocol-relative `//host`, backslashes or absolute URLs).
 */
export function safeReturnPath(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/dashboard') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) {
    return fallback;
  }
  return raw;
}

export function createTokenRefresher(deps: { store: TokenStore; request: RefreshRequest; lock?: LockRunner }) {
  const { store, request, lock = browserLock } = deps;
  let inFlight: Promise<string> | null = null;

  /**
   * Returns a valid access token.
   * @param failedToken the access token the failed request was sent with. If the
   *   stored token already differs, someone refreshed in the meantime and that
   *   token is returned without another round-trip.
   */
  return function refreshAccessToken(failedToken?: string | null): Promise<string> {
    if (inFlight) return inFlight;

    inFlight = lock(REFRESH_LOCK_NAME, async () => {
      const current = store.getAccessToken();
      if (current && failedToken && current !== failedToken) return current;

      const refreshToken = store.getRefreshToken();
      if (!refreshToken) throw new SessionExpiredError('No refresh token available');

      try {
        const tokens = await request(refreshToken);
        if (!tokens?.accessToken || !tokens?.refreshToken) {
          throw new Error('Incomplete token pair in refresh response');
        }
        store.setTokens(tokens.accessToken, tokens.refreshToken);
        return tokens.accessToken;
      } catch (err) {
        // Without Web Locks another tab may have rotated the token while we were
        // waiting; its tokens are valid, so use them instead of logging out.
        const latestRefresh = store.getRefreshToken();
        const latestAccess = store.getAccessToken();
        if (latestRefresh && latestRefresh !== refreshToken && latestAccess) return latestAccess;
        throw err;
      }
    }).finally(() => {
      inFlight = null;
    });

    return inFlight;
  };
}
