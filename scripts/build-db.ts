#!/usr/bin/env tsx
/**
 * Database builder for Belgian Law MCP server.
 *
 * Builds the SQLite database from seed JSON files in data/seed/.
 * Belgian-specific: supports bilingual FR/NL legislation linked by NUMAC.
 *
 * Usage: npm run build:db
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED_DIR = path.resolve(__dirname, '../data/seed');
const DB_PATH = path.resolve(__dirname, '../data/database.db');

// ─────────────────────────────────────────────────────────────────────────────
// Seed file types
// ─────────────────────────────────────────────────────────────────────────────

interface ProvisionSeed {
  provision_ref: string;
  chapter?: string;
  section: string;
  title?: string;
  content: string;
}

interface DocumentSeed {
  id: string;
  type: 'statute' | 'case_law';
  title: string;
  title_en?: string;
  short_name?: string;
  status: 'in_force' | 'amended' | 'repealed' | 'not_yet_in_force';
  issued_date?: string;
  in_force_date?: string;
  url?: string;
  description?: string;
  language?: string;
  numac?: string;
  provisions?: ProvisionSeed[];
  definitions?: DefinitionSeed[];
}

interface DefinitionSeed {
  term: string;
  term_en?: string;
  definition: string;
  source_provision?: string;
}

interface EUDocumentSeed {
  id: string;
  type: 'directive' | 'regulation';
  year: number;
  number: number;
  community?: string;
  celex_number?: string;
  title?: string;
  title_be?: string;
  short_name?: string;
  adoption_date?: string;
  entry_into_force_date?: string;
  in_force?: boolean;
  amended_by?: string;
  repeals?: string;
  url_eur_lex?: string;
  description?: string;
}

interface EUReferenceSeed {
  source_type: 'provision' | 'document' | 'case_law';
  source_id: string;
  document_id: string;
  provision_ref?: string;
  eu_document_id: string;
  eu_article?: string;
  reference_type: string;
  reference_context?: string;
  full_citation?: string;
  is_primary_implementation?: boolean;
  implementation_status?: string;
}

interface EUSeedData {
  eu_documents: EUDocumentSeed[];
  eu_references: EUReferenceSeed[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Database schema -- Belgian-specific with language column
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA = `
-- Legal documents (statutes, case law) -- bilingual with language column
CREATE TABLE legal_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('statute', 'case_law')),
  title TEXT NOT NULL,
  title_en TEXT,
  short_name TEXT,
  status TEXT NOT NULL DEFAULT 'in_force'
    CHECK(status IN ('in_force', 'amended', 'repealed', 'not_yet_in_force')),
  issued_date TEXT,
  in_force_date TEXT,
  url TEXT,
  description TEXT,
  language TEXT DEFAULT 'fr',
  numac TEXT,
  last_updated TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_documents_language ON legal_documents(language);
CREATE INDEX idx_documents_numac ON legal_documents(numac);
CREATE INDEX idx_documents_issued ON legal_documents(issued_date);

-- Individual provisions from statutes -- bilingual with language column
CREATE TABLE legal_provisions (
  id INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES legal_documents(id),
  provision_ref TEXT NOT NULL,
  chapter TEXT,
  section TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  language TEXT DEFAULT 'fr',
  metadata TEXT,
  UNIQUE(document_id, provision_ref)
);

CREATE INDEX idx_provisions_doc ON legal_provisions(document_id);
CREATE INDEX idx_provisions_chapter ON legal_provisions(document_id, chapter);
CREATE INDEX idx_provisions_language ON legal_provisions(language);

-- FTS5 for provision search
CREATE VIRTUAL TABLE provisions_fts USING fts5(
  content, title,
  content='legal_provisions',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER provisions_ai AFTER INSERT ON legal_provisions BEGIN
  INSERT INTO provisions_fts(rowid, content, title)
  VALUES (new.id, new.content, new.title);
END;

CREATE TRIGGER provisions_ad AFTER DELETE ON legal_provisions BEGIN
  INSERT INTO provisions_fts(provisions_fts, rowid, content, title)
  VALUES ('delete', old.id, old.content, old.title);
END;

CREATE TRIGGER provisions_au AFTER UPDATE ON legal_provisions BEGIN
  INSERT INTO provisions_fts(provisions_fts, rowid, content, title)
  VALUES ('delete', old.id, old.content, old.title);
  INSERT INTO provisions_fts(rowid, content, title)
  VALUES (new.id, new.content, new.title);
END;

-- Historical provision versions for date-aware lookups
CREATE TABLE legal_provision_versions (
  id INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES legal_documents(id),
  provision_ref TEXT NOT NULL,
  chapter TEXT,
  section TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  language TEXT DEFAULT 'fr',
  metadata TEXT,
  valid_from TEXT,
  valid_to TEXT
);

CREATE INDEX idx_provision_versions_doc_ref
  ON legal_provision_versions(document_id, provision_ref);
CREATE INDEX idx_provision_versions_window
  ON legal_provision_versions(valid_from, valid_to);

CREATE VIRTUAL TABLE provision_versions_fts USING fts5(
  content, title,
  content='legal_provision_versions',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER provision_versions_ai AFTER INSERT ON legal_provision_versions BEGIN
  INSERT INTO provision_versions_fts(rowid, content, title)
  VALUES (new.id, new.content, new.title);
END;

CREATE TRIGGER provision_versions_ad AFTER DELETE ON legal_provision_versions BEGIN
  INSERT INTO provision_versions_fts(provision_versions_fts, rowid, content, title)
  VALUES ('delete', old.id, old.content, old.title);
END;

CREATE TRIGGER provision_versions_au AFTER UPDATE ON legal_provision_versions BEGIN
  INSERT INTO provision_versions_fts(provision_versions_fts, rowid, content, title)
  VALUES ('delete', old.id, old.content, old.title);
  INSERT INTO provision_versions_fts(rowid, content, title)
  VALUES (new.id, new.content, new.title);
END;

-- Case law metadata
CREATE TABLE case_law (
  id INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL UNIQUE REFERENCES legal_documents(id),
  court TEXT NOT NULL,
  case_number TEXT,
  decision_date TEXT,
  summary TEXT,
  keywords TEXT
);

CREATE VIRTUAL TABLE case_law_fts USING fts5(
  summary, keywords,
  content='case_law',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER case_law_ai AFTER INSERT ON case_law BEGIN
  INSERT INTO case_law_fts(rowid, summary, keywords)
  VALUES (new.id, new.summary, new.keywords);
END;

CREATE TRIGGER case_law_ad AFTER DELETE ON case_law BEGIN
  INSERT INTO case_law_fts(case_law_fts, rowid, summary, keywords)
  VALUES ('delete', old.id, old.summary, old.keywords);
END;

CREATE TRIGGER case_law_au AFTER UPDATE ON case_law BEGIN
  INSERT INTO case_law_fts(case_law_fts, rowid, summary, keywords)
  VALUES ('delete', old.id, old.summary, old.keywords);
  INSERT INTO case_law_fts(rowid, summary, keywords)
  VALUES (new.id, new.summary, new.keywords);
END;

-- Cross-references between provisions/documents
CREATE TABLE cross_references (
  id INTEGER PRIMARY KEY,
  source_document_id TEXT NOT NULL REFERENCES legal_documents(id),
  source_provision_ref TEXT,
  target_document_id TEXT NOT NULL REFERENCES legal_documents(id),
  target_provision_ref TEXT,
  ref_type TEXT NOT NULL DEFAULT 'references'
    CHECK(ref_type IN ('references', 'amended_by', 'implements', 'see_also'))
);

CREATE INDEX idx_xref_source ON cross_references(source_document_id);
CREATE INDEX idx_xref_target ON cross_references(target_document_id);

-- Legal term definitions
CREATE TABLE definitions (
  id INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES legal_documents(id),
  term TEXT NOT NULL,
  term_en TEXT,
  definition TEXT NOT NULL,
  source_provision TEXT,
  UNIQUE(document_id, term)
);

CREATE VIRTUAL TABLE definitions_fts USING fts5(
  term, definition,
  content='definitions',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER definitions_ai AFTER INSERT ON definitions BEGIN
  INSERT INTO definitions_fts(rowid, term, definition)
  VALUES (new.id, new.term, new.definition);
END;

CREATE TRIGGER definitions_ad AFTER DELETE ON definitions BEGIN
  INSERT INTO definitions_fts(definitions_fts, rowid, term, definition)
  VALUES ('delete', old.id, old.term, old.definition);
END;

CREATE TRIGGER definitions_au AFTER UPDATE ON definitions BEGIN
  INSERT INTO definitions_fts(definitions_fts, rowid, term, definition)
  VALUES ('delete', old.id, old.term, old.definition);
  INSERT INTO definitions_fts(rowid, term, definition)
  VALUES (new.id, new.term, new.definition);
END;

-- =============================================================================
-- EU REFERENCES SCHEMA
-- =============================================================================

CREATE TABLE eu_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('directive', 'regulation')),
  year INTEGER NOT NULL CHECK (year >= 1957 AND year <= 2100),
  number INTEGER NOT NULL CHECK (number > 0),
  community TEXT CHECK (community IN ('EU', 'EG', 'EEG', 'Euratom', 'CE', 'CEE')),
  celex_number TEXT,
  title TEXT,
  title_be TEXT,
  short_name TEXT,
  adoption_date TEXT,
  entry_into_force_date TEXT,
  in_force BOOLEAN DEFAULT 1,
  amended_by TEXT,
  repeals TEXT,
  url_eur_lex TEXT,
  description TEXT,
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_eu_documents_type_year ON eu_documents(type, year DESC);
CREATE INDEX idx_eu_documents_celex ON eu_documents(celex_number);

CREATE TABLE eu_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK (source_type IN ('provision', 'document', 'case_law')),
  source_id TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES legal_documents(id),
  provision_id INTEGER REFERENCES legal_provisions(id),
  eu_document_id TEXT NOT NULL REFERENCES eu_documents(id),
  eu_article TEXT,
  reference_type TEXT NOT NULL CHECK (reference_type IN (
    'implements', 'supplements', 'applies', 'references', 'complies_with',
    'derogates_from', 'amended_by', 'repealed_by', 'cites_article'
  )),
  reference_context TEXT,
  full_citation TEXT,
  is_primary_implementation BOOLEAN DEFAULT 0,
  implementation_status TEXT CHECK (implementation_status IN ('complete', 'partial', 'pending', 'unknown')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_verified TEXT,
  UNIQUE(source_id, eu_document_id, eu_article)
);

CREATE INDEX idx_eu_references_document ON eu_references(document_id, eu_document_id);
CREATE INDEX idx_eu_references_eu_document ON eu_references(eu_document_id, document_id);
CREATE INDEX idx_eu_references_provision ON eu_references(provision_id, eu_document_id);

-- =============================================================================
-- VIEWS
-- =============================================================================

-- View: Bilingual document pairs (FR/NL linked by NUMAC)
CREATE VIEW v_bilingual_pairs AS
SELECT
  fr.id AS fr_document_id,
  fr.title AS fr_title,
  nl.id AS nl_document_id,
  nl.title AS nl_title,
  fr.numac,
  fr.issued_date
FROM legal_documents fr
JOIN legal_documents nl ON fr.numac = nl.numac AND nl.language = 'nl'
WHERE fr.language = 'fr'
ORDER BY fr.issued_date DESC;

-- View: National statutes implementing each EU directive
CREATE VIEW v_eu_implementations AS
SELECT
  ed.id AS eu_document_id,
  ed.type,
  ed.year,
  ed.number,
  ed.title,
  ed.short_name,
  ld.id AS document_id,
  ld.title AS belgian_title,
  ld.language,
  er.reference_type,
  er.is_primary_implementation,
  er.implementation_status
FROM eu_documents ed
JOIN eu_references er ON ed.id = er.eu_document_id
JOIN legal_documents ld ON er.document_id = ld.id
WHERE ed.type = 'directive'
ORDER BY ed.year DESC, ed.number, ld.id;

-- Build metadata
CREATE TABLE db_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function dedupeProvisions(provisions: ProvisionSeed[]): ProvisionSeed[] {
  const byRef = new Map<string, ProvisionSeed>();

  for (const provision of provisions) {
    const ref = provision.provision_ref.trim();
    const existing = byRef.get(ref);

    if (!existing) {
      byRef.set(ref, { ...provision, provision_ref: ref });
      continue;
    }

    // Keep the longer content version
    const existingLen = normalizeWhitespace(existing.content).length;
    const incomingLen = normalizeWhitespace(provision.content).length;
    if (incomingLen > existingLen) {
      byRef.set(ref, {
        ...provision,
        provision_ref: ref,
        title: provision.title || existing.title,
      });
    }
  }

  return Array.from(byRef.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

function buildDatabase(): void {
  console.log('Building Belgian Law MCP database...\n');

  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = DELETE');

  db.exec(SCHEMA);

  // Prepared statements
  const insertDoc = db.prepare(`
    INSERT INTO legal_documents (id, type, title, title_en, short_name, status, issued_date, in_force_date, url, description, language, numac)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertProvision = db.prepare(`
    INSERT INTO legal_provisions (document_id, provision_ref, chapter, section, title, content, language, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDefinition = db.prepare(`
    INSERT INTO definitions (document_id, term, term_en, definition, source_provision)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Load seed files
  if (!fs.existsSync(SEED_DIR)) {
    console.log(`No seed directory at ${SEED_DIR} -- creating empty database.`);
    insertMetadata(db);
    db.close();
    return;
  }

  const seedFiles = fs.readdirSync(SEED_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('.') && !f.startsWith('_')
      && f !== 'eu-references.json' && f !== 'eurlex-documents.json');

  if (seedFiles.length === 0) {
    console.log('No seed files found. Database created with empty schema.');
    insertMetadata(db);
    db.close();
    return;
  }

  let totalDocs = 0;
  let totalProvisions = 0;
  let totalDefs = 0;

  const loadAll = db.transaction(() => {
    for (const file of seedFiles) {
      const filePath = path.join(SEED_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const seed = JSON.parse(content) as DocumentSeed;

      insertDoc.run(
        seed.id,
        seed.type,
        seed.title,
        seed.title_en || null,
        seed.short_name || null,
        seed.status,
        seed.issued_date || null,
        seed.in_force_date || null,
        seed.url || null,
        seed.description || null,
        seed.language || 'fr',
        seed.numac || null
      );
      totalDocs++;

      const provisions = dedupeProvisions(seed.provisions || []);
      const lang = seed.language || 'fr';

      for (const prov of provisions) {
        insertProvision.run(
          seed.id,
          prov.provision_ref,
          prov.chapter || null,
          prov.section,
          prov.title || null,
          prov.content,
          lang,
          null
        );
        totalProvisions++;
      }

      for (const def of seed.definitions || []) {
        insertDefinition.run(
          seed.id,
          def.term,
          def.term_en || null,
          def.definition,
          def.source_provision || null
        );
        totalDefs++;
      }

      console.log(`  ${file}: ${provisions.length} provisions`);
    }

    // Load EU references if they exist
    const euRefsPath = path.join(SEED_DIR, 'eu-references.json');
    if (fs.existsSync(euRefsPath)) {
      console.log('\n  Loading EU references...');
      const euData = JSON.parse(fs.readFileSync(euRefsPath, 'utf-8')) as EUSeedData;

      const insertEUDoc = db.prepare(`
        INSERT OR IGNORE INTO eu_documents (
          id, type, year, number, community, celex_number,
          title, title_be, short_name, adoption_date, entry_into_force_date,
          in_force, amended_by, repeals, url_eur_lex, description
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertEURef = db.prepare(`
        INSERT OR IGNORE INTO eu_references (
          source_type, source_id, document_id, provision_id,
          eu_document_id, eu_article, reference_type, reference_context,
          full_citation, is_primary_implementation, implementation_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const doc of euData.eu_documents) {
        insertEUDoc.run(
          doc.id, doc.type, doc.year, doc.number,
          doc.community || 'EU', doc.celex_number || null,
          doc.title || null, doc.title_be || null, doc.short_name || null,
          doc.adoption_date || null, doc.entry_into_force_date || null,
          doc.in_force !== false ? 1 : 0,
          doc.amended_by || null, doc.repeals || null,
          doc.url_eur_lex || null, doc.description || null
        );
      }

      for (const ref of euData.eu_references) {
        const provRow = ref.provision_ref
          ? db.prepare('SELECT id FROM legal_provisions WHERE document_id = ? AND provision_ref = ?')
              .get(ref.document_id, ref.provision_ref) as { id: number } | undefined
          : undefined;

        insertEURef.run(
          ref.source_type, ref.source_id, ref.document_id,
          provRow?.id || null,
          ref.eu_document_id, ref.eu_article || null,
          ref.reference_type, ref.reference_context || null,
          ref.full_citation || null,
          ref.is_primary_implementation ? 1 : 0,
          ref.implementation_status || null
        );
      }

      console.log(`  ${euData.eu_documents.length} EU documents, ${euData.eu_references.length} EU references`);
    }
  });

  loadAll();

  // Insert metadata
  insertMetadata(db);

  // VACUUM for optimal size
  db.exec('VACUUM');

  db.close();

  const stats = fs.statSync(DB_PATH);
  console.log(`\n=== Build Summary ===`);
  console.log(`Documents: ${totalDocs}`);
  console.log(`Provisions: ${totalProvisions}`);
  console.log(`Definitions: ${totalDefs}`);
  console.log(`Database: ${DB_PATH} (${(stats.size / 1024).toFixed(0)} KB)`);
}

function insertMetadata(db: Database.Database): void {
  const insertMeta = db.prepare('INSERT OR REPLACE INTO db_metadata (key, value) VALUES (?, ?)');
  insertMeta.run('tier', 'free');
  insertMeta.run('schema_version', '1.0');
  insertMeta.run('jurisdiction', 'BE');
  insertMeta.run('languages', 'fr,nl');
  insertMeta.run('built_at', new Date().toISOString());
  insertMeta.run('builder', 'build-db.ts');
}

buildDatabase();
