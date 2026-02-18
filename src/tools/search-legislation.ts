/**
 * search_legislation — Full-text search across Belgian statute provisions.
 */

import type { Database } from '@ansvar/mcp-sqlite';
import { buildFtsQueryVariants, sanitizeFtsInput } from '../utils/fts-query.js';
import { normalizeAsOfDate } from '../utils/as-of-date.js';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';

export interface SearchLegislationInput {
  query: string;
  document_id?: string;
  status?: string;
  as_of_date?: string;
  limit?: number;
}

export interface SearchLegislationResult {
  document_id: string;
  document_title: string;
  provision_ref: string;
  chapter: string | null;
  section: string;
  title: string | null;
  snippet: string;
  relevance: number;
  valid_from?: string | null;
  valid_to?: string | null;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function searchLegislation(
  db: Database,
  input: SearchLegislationInput
): Promise<ToolResponse<SearchLegislationResult[]>> {
  if (!input.query || input.query.trim().length === 0) {
    return {
      results: [],
      _metadata: generateResponseMetadata(db)
    };
  }

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const queryVariants = buildFtsQueryVariants(sanitizeFtsInput(input.query));
  const asOfDate = normalizeAsOfDate(input.as_of_date);

  const runCurrentQuery = (ftsQuery: string): SearchLegislationResult[] => {
    let sql = `
      SELECT
        lp.document_id,
        ld.title as document_title,
        lp.provision_ref,
        lp.chapter,
        lp.section,
        lp.title,
        snippet(provisions_fts, 0, '>>>', '<<<', '...', 32) as snippet,
        bm25(provisions_fts) as relevance,
        NULL as valid_from,
        NULL as valid_to
      FROM provisions_fts
      JOIN legal_provisions lp ON lp.id = provisions_fts.rowid
      JOIN legal_documents ld ON ld.id = lp.document_id
      WHERE provisions_fts MATCH ?
    `;

    const params: (string | number)[] = [ftsQuery];

    if (input.document_id) {
      sql += ` AND lp.document_id = ?`;
      params.push(input.document_id);
    }

    if (input.status) {
      sql += ` AND ld.status = ?`;
      params.push(input.status);
    }

    sql += ` ORDER BY relevance LIMIT ?`;
    params.push(limit);

    return db.prepare(sql).all(...params) as SearchLegislationResult[];
  };

  const runHistoricalQuery = (ftsQuery: string): SearchLegislationResult[] => {
    if (!asOfDate) {
      return [];
    }

    let sql = `
      WITH ranked_versions AS (
        SELECT
          lpv.document_id,
          ld.title as document_title,
          lpv.provision_ref,
          lpv.chapter,
          lpv.section,
          lpv.title,
          substr(lpv.content, 1, 320) as snippet,
          0.0 as relevance,
          lpv.valid_from,
          lpv.valid_to,
          row_number() OVER (
            PARTITION BY lpv.document_id, lpv.provision_ref
            ORDER BY COALESCE(lpv.valid_from, '0000-01-01') DESC, lpv.id DESC
          ) as version_rank
        FROM provision_versions_fts
        JOIN legal_provision_versions lpv ON lpv.id = provision_versions_fts.rowid
        JOIN legal_documents ld ON ld.id = lpv.document_id
        WHERE provision_versions_fts MATCH ?
          AND (lpv.valid_from IS NULL OR lpv.valid_from <= ?)
          AND (lpv.valid_to IS NULL OR lpv.valid_to > ?)
    `;
    const params: (string | number)[] = [ftsQuery, asOfDate, asOfDate];

    if (input.document_id) {
      sql += ` AND lpv.document_id = ?`;
      params.push(input.document_id);
    }

    if (input.status) {
      sql += ` AND ld.status = ?`;
      params.push(input.status);
    }

    sql += `
      )
      SELECT
        document_id,
        document_title,
        provision_ref,
        chapter,
        section,
        title,
        snippet,
        relevance,
        valid_from,
        valid_to
      FROM ranked_versions
      WHERE version_rank = 1
      ORDER BY relevance
      LIMIT ?
    `;
    params.push(limit);

    return db.prepare(sql).all(...params) as SearchLegislationResult[];
  };

  const queryWithFallback = (ftsQuery: string): SearchLegislationResult[] => {
    if (!asOfDate) {
      return runCurrentQuery(ftsQuery);
    }

    const historical = runHistoricalQuery(ftsQuery);
    if (historical.length > 0) {
      return historical;
    }

    // Fallback when historical table is not populated.
    return runCurrentQuery(ftsQuery);
  };

  const primaryResults = queryWithFallback(queryVariants.primary);
  const results = (primaryResults.length > 0 || !queryVariants.fallback)
    ? primaryResults
    : queryWithFallback(queryVariants.fallback);

  return {
    results,
    _metadata: generateResponseMetadata(db)
  };
}
