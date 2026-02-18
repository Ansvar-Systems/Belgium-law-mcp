/**
 * Tool registry for Belgian Law MCP Server.
 * Shared between stdio (index.ts) and HTTP (api/mcp.ts) entry points.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import Database from '@ansvar/mcp-sqlite';

import { searchLegislation, SearchLegislationInput } from './search-legislation.js';
import { getProvision, GetProvisionInput } from './get-provision.js';
import { validateCitationTool, ValidateCitationInput } from './validate-citation.js';
import { buildLegalStance, BuildLegalStanceInput } from './build-legal-stance.js';
import { formatCitationTool, FormatCitationInput } from './format-citation.js';
import { checkCurrency, CheckCurrencyInput } from './check-currency.js';
import { getEUBasis, GetEUBasisInput } from './get-eu-basis.js';
import { getBelgianImplementations, GetBelgianImplementationsInput } from './get-belgian-implementations.js';
import { searchEUImplementations, SearchEUImplementationsInput } from './search-eu-implementations.js';
import { getProvisionEUBasis, GetProvisionEUBasisInput } from './get-provision-eu-basis.js';
import { validateEUCompliance, ValidateEUComplianceInput } from './validate-eu-compliance.js';
import { listSources } from './list-sources.js';
import { searchCaseLaw, SearchCaseLawInput } from './search-case-law.js';
import { getDefinitions, GetDefinitionsInput } from './get-definitions.js';
import { getAbout, type AboutContext } from './about.js';
import { detectCapabilities } from '../capabilities.js';
import { upgradeMessage } from '../capabilities.js';
export type { AboutContext } from './about.js';

/* ------------------------------------------------------------------ */
/*  Tool definitions with audit-grade descriptions                    */
/* ------------------------------------------------------------------ */

const ABOUT_TOOL: Tool = {
  name: 'about',
  description:
    'Server metadata, dataset statistics, freshness, and provenance. ' +
    'Call this to verify data coverage, currency, and content basis before relying on results.',
  inputSchema: { type: 'object', properties: {} },
};

const LIST_SOURCES_TOOL: Tool = {
  name: 'list_sources',
  description:
    'Returns detailed provenance metadata for all data sources used by this server, ' +
    'including Justel (Belgian Official Journal) and EUR-Lex. ' +
    'Use this to understand what data is available, its authority, coverage scope, and known limitations. ' +
    'Also returns dataset statistics (document counts, provision counts) and database build timestamp. ' +
    'Call this FIRST when you need to understand what Belgian legal data this server covers.',
  inputSchema: { type: 'object', properties: {} },
};

export const TOOLS: Tool[] = [
  {
    name: 'search_legislation',
    description:
      'Search Belgian statutes and regulations by keyword using full-text search (FTS5 with BM25 ranking). ' +
      'Returns matching provisions with document context, snippets with >>> <<< markers around matched terms, and relevance scores. ' +
      'Supports FTS5 syntax: quoted phrases ("exact match"), boolean operators (AND, OR, NOT), and prefix wildcards (term*). ' +
      'Use as_of_date to search historical provision versions valid on a specific date. ' +
      'Results are in French (primary) or Dutch depending on available translations. ' +
      'Default limit is 10 results. For broad topics, increase the limit. ' +
      'Do NOT use this for retrieving a known provision — use get_provision instead.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query in French or Dutch. Supports FTS5 syntax: ' +
            '"protection données" for exact phrase, term* for prefix, AND/OR/NOT for boolean.',
        },
        document_id: {
          type: 'string',
          description: 'Optional: filter results to a specific statute by its document ID.',
        },
        status: {
          type: 'string',
          enum: ['in_force', 'amended', 'repealed'],
          description: 'Optional: filter by legislative status.',
        },
        as_of_date: {
          type: 'string',
          description:
            'Optional: ISO 8601 date (YYYY-MM-DD). Returns historical provision versions valid on that date. ' +
            'Omit to search current (in-force) provisions.',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 10, max: 50).',
          default: 10,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_provision',
    description:
      'Retrieve the full text of a specific provision (article/section) from a Belgian statute. ' +
      'Specify a document_id and optionally a section number or provision_ref to get a single provision. ' +
      'Omit section/provision_ref to get ALL provisions in the statute (use sparingly — can be large). ' +
      'Use as_of_date to retrieve the historical version of a provision valid on a specific date. ' +
      'Returns provision text, chapter, section number, and metadata. ' +
      'Use this when you know WHICH provision you want. For discovery, use search_legislation instead.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description:
            'Statute identifier (e.g., "loi-2018-07-30-2018040581-fr") or a fuzzy title match ' +
            '(e.g., "Loi du 30 juillet 2018"). The server resolves titles to IDs automatically.',
        },
        section: {
          type: 'string',
          description: 'Section/article number (e.g., "3", "5 a"). Omit to get all provisions.',
        },
        provision_ref: {
          type: 'string',
          description: 'Direct provision reference (e.g., "art3"). Alternative to section parameter.',
        },
        as_of_date: {
          type: 'string',
          description: 'Optional: ISO 8601 date (YYYY-MM-DD). Returns the provision version valid on that date.',
        },
      },
      required: ['document_id'],
    },
  },
  {
    name: 'validate_citation',
    description:
      'Validate a Belgian legal citation against the database — zero-hallucination check. ' +
      'Parses the citation, checks that the document and provision exist, and returns warnings about status ' +
      '(repealed, amended). Use this to verify any citation BEFORE including it in a legal analysis. ' +
      'Supports formats: "Loi du 2 février 1994, art. 1", "Section 3, Data Protection Act 2018", ' +
      'or statute ID + provision reference.',
    inputSchema: {
      type: 'object',
      properties: {
        citation: {
          type: 'string',
          description:
            'Citation string to validate. Examples: "Loi du 2 février 1994, art. 1", ' +
            '"loi-2018-07-30-2018040581-fr art3".',
        },
      },
      required: ['citation'],
    },
  },
  {
    name: 'build_legal_stance',
    description:
      'Build a comprehensive set of citations for a legal question by searching across all Belgian statutes simultaneously. ' +
      'Returns aggregated results from multiple relevant provisions, useful for legal research on a topic. ' +
      'Use this for broad legal questions like "What are the penalties for data breaches?" ' +
      'rather than looking up a specific known provision. ' +
      'Results include statute context and are ranked by relevance.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Legal question or topic to research (e.g., "protection des données personnelles").',
        },
        document_id: {
          type: 'string',
          description: 'Optional: limit search to one statute by document ID.',
        },
        limit: {
          type: 'number',
          description: 'Max results per category (default: 5, max: 20).',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'format_citation',
    description:
      'Format a Belgian legal citation per standard Belgian citation conventions. ' +
      'Three formats: "full" (formal, e.g., "Loi du 2 février 1994, art. 1"), ' +
      '"short" (abbreviated), "pinpoint" (article reference only). ' +
      'Use this to normalize citation format before presenting to users.',
    inputSchema: {
      type: 'object',
      properties: {
        citation: { type: 'string', description: 'Citation string to format.' },
        format: {
          type: 'string',
          enum: ['full', 'short', 'pinpoint'],
          description: 'Output format (default: "full").',
          default: 'full',
        },
      },
      required: ['citation'],
    },
  },
  {
    name: 'check_currency',
    description:
      'Check whether a Belgian statute or provision is currently in force, amended, repealed, or not yet in force. ' +
      'Returns the document status, issued date, in-force date, and warnings (e.g., if repealed). ' +
      'Use as_of_date to check historical in-force status. ' +
      'Essential before citing any provision — always verify currency.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'Statute identifier or title (fuzzy matching supported).',
        },
        provision_ref: {
          type: 'string',
          description: 'Optional: provision reference to check a specific article.',
        },
        as_of_date: {
          type: 'string',
          description: 'Optional: ISO 8601 date (YYYY-MM-DD). Checks in-force status as of that date.',
        },
      },
      required: ['document_id'],
    },
  },
  {
    name: 'get_eu_basis',
    description:
      'Get the EU legal basis (directives and regulations) that a Belgian statute implements, supplements, or references. ' +
      'Returns EU document identifiers (CELEX numbers), directive/regulation references, and implementation status. ' +
      'Use this to trace which EU law a Belgian statute is based on — essential for EU compliance analysis. ' +
      'Example: find that a Belgian data protection law implements GDPR (Regulation 2016/679).',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'Belgian statute identifier.',
        },
        include_articles: {
          type: 'boolean',
          description: 'Include specific EU article references (default: false).',
          default: false,
        },
        reference_types: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['implements', 'supplements', 'applies', 'references', 'complies_with',
                   'derogates_from', 'amended_by', 'repealed_by', 'cites_article'],
          },
          description: 'Filter by reference type (e.g., ["implements", "supplements"]).',
        },
      },
      required: ['document_id'],
    },
  },
  {
    name: 'get_belgian_implementations',
    description:
      'Find all Belgian statutes that implement a specific EU directive or regulation. ' +
      'Given an EU document ID (e.g., "regulation:2016/679" for GDPR), returns Belgian implementing statutes ' +
      'with implementation status (complete/partial/pending). ' +
      'Use this to answer "Which Belgian laws implement [EU directive]?"',
    inputSchema: {
      type: 'object',
      properties: {
        eu_document_id: {
          type: 'string',
          description:
            'EU document ID in format "type:year/number" (e.g., "regulation:2016/679" for GDPR, ' +
            '"directive:2016/1148" for NIS). Type is "directive" or "regulation".',
        },
        primary_only: {
          type: 'boolean',
          description: 'Return only primary implementing statutes (default: false).',
          default: false,
        },
        in_force_only: {
          type: 'boolean',
          description: 'Return only currently in-force statutes (default: false).',
          default: false,
        },
      },
      required: ['eu_document_id'],
    },
  },
  {
    name: 'search_eu_implementations',
    description:
      'Search for EU directives and regulations that have Belgian implementing legislation. ' +
      'Search by keyword, type (directive/regulation), or year range. ' +
      'Returns matching EU documents with counts of Belgian statutes referencing them. ' +
      'Use this for exploratory searches like "data protection" or "cybersecurity" to find relevant EU law and its Belgian implementation.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword search across EU document titles and descriptions.',
        },
        type: {
          type: 'string',
          enum: ['directive', 'regulation'],
          description: 'Filter by EU document type.',
        },
        year_from: { type: 'number', description: 'Filter by year (from).' },
        year_to: { type: 'number', description: 'Filter by year (to).' },
        has_belgian_implementation: {
          type: 'boolean',
          description: 'If true, only return EU documents with at least one Belgian implementing statute.',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20, max: 100).',
          default: 20,
        },
      },
    },
  },
  {
    name: 'get_provision_eu_basis',
    description:
      'Get the EU legal basis for a SPECIFIC provision within a Belgian statute. ' +
      'Returns EU directives/regulations that this specific provision implements, with article-level precision. ' +
      'More granular than get_eu_basis (which operates at the statute level). ' +
      'Use this for pinpoint EU compliance checks at the provision level.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'Belgian statute identifier.',
        },
        provision_ref: {
          type: 'string',
          description: 'Provision reference (e.g., "art3" or "3").',
        },
      },
      required: ['document_id', 'provision_ref'],
    },
  },
  {
    name: 'validate_eu_compliance',
    description:
      'Check EU compliance status for a Belgian statute or provision. ' +
      'Detects: references to repealed EU directives, missing implementation status, outdated references. ' +
      'Returns compliance status (compliant, partial, unclear, not_applicable) with warnings and recommendations. ' +
      'Use this as a compliance health check before relying on a statute for regulatory analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'Belgian statute identifier.',
        },
        provision_ref: {
          type: 'string',
          description: 'Optional: check compliance for a specific provision.',
        },
        eu_document_id: {
          type: 'string',
          description: 'Optional: check compliance with a specific EU document.',
        },
      },
      required: ['document_id'],
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Capability-gated tools (only shown when DB tables exist)          */
/* ------------------------------------------------------------------ */

const SEARCH_CASE_LAW_TOOL: Tool = {
  name: 'search_case_law',
  description:
    'Search Belgian court decisions (case law) by keyword. ' +
    'Returns case summaries, court, case number, decision date, and keyword matches. ' +
    'Filter by court (e.g., "Cour de cassation", "Conseil d\'État") and date range. ' +
    'Available only in professional tier — requires case_law table.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query for case law summaries and keywords.',
      },
      court: {
        type: 'string',
        description: 'Optional: filter by court name.',
      },
      date_from: {
        type: 'string',
        description: 'Optional: start date filter (ISO 8601, e.g., "2020-01-01").',
      },
      date_to: {
        type: 'string',
        description: 'Optional: end date filter (ISO 8601).',
      },
      limit: {
        type: 'number',
        description: 'Maximum results (default: 10, max: 50).',
        default: 10,
      },
    },
    required: ['query'],
  },
};

const GET_DEFINITIONS_TOOL: Tool = {
  name: 'get_definitions',
  description:
    'Look up official term definitions from Belgian legislation. ' +
    'Uses partial matching: "données" matches "données à caractère personnel". ' +
    'Returns the defined term, its definition text, and the source provision. ' +
    'Optionally filter to a specific statute. Use this to find legal definitions before interpreting legislation.',
  inputSchema: {
    type: 'object',
    properties: {
      term: {
        type: 'string',
        description: 'Term to look up (e.g., "données personnelles", "traitement"). Partial matching supported.',
      },
      document_id: {
        type: 'string',
        description: 'Optional: filter to definitions from a specific statute.',
      },
      limit: {
        type: 'number',
        description: 'Maximum results (default: 10, max: 50).',
        default: 10,
      },
    },
    required: ['term'],
  },
};

/* ------------------------------------------------------------------ */
/*  Build & register                                                   */
/* ------------------------------------------------------------------ */

export function buildTools(
  db?: InstanceType<typeof Database>,
  context?: AboutContext,
): Tool[] {
  const tools = [...TOOLS, LIST_SOURCES_TOOL];

  // Capability-gated tools: only shown when the required DB tables exist
  if (db) {
    const caps = detectCapabilities(db);
    if (caps.has('case_law')) {
      tools.push(SEARCH_CASE_LAW_TOOL);
    }
  }

  // Definitions table may exist even in free tier
  if (db) {
    try {
      db.prepare("SELECT 1 FROM definitions LIMIT 1").get();
      tools.push(GET_DEFINITIONS_TOOL);
    } catch {
      // definitions table doesn't exist
    }
  }

  if (context) {
    tools.push(ABOUT_TOOL);
  }

  return tools;
}

export function registerTools(
  server: Server,
  db: InstanceType<typeof Database>,
  context?: AboutContext,
): void {
  const allTools = buildTools(db, context);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: allTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'search_legislation':
          result = await searchLegislation(db, args as unknown as SearchLegislationInput);
          break;
        case 'get_provision':
          result = await getProvision(db, args as unknown as GetProvisionInput);
          break;
        case 'validate_citation':
          result = await validateCitationTool(db, args as unknown as ValidateCitationInput);
          break;
        case 'build_legal_stance':
          result = await buildLegalStance(db, args as unknown as BuildLegalStanceInput);
          break;
        case 'format_citation':
          result = await formatCitationTool(args as unknown as FormatCitationInput);
          break;
        case 'check_currency':
          result = await checkCurrency(db, args as unknown as CheckCurrencyInput);
          break;
        case 'get_eu_basis':
          result = await getEUBasis(db, args as unknown as GetEUBasisInput);
          break;
        case 'get_belgian_implementations':
          result = await getBelgianImplementations(db, args as unknown as GetBelgianImplementationsInput);
          break;
        case 'search_eu_implementations':
          result = await searchEUImplementations(db, args as unknown as SearchEUImplementationsInput);
          break;
        case 'get_provision_eu_basis':
          result = await getProvisionEUBasis(db, args as unknown as GetProvisionEUBasisInput);
          break;
        case 'validate_eu_compliance':
          result = await validateEUCompliance(db, args as unknown as ValidateEUComplianceInput);
          break;
        case 'list_sources':
          result = await listSources(db);
          break;
        case 'search_case_law': {
          const caps = detectCapabilities(db);
          if (!caps.has('case_law')) {
            return {
              content: [{ type: 'text', text: upgradeMessage('case_law') }],
              isError: true,
            };
          }
          result = await searchCaseLaw(db, args as unknown as SearchCaseLawInput);
          break;
        }
        case 'get_definitions': {
          try {
            db.prepare("SELECT 1 FROM definitions LIMIT 1").get();
          } catch {
            return {
              content: [{ type: 'text', text: 'The definitions table is not available in this database tier.' }],
              isError: true,
            };
          }
          result = await getDefinitions(db, args as unknown as GetDefinitionsInput);
          break;
        }
        case 'about':
          if (context) {
            result = getAbout(db, context);
          } else {
            return {
              content: [{ type: 'text', text: 'About tool not configured.' }],
              isError: true,
            };
          }
          break;
        default:
          return {
            content: [{ type: 'text', text: `Error: Unknown tool "${name}".` }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });
}
