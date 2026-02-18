/**
 * search_case_law — Search Belgian court decisions.
 *
 * Capability-gated: only available when the case_law table exists.
 */

import type Database from '@ansvar/mcp-sqlite';
import { buildFtsQueryVariants } from '../utils/fts-query.js';
import { sanitizeFtsInput } from '../utils/fts-query.js';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';

export interface SearchCaseLawInput {
  query: string;
  court?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
}

export interface CaseLawResult {
  document_id: string;
  court: string;
  case_number: string | null;
  decision_date: string | null;
  summary: string | null;
  keywords: string | null;
  snippet: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function searchCaseLaw(
  db: InstanceType<typeof Database>,
  input: SearchCaseLawInput,
): Promise<ToolResponse<CaseLawResult[]>> {
  if (!input.query || input.query.trim().length === 0) {
    return { results: [], _metadata: generateResponseMetadata(db) };
  }

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const queryVariants = buildFtsQueryVariants(sanitizeFtsInput(input.query));

  const run = (ftsQuery: string): CaseLawResult[] => {
    let sql = `
      SELECT
        cl.document_id,
        cl.court,
        cl.case_number,
        cl.decision_date,
        cl.summary,
        cl.keywords,
        snippet(case_law_fts, 0, '>>>', '<<<', '...', 32) as snippet
      FROM case_law_fts
      JOIN case_law cl ON cl.id = case_law_fts.rowid
      WHERE case_law_fts MATCH ?
    `;
    const params: (string | number)[] = [ftsQuery];

    if (input.court) {
      sql += ` AND cl.court = ?`;
      params.push(input.court);
    }
    if (input.date_from) {
      sql += ` AND cl.decision_date >= ?`;
      params.push(input.date_from);
    }
    if (input.date_to) {
      sql += ` AND cl.decision_date <= ?`;
      params.push(input.date_to);
    }

    sql += ` ORDER BY bm25(case_law_fts) LIMIT ?`;
    params.push(limit);

    return db.prepare(sql).all(...params) as CaseLawResult[];
  };

  const primary = run(queryVariants.primary);
  const results =
    primary.length > 0 || !queryVariants.fallback
      ? primary
      : run(queryVariants.fallback);

  return { results, _metadata: generateResponseMetadata(db) };
}
