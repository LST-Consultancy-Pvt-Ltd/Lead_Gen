// Pure helpers for the opportunities pipeline board.

// The backend also accepts the early stages "prospecting" and "qualification" (converted
// leads were created as "qualification"); the board shows them in the Qualified column.
const LEGACY_STAGE_ALIASES: Record<string, string> = { prospecting: 'qualified', qualification: 'qualified' };

export function normalizeStage(id?: string | null): string {
  return id ? LEGACY_STAGE_ALIASES[id] ?? id : 'qualified';
}

type PageResponse<T> = { data?: { data?: T[]; pagination?: { totalPages?: number } } };

/** Loads every page of a paginated list endpoint (the API defaults to 20 rows per page). */
export async function fetchAllPages<T>(
  fetchPage: (params: { page: number; limit: number }) => Promise<PageResponse<T>>,
  pageSize = 100,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetchPage({ page, limit: pageSize });
    const rows = res.data?.data ?? [];
    all.push(...rows);
    const totalPages = res.data?.pagination?.totalPages ?? 1;
    if (page >= totalPages || rows.length === 0) break;
  }
  return all;
}
