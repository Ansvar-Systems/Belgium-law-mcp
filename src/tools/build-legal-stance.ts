/**
 * build_legal_stance — Aggregate citations for a legal question.
 */

import type { Database } from '@ansvar/mcp-sqlite';
import { buildFtsQueryVariants, sanitizeFtsInput } from '../utils/fts-query.js';
import { normalizeAsOfDate } from '../utils/as-of-date.js';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';

export interface BuildLegalStanceInput {
  query: string;
  document_id?: string;
  include_case_law?: boolean;
  include_preparatory_works?: boolean;
  as_of_date?: string;
  limit?: number;
}

interface ProvisionHit {
  document_id: string;
  document_title: string;
  provision_ref: string;
  title: string | null;
  snippet: string;
  relevance: number;
}

export interface LegalStanceResult {
  query: string;
  provisions: ProvisionHit[];
  total_citations: number;
  as_of_date?: string;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

export async function buildLegalStance(
  db: Database,
  input: BuildLegalStanceInput
): Promise<ToolResponse<LegalStanceResult>> {
  if (!input.query || input.query.trim().length === 0) {
    return {
      results: { query: '', provisions: [], total_citations: 0 },
      _metadata: generateResponseMetadata(db)
    };
  }

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const queryVariants = buildFtsQueryVariants(sanitizeFtsInput(input.query));
  const asOfDate = normalizeAsOfDate(input.as_of_date);

  const runCurrentProvisionQuery = (ftsQuery: string): ProvisionHit[] => {
    let provSql = `
      SELECT
        lp.document_id,
        ld.title as document_title,
        lp.provision_ref,
        lp.title,
        snippet(provisions_fts, 0, '>>>', '<<<', '...', 32) as snippet,
        bm25(provisions_fts) as relevance
      FROM provisions_fts
      JOIN legal_provisions lp ON lp.id = provisions_fts.rowid
      JOIN legal_documents ld ON ld.id = lp.document_id
      WHERE provisions_fts MATCH ?
    `;
    const provParams: (string | number)[] = [ftsQuery];

    if (input.document_id) {
      provSql += ` AND lp.document_id = ?`;
      provParams.push(input.document_id);
    }

    provSql += ` ORDER BY relevance LIMIT ?`;
    provParams.push(limit);

    return db.prepare(provSql).all(...provParams) as ProvisionHit[];
  };

  const runHistoricalProvisionQuery = (ftsQuery: string): ProvisionHit[] => {
    if (!asOfDate) {
      return [];
    }

    let provSql = `
      WITH ranked_versions AS (
        SELECT
          lpv.document_id,
          ld.title as document_title,
          lpv.provision_ref,
          lpv.title,
          substr(lpv.content, 1, 320) as snippet,
          0.0 as relevance,
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
    const provParams: (string | number)[] = [ftsQuery, asOfDate, asOfDate];

    if (input.document_id) {
      provSql += ` AND lpv.document_id = ?`;
      provParams.push(input.document_id);
    }

    provSql += `
      )
      SELECT
        document_id,
        document_title,
        provision_ref,
        title,
        snippet,
        relevance
      FROM ranked_versions
      WHERE version_rank = 1
      ORDER BY relevance
      LIMIT ?
    `;
    provParams.push(limit);

    return db.prepare(provSql).all(...provParams) as ProvisionHit[];
  };

  const runProvisionQuery = (ftsQuery: string): ProvisionHit[] => {
    if (!asOfDate) {
      return runCurrentProvisionQuery(ftsQuery);
    }

    const historicalResults = runHistoricalProvisionQuery(ftsQuery);
    if (historicalResults.length > 0) {
      return historicalResults;
    }

    return runCurrentProvisionQuery(ftsQuery);
  };

  let provisions = runProvisionQuery(queryVariants.primary);
  if (provisions.length === 0 && queryVariants.fallback) {
    provisions = runProvisionQuery(queryVariants.fallback);
  }

  return {
    results: {
      query: input.query,
      provisions,
      total_citations: provisions.length,
      as_of_date: asOfDate,
    },
    _metadata: generateResponseMetadata(db)
  };
}
