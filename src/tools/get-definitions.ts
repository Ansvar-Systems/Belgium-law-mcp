/**
 * get_definitions — Look up official term definitions from Belgian legislation.
 *
 * Uses FTS5 partial matching so "données" matches "données à caractère personnel".
 */

import type Database from '@ansvar/mcp-sqlite';
import { sanitizeFtsInput } from '../utils/fts-query.js';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';

export interface GetDefinitionsInput {
  term: string;
  document_id?: string;
  limit?: number;
}

export interface DefinitionResult {
  term: string;
  term_en: string | null;
  definition: string;
  source_provision: string | null;
  document_id: string;
  document_title: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function getDefinitions(
  db: InstanceType<typeof Database>,
  input: GetDefinitionsInput,
): Promise<ToolResponse<DefinitionResult[]>> {
  if (!input.term || input.term.trim().length === 0) {
    return { results: [], _metadata: generateResponseMetadata(db) };
  }

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const sanitized = sanitizeFtsInput(input.term);

  // Try FTS first, fall back to LIKE for short terms
  let results: DefinitionResult[];

  if (sanitized.length >= 2) {
    let sql = `
      SELECT
        d.term,
        d.term_en,
        d.definition,
        d.source_provision,
        d.document_id,
        ld.title as document_title
      FROM definitions_fts
      JOIN definitions d ON d.id = definitions_fts.rowid
      JOIN legal_documents ld ON ld.id = d.document_id
      WHERE definitions_fts MATCH ?
    `;
    const ftsQuery = `"${sanitized}"*`;
    const params: (string | number)[] = [ftsQuery];

    if (input.document_id) {
      sql += ` AND d.document_id = ?`;
      params.push(input.document_id);
    }
    sql += ` LIMIT ?`;
    params.push(limit);

    results = db.prepare(sql).all(...params) as DefinitionResult[];
  } else {
    // Very short term — use LIKE fallback
    let sql = `
      SELECT
        d.term,
        d.term_en,
        d.definition,
        d.source_provision,
        d.document_id,
        ld.title as document_title
      FROM definitions d
      JOIN legal_documents ld ON ld.id = d.document_id
      WHERE d.term LIKE ?
    `;
    const params: (string | number)[] = [`%${sanitized}%`];

    if (input.document_id) {
      sql += ` AND d.document_id = ?`;
      params.push(input.document_id);
    }
    sql += ` LIMIT ?`;
    params.push(limit);

    results = db.prepare(sql).all(...params) as DefinitionResult[];
  }

  return { results, _metadata: generateResponseMetadata(db) };
}
