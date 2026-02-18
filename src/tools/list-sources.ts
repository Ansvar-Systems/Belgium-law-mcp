/**
 * list_sources — Returns provenance metadata for all data sources.
 *
 * Required tool per the MCP audit standard (Phase 1.5).
 */

import type Database from '@ansvar/mcp-sqlite';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';

export interface DataSource {
  name: string;
  authority: string;
  url: string;
  retrieval_method: string;
  update_frequency: string;
  languages: string[];
  coverage: string;
  limitations: string;
  license: string;
}

export interface ListSourcesResult {
  jurisdiction: string;
  sources: DataSource[];
  dataset_stats: Record<string, number>;
  schema_version: string;
  tier: string;
  built_at: string;
}

function safeCount(db: InstanceType<typeof Database>, sql: string): number {
  try {
    const row = db.prepare(sql).get() as { count: number } | undefined;
    return row ? Number(row.count) : 0;
  } catch {
    return 0;
  }
}

function readMeta(db: InstanceType<typeof Database>, key: string): string {
  try {
    const row = db.prepare('SELECT value FROM db_metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function listSources(
  db: InstanceType<typeof Database>,
): Promise<ToolResponse<ListSourcesResult>> {
  return {
    results: {
      jurisdiction: 'Belgium (BE)',
      sources: [
        {
          name: 'Justel',
          authority: 'FPS Justice (Service public fédéral Justice)',
          url: 'https://www.ejustice.just.fgov.be',
          retrieval_method: 'HTML scraping from official Justel portal',
          update_frequency: 'Weekly automated checks, manual re-ingestion as needed',
          languages: ['fr', 'nl'],
          coverage:
            'Belgian federal statutes — primarily cybersecurity, data protection, and related legislation. ' +
            'Does NOT cover all Belgian federal laws. French is primary; Dutch translations available for bilingual laws.',
          limitations:
            'Initial release covers key cybersecurity legislation only. ' +
            'Dutch (NL) text may lag behind French (FR) in coverage. ' +
            'Case law and preparatory works not yet included in free tier.',
          license: 'Government open data (Belgian Official Journal)',
        },
        {
          name: 'EUR-Lex',
          authority: 'Publications Office of the European Union',
          url: 'https://eur-lex.europa.eu',
          retrieval_method: 'CELEX number cross-referencing',
          update_frequency: 'Linked at ingestion time',
          languages: ['en', 'fr'],
          coverage: 'EU directives and regulations referenced by Belgian implementing legislation',
          limitations: 'Only EU documents referenced by ingested Belgian statutes are included',
          license: 'EU open data (reuse permitted under Decision 2011/833/EU)',
        },
      ],
      dataset_stats: {
        legal_documents: safeCount(db, 'SELECT COUNT(*) as count FROM legal_documents'),
        legal_provisions: safeCount(db, 'SELECT COUNT(*) as count FROM legal_provisions'),
        eu_documents: safeCount(db, 'SELECT COUNT(*) as count FROM eu_documents'),
        eu_references: safeCount(db, 'SELECT COUNT(*) as count FROM eu_references'),
        definitions: safeCount(db, 'SELECT COUNT(*) as count FROM definitions'),
        cross_references: safeCount(db, 'SELECT COUNT(*) as count FROM cross_references'),
      },
      schema_version: readMeta(db, 'schema_version'),
      tier: readMeta(db, 'tier'),
      built_at: readMeta(db, 'built_at'),
    },
    _metadata: generateResponseMetadata(db),
  };
}
