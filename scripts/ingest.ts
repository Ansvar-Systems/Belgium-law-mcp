#!/usr/bin/env tsx
/**
 * Belgian Law ingestion pipeline.
 *
 * Three-phase pipeline:
 *   Phase 1 (Discovery): Fetch year indices, extract law metadata
 *   Phase 2 (Content FR): Fetch and parse French law texts
 *   Phase 3 (Content NL): Fetch and parse Dutch law texts
 *
 * Usage:
 *   npm run ingest
 *   npm run ingest -- --limit 5 --year-start 2023 --year-end 2024
 *   npm run ingest -- --lang fr --limit 10
 *   npm run ingest -- --phase discovery
 *   npm run ingest -- --phase content --lang both
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchYearIndex, fetchLawContent, buildJustelUrl } from './lib/fetcher.js';
import { parseYearIndex, parseLawContent } from './lib/parser.js';
import type { LawIndexEntry } from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../data');
const SOURCE_DIR = path.resolve(DATA_DIR, 'source');
const SEED_DIR = path.resolve(DATA_DIR, 'seed');

// ─────────────────────────────────────────────────────────────────────────────
// CLI argument parsing
// ─────────────────────────────────────────────────────────────────────────────

interface CliOptions {
  yearStart: number;
  yearEnd: number;
  limit: number;
  lang: 'fr' | 'nl' | 'both';
  phase: 'all' | 'discovery' | 'content';
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    yearStart: 1994,
    yearEnd: new Date().getFullYear(),
    limit: 0,
    lang: 'both',
    phase: 'all',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--year-start':
        options.yearStart = parseInt(args[++i], 10);
        break;
      case '--year-end':
        options.yearEnd = parseInt(args[++i], 10);
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--lang':
        options.lang = args[++i] as 'fr' | 'nl' | 'both';
        break;
      case '--phase':
        options.phase = args[++i] as 'all' | 'discovery' | 'content';
        break;
    }
  }

  return options;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed JSON types
// ─────────────────────────────────────────────────────────────────────────────

interface SeedProvision {
  provision_ref: string;
  section: string;
  title: string;
  content: string;
  chapter?: string;
}

interface SeedDocument {
  id: string;
  type: 'statute';
  title: string;
  status: 'in_force';
  issued_date: string;
  url: string;
  language: string;
  numac: string;
  provisions: SeedProvision[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Discovery
// ─────────────────────────────────────────────────────────────────────────────

async function runDiscovery(options: CliOptions): Promise<LawIndexEntry[]> {
  console.log('\n=== Phase 1: Discovery ===\n');
  console.log(`Fetching French law indices for years ${options.yearStart}-${options.yearEnd}...\n`);

  fs.mkdirSync(SOURCE_DIR, { recursive: true });

  const allEntries: LawIndexEntry[] = [];

  for (let year = options.yearStart; year <= options.yearEnd; year++) {
    try {
      const html = await fetchYearIndex(year, 'fr');
      const entries = parseYearIndex(html, 'fr');
      console.log(`  ${year}: ${entries.length} laws found`);
      allEntries.push(...entries);
    } catch (error) {
      console.error(`  ${year}: FAILED - ${(error as Error).message}`);
    }
  }

  // Apply limit if set
  const limited = options.limit > 0 ? allEntries.slice(0, options.limit) : allEntries;

  // Save index
  const indexPath = path.join(SOURCE_DIR, 'law-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(limited, null, 2));
  console.log(`\nSaved ${limited.length} entries to ${indexPath}`);

  return limited;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: French content
// ─────────────────────────────────────────────────────────────────────────────

async function runFrenchContent(entries: LawIndexEntry[], options: CliOptions): Promise<void> {
  console.log('\n=== Phase 2: French Content ===\n');
  console.log(`Processing ${entries.length} laws...\n`);

  fs.mkdirSync(SEED_DIR, { recursive: true });

  let processed = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      const html = await fetchLawContent(entry.year, entry.month, entry.day, entry.numac, 'fr');
      const parsed = parseLawContent(html, entry.numac);

      if (parsed.provisions.length === 0) {
        console.log(`  Skipping ${entry.numac} (no articles found): ${entry.title.substring(0, 60)}...`);
        continue;
      }

      // Build seed document
      const seedId = `loi-${entry.date}-${entry.numac}-fr`;
      const seed: SeedDocument = {
        id: seedId,
        type: 'statute',
        title: parsed.title || entry.title,
        status: 'in_force',
        issued_date: entry.date,
        url: buildJustelUrl(entry.year, entry.month, entry.day, entry.numac, 'fr'),
        language: 'fr',
        numac: entry.numac,
        provisions: parsed.provisions.map(p => ({
          provision_ref: p.provision_ref,
          section: p.section,
          title: p.title,
          content: p.content,
          ...(p.chapter ? { chapter: p.chapter } : {}),
        })),
      };

      const seedPath = path.join(SEED_DIR, `${seedId}.json`);
      fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2));
      processed++;
      console.log(`  [${processed}/${entries.length}] ${entry.numac}: ${parsed.provisions.length} articles - ${entry.title.substring(0, 50)}...`);
    } catch (error) {
      failed++;
      console.error(`  FAILED ${entry.numac}: ${(error as Error).message}`);
    }
  }

  console.log(`\nFrench: ${processed} processed, ${failed} failed`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: Dutch content
// ─────────────────────────────────────────────────────────────────────────────

async function runDutchContent(entries: LawIndexEntry[], _options: CliOptions): Promise<void> {
  console.log('\n=== Phase 3: Dutch Content ===\n');
  console.log(`Attempting Dutch versions for ${entries.length} laws...\n`);

  fs.mkdirSync(SEED_DIR, { recursive: true });

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const entry of entries) {
    try {
      const html = await fetchLawContent(entry.year, entry.month, entry.day, entry.numac, 'nl');
      const parsed = parseLawContent(html, entry.numac);

      if (parsed.provisions.length === 0) {
        skipped++;
        continue;
      }

      // Check if Dutch title differs from French (confirms it's actually a Dutch version)
      const seedId = `wet-${entry.date}-${entry.numac}-nl`;
      const seed: SeedDocument = {
        id: seedId,
        type: 'statute',
        title: parsed.title || entry.title,
        status: 'in_force',
        issued_date: entry.date,
        url: buildJustelUrl(entry.year, entry.month, entry.day, entry.numac, 'nl'),
        language: 'nl',
        numac: entry.numac,
        provisions: parsed.provisions.map(p => ({
          provision_ref: p.provision_ref,
          section: p.section,
          title: p.title,
          content: p.content,
          ...(p.chapter ? { chapter: p.chapter } : {}),
        })),
      };

      const seedPath = path.join(SEED_DIR, `${seedId}.json`);
      fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2));
      processed++;
      console.log(`  [${processed}] NL ${entry.numac}: ${parsed.provisions.length} articles`);
    } catch (error) {
      failed++;
      // Dutch version may not exist for all laws; this is expected
      if (String(error).includes('404')) {
        skipped++;
      } else {
        console.warn(`  NL FAILED ${entry.numac}: ${(error as Error).message}`);
      }
    }
  }

  console.log(`\nDutch: ${processed} processed, ${failed} failed, ${skipped} skipped (no Dutch version)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('Belgian Law Ingestion Pipeline');
  console.log('==============================');
  console.log(`Years: ${options.yearStart}-${options.yearEnd}`);
  console.log(`Limit: ${options.limit || 'none'}`);
  console.log(`Language: ${options.lang}`);
  console.log(`Phase: ${options.phase}`);

  let entries: LawIndexEntry[];

  // Phase 1: Discovery
  if (options.phase === 'all' || options.phase === 'discovery') {
    entries = await runDiscovery(options);
  } else {
    // Load existing index
    const indexPath = path.join(SOURCE_DIR, 'law-index.json');
    if (!fs.existsSync(indexPath)) {
      console.error('No law-index.json found. Run discovery phase first.');
      process.exit(1);
    }
    entries = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as LawIndexEntry[];
    if (options.limit > 0) {
      entries = entries.slice(0, options.limit);
    }
    console.log(`\nLoaded ${entries.length} entries from existing index.`);
  }

  // Phase 2: French content
  if (options.phase === 'all' || options.phase === 'content') {
    if (options.lang === 'fr' || options.lang === 'both') {
      await runFrenchContent(entries, options);
    }

    // Phase 3: Dutch content
    if (options.lang === 'nl' || options.lang === 'both') {
      await runDutchContent(entries, options);
    }
  }

  console.log('\nDone.');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
