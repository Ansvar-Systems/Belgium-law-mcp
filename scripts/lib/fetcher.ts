/**
 * Justel HTML fetcher for Belgian legislation.
 *
 * Fetches year indices and individual law pages from ejustice.just.fgov.be.
 * Includes rate limiting and retry logic.
 */

const BASE_URL = 'http://www.ejustice.just.fgov.be';
const USER_AGENT = 'BelgianLawMCP/1.0 (legal-research; contact: hello@ansvar.ai)';
const RATE_LIMIT_MS = 500;

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<string> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'fr-BE,fr;q=0.9,nl-BE;q=0.8,nl;q=0.7',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      // Justel uses ISO-8859-1 encoding
      const buffer = await response.arrayBuffer();
      const decoder = new TextDecoder('iso-8859-1');
      return decoder.decode(buffer);
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      const backoff = attempt * 1000;
      console.warn(`  Retry ${attempt}/${maxRetries} for ${url} (waiting ${backoff}ms)`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error(`Failed to fetch ${url}`);
}

/**
 * Fetch the year index page listing all laws for a given year.
 * @param year - The year to fetch
 * @param lang - 'fr' for French (loi), 'nl' for Dutch (wet)
 */
export async function fetchYearIndex(year: number, lang: 'fr' | 'nl' = 'fr'): Promise<string> {
  const pathSegment = lang === 'fr' ? 'loi' : 'wet';
  const url = `${BASE_URL}/eli/${pathSegment}/${year}`;
  console.log(`  Fetching ${lang.toUpperCase()} index for ${year}: ${url}`);
  return rateLimitedFetch(url);
}

/**
 * Fetch an individual law's consolidated text from Justel.
 * @param year - Promulgation year
 * @param month - Promulgation month (zero-padded string, e.g., '01')
 * @param day - Promulgation day (zero-padded string, e.g., '12')
 * @param numac - NUMAC identifier
 * @param lang - 'fr' for French (loi), 'nl' for Dutch (wet)
 */
export async function fetchLawContent(
  year: number,
  month: string,
  day: string,
  numac: string,
  lang: 'fr' | 'nl' = 'fr'
): Promise<string> {
  const pathSegment = lang === 'fr' ? 'loi' : 'wet';
  const url = `${BASE_URL}/eli/${pathSegment}/${year}/${month}/${day}/${numac}/justel`;
  console.log(`  Fetching ${lang.toUpperCase()} law: ${url}`);
  return rateLimitedFetch(url);
}

/**
 * Build the Justel URL for a law.
 */
export function buildJustelUrl(
  year: number,
  month: string,
  day: string,
  numac: string,
  lang: 'fr' | 'nl' = 'fr'
): string {
  const pathSegment = lang === 'fr' ? 'loi' : 'wet';
  return `${BASE_URL}/eli/${pathSegment}/${year}/${month}/${day}/${numac}/justel`;
}
