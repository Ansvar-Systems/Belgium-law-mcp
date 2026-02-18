# Belgian Law MCP Server — Developer Guide

## Git Workflow

- **Never commit directly to `main`.** Always create a feature branch and open a Pull Request.
- Branch protection requires: verified signatures, PR review, and status checks to pass.
- Use conventional commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, etc.

## Project Overview

Belgian Law MCP server providing bilingual (FR/NL) Belgian legislation search via Model Context Protocol. Strategy A deployment (Vercel, bundled SQLite DB).

## Architecture

- **Transport:** Dual-channel — stdio (npm package) + Streamable HTTP (Vercel serverless)
- **Database:** SQLite + FTS5 via `@ansvar/mcp-sqlite` (WASM-compatible, no WAL mode)
- **Entry points:** `src/index.ts` (stdio), `api/mcp.ts` (Vercel HTTP)
- **Tool registry:** `src/tools/registry.ts` — shared between both transports
- **Capability gating:** `src/capabilities.ts` — detects available DB tables at runtime

## Key Conventions

- All database queries use parameterized statements (never string interpolation)
- FTS5 queries go through `buildFtsQueryVariants()` with primary + fallback strategy
- User input is sanitized via `sanitizeFtsInput()` before FTS5 queries
- Every tool returns `ToolResponse<T>` with `results` + `_metadata` (freshness, disclaimer)
- Tool descriptions are written for LLM agents — explain WHEN and WHY to use each tool
- Capability-gated tools only appear in `tools/list` when their DB tables exist

## Testing

- Unit tests: `tests/` (vitest, in-memory SQLite fixtures)
- Contract tests: `__tests__/contract/golden.test.ts` with `fixtures/golden-tests.json`
- Nightly mode: `CONTRACT_MODE=nightly` enables network assertions (URL resolution, upstream hashes)
- Run: `npm test` (unit), `npm run test:contract` (golden), `npm run validate` (both)

## Database

- Schema defined inline in `scripts/build-db.ts`
- Journal mode: DELETE (not WAL — required for Vercel serverless)
- Runtime: copied to `/tmp/database.db` on Vercel cold start
- Metadata: `db_metadata` table stores tier, schema_version, built_at, builder

## Data Pipeline

1. `scripts/ingest.ts` → fetches from Justel → JSON seed files in `data/seed/`
2. `scripts/build-db.ts` → seed JSON → SQLite database in `data/database.db`
3. `scripts/check-updates.ts` → checks Justel for new legislation
4. `scripts/drift-detect.ts` → verifies upstream content hasn't changed

## Deployment

- Vercel Strategy A: DB bundled in `data/database.db`, included via `vercel.json` includeFiles
- Pre-build: `scripts/download-db.sh` downloads pre-built DB
- npm package: `@ansvar/belgian-law-mcp` with bin entry for stdio

## Security

- 6-layer scanning: CodeQL, Semgrep, Trivy, Gitleaks, Socket Security, OSSF Scorecard
- All in `.github/workflows/security.yml`
- `npm audit` runs in CI on every build
