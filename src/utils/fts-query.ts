/**
 * FTS5 query builder for Belgian Law MCP.
 */

const EXPLICIT_FTS_SYNTAX = /["""]|(\bAND\b)|(\bOR\b)|(\bNOT\b)|\*$/;

/**
 * Sanitize user input before using in FTS5 queries.
 * Strips characters that have special meaning in FTS5 syntax
 * to prevent query syntax errors or injection.
 */
export function sanitizeFtsInput(input: string): string {
  return input
    .replace(/["""\u201C\u201D]/g, '') // smart and straight double quotes
    .replace(/['''\u2018\u2019]/g, '') // smart and straight single quotes
    .replace(/[{}[\]()^~:;]/g, '')     // FTS5 operators and brackets
    .trim();
}

export interface FtsQueryVariants {
  primary: string;
  fallback?: string;
}

export function buildFtsQueryVariants(query: string): FtsQueryVariants {
  const trimmed = query.trim();

  if (EXPLICIT_FTS_SYNTAX.test(trimmed)) {
    return { primary: trimmed };
  }

  const tokens = trimmed
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => t.replace(/[^\w\s-]/g, ''));

  if (tokens.length === 0) {
    return { primary: trimmed };
  }

  const primary = tokens.map(t => `"${t}"*`).join(' ');
  const fallback = tokens.map(t => `${t}*`).join(' OR ');

  return { primary, fallback };
}
