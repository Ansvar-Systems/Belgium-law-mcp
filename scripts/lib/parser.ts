/**
 * Justel HTML parser for Belgian legislation.
 *
 * Parses year index pages and individual law pages using jsdom.
 * Handles the inconsistent legacy HTML formatting across years.
 */

import { JSDOM } from 'jsdom';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LawIndexEntry {
  /** Row number in the year index */
  index: number;
  /** Full title as it appears on the index page */
  title: string;
  /** Promulgation date as YYYY-MM-DD */
  date: string;
  /** Year extracted from date */
  year: number;
  /** Month zero-padded (e.g., '01') */
  month: string;
  /** Day zero-padded (e.g., '12') */
  day: string;
  /** NUMAC identifier */
  numac: string;
  /** Full Justel URL */
  justelUrl: string;
  /** Source ministry/department */
  source: string;
  /** Publication date as DD-MM-YYYY or empty */
  publicationDate: string;
}

export interface ParsedProvision {
  /** Provision reference (e.g., 'art1', 'art1er') */
  provision_ref: string;
  /** Display section number */
  section: string;
  /** Display title (e.g., 'Article 1er', 'Article 2') */
  title: string;
  /** Full text content of the article */
  content: string;
  /** Chapter name if known */
  chapter?: string;
}

export interface ParsedLaw {
  /** Full title from the page */
  title: string;
  /** NUMAC number */
  numac: string;
  /** Entry into force date if found, otherwise null */
  entryIntoForce: string | null;
  /** Source/ministry */
  source: string | null;
  /** Parsed provisions */
  provisions: ParsedProvision[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Belgian month names for date parsing
// ─────────────────────────────────────────────────────────────────────────────

const FRENCH_MONTHS: Record<string, string> = {
  'JANVIER': '01', 'FEVRIER': '02', 'MARS': '03', 'AVRIL': '04',
  'MAI': '05', 'JUIN': '06', 'JUILLET': '07', 'AOUT': '08',
  'SEPTEMBRE': '09', 'OCTOBRE': '10', 'NOVEMBRE': '11', 'DECEMBRE': '12',
};

const DUTCH_MONTHS: Record<string, string> = {
  'JANUARI': '01', 'FEBRUARI': '02', 'MAART': '03', 'APRIL': '04',
  'MEI': '05', 'JUNI': '06', 'JULI': '07', 'AUGUSTUS': '08',
  'SEPTEMBER': '09', 'OKTOBER': '10', 'NOVEMBER': '11', 'DECEMBER': '12',
};

const ALL_MONTHS: Record<string, string> = { ...FRENCH_MONTHS, ...DUTCH_MONTHS };

// ─────────────────────────────────────────────────────────────────────────────
// Year Index Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the year index HTML from Justel.
 *
 * The HTML is legacy table-based layout with this pattern per entry:
 *   <tr><A name=N> </A>
 *   <td>N</td>
 *   <td>DD MONTH YYYY. - Title<br><br>Source: ...</td>
 *   <td><A href=.../justel>Justel</A></td>
 *   </tr>
 */
export function parseYearIndex(html: string, lang: 'fr' | 'nl' = 'fr'): LawIndexEntry[] {
  const entries: LawIndexEntry[] = [];
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Find all Justel links -- they contain the NUMAC and date info
  const allLinks = document.querySelectorAll('a[href]');

  const justelLinks: HTMLAnchorElement[] = [];
  for (const link of allLinks) {
    const href = (link as HTMLAnchorElement).getAttribute('href') || '';
    if (href.includes('/justel') && (href.includes('/eli/loi/') || href.includes('/eli/wet/'))) {
      justelLinks.push(link as HTMLAnchorElement);
    }
  }

  for (const link of justelLinks) {
    try {
      const href = link.getAttribute('href') || '';

      // Extract components from URL: /eli/loi/YYYY/MM/DD/NUMAC/justel
      const urlMatch = href.match(/\/eli\/(?:loi|wet)\/(\d{4})\/(\d{2})\/(\d{2})\/(\d+)\/justel/);
      if (!urlMatch) continue;

      const [, yearStr, month, day, numac] = urlMatch;
      const year = parseInt(yearStr, 10);

      // Navigate up to find the containing table row
      let tr = link.closest('tr');
      if (!tr) {
        let el: Element | null = link;
        while (el && el.tagName !== 'TR') {
          el = el.parentElement;
        }
        tr = el as HTMLTableRowElement | null;
      }

      // Extract title from the preceding <td> cell
      let title = '';
      let source = '';
      let publicationDate = '';

      if (tr) {
        const tds = tr.querySelectorAll('td');
        if (tds.length >= 2) {
          const textCell = tds[1];
          const fullText = textCell.textContent || '';

          // Title is the first line before the publication marker
          const pubMarker = lang === 'fr' ? 'Publi\u00e9 le' : 'Gepubliceerd op';
          const pubIndex = fullText.indexOf(pubMarker);
          if (pubIndex > 0) {
            title = fullText.substring(0, pubIndex).trim();
          } else {
            title = fullText.trim();
          }

          // Clean up title
          title = title.replace(/\s+/g, ' ').replace(/\(\d+\)\s*$/, '').trim();

          // Extract source
          const sourceMarker = lang === 'fr' ? 'Source :' : 'Bron :';
          const sourceIdx = fullText.indexOf(sourceMarker);
          if (sourceIdx >= 0) {
            const afterSource = fullText.substring(sourceIdx + sourceMarker.length).trim();
            // Take until end of line or next section
            const lineEnd = afterSource.indexOf('\n');
            source = (lineEnd > 0 ? afterSource.substring(0, lineEnd) : afterSource).trim();
          }

          // Extract publication date
          const pubDateMatch = fullText.match(/(\d{2}-\d{2}-\d{4})/);
          if (pubDateMatch) {
            publicationDate = pubDateMatch[1];
          }
        }
      } else {
        continue;
      }

      // Skip German translations
      if (title.includes('Traduction allemande') || title.includes('Duitse vertaling')) {
        continue;
      }

      const fullUrl = href.startsWith('http')
        ? href.trim()
        : `http://www.ejustice.just.fgov.be${href}`.trim();

      entries.push({
        index: entries.length + 1,
        title,
        date: `${year}-${month}-${day}`,
        year,
        month,
        day,
        numac,
        justelUrl: fullUrl,
        source,
        publicationDate,
      });
    } catch (_error) {
      console.warn(`  Warning: Failed to parse index entry`);
    }
  }

  return entries;
}

// ─────────────────────────────────────────────────────────────────────────────
// Law Content Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse an individual law page from Justel.
 *
 * The article text is in a div with <h2 id="text">.
 * Articles are delimited by <A NAME='Art.N'> anchors.
 * Text uses <BR> for line breaks and &nbsp; for indentation.
 */
export function parseLawContent(html: string, numac: string): ParsedLaw {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Extract title
  const titleEl = document.querySelector('.list-item--title');
  const title = titleEl
    ? (titleEl.textContent || '').replace(/\s+/g, ' ').trim()
    : '';

  // Extract entry into force date
  let entryIntoForce: string | null = null;
  const plainTexts = document.querySelectorAll('.plain-text');
  for (const el of plainTexts) {
    const text = el.textContent || '';
    const eifMatch = text.match(/Entr[e\u00e9]e en vigueur\s*:\s*(.+?)(?:\n|$)/i)
      || text.match(/Inwerkingtreding\s*:\s*(.+?)(?:\n|$)/i);
    if (eifMatch) {
      entryIntoForce = eifMatch[1].trim();
      break;
    }
  }

  // Extract source
  let source: string | null = null;
  for (const el of plainTexts) {
    const text = el.textContent || '';
    const srcMatch = text.match(/Source\s*:\s*(.+?)(?:\n|$)/i)
      || text.match(/Bron\s*:\s*(.+?)(?:\n|$)/i);
    if (srcMatch) {
      source = srcMatch[1].trim();
      break;
    }
  }

  // Find the text section (id="list-title-3" contains the law text)
  const textSection = document.querySelector('#list-title-3');
  if (!textSection) {
    console.warn(`  Warning: No text section found for ${numac}`);
    return { title, numac, entryIntoForce, source, provisions: [] };
  }

  // Get the raw HTML of the text section
  const textHtml = textSection.innerHTML;

  // Parse articles from the HTML
  const provisions = parseArticles(textHtml);

  return { title, numac, entryIntoForce, source, provisions };
}

/**
 * Parse articles from the text section HTML.
 *
 * Articles are delimited by <A NAME='Art.N'> anchors.
 */
function parseArticles(html: string): ParsedProvision[] {
  const provisions: ParsedProvision[] = [];

  // Split on article anchors: <A NAME='Art.XXX'>
  const articlePattern = /<A\s+NAME='Art\.([^']+)'[^>]*>/gi;
  const matches: Array<{ ref: string; startIndex: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = articlePattern.exec(html)) !== null) {
    matches.push({
      ref: match[1],
      startIndex: match.index,
    });
  }

  if (matches.length === 0) {
    return parseArticlesFallback(html);
  }

  let currentChapter: string | undefined;

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].startIndex : html.length;
    const articleHtml = html.substring(current.startIndex, nextStart);

    // Check for chapter markers before this article
    const chapterBefore = html.substring(
      i > 0 ? matches[i - 1].startIndex : 0,
      current.startIndex
    );
    const chapterMatch = chapterBefore.match(
      /(?:CHAPITRE|HOOFDSTUK)\s+([IVXLCDM\d]+(?:er)?)\.\s*-\s*([^<\n]+)/i
    );
    if (chapterMatch) {
      currentChapter = `${chapterMatch[1]}. ${chapterMatch[2].trim()}`;
    }

    // Also check within the article HTML for inline chapter markers
    const inlineChapterMatch = articleHtml.match(
      /(?:CHAPITRE|HOOFDSTUK)\s+([IVXLCDM\d]+(?:er)?)\.\s*-\s*([^<\n]+)/i
    );
    if (inlineChapterMatch) {
      currentChapter = `${inlineChapterMatch[1]}. ${inlineChapterMatch[2].trim()}`;
    }

    // Extract the article text
    const text = cleanArticleHtml(articleHtml);
    if (!text.trim()) continue;

    // Determine article reference and title
    const ref = current.ref.toLowerCase().replace(/\./g, '');
    const displayRef = current.ref;

    let artTitle: string;
    if (displayRef === '1er' || displayRef === '1ER') {
      artTitle = 'Article 1er';
    } else {
      artTitle = `Article ${displayRef}`;
    }

    const sectionNum = displayRef.replace(/er$/i, '');

    provisions.push({
      provision_ref: `art${ref}`,
      section: sectionNum,
      title: artTitle,
      content: text.trim(),
      chapter: currentChapter,
    });
  }

  return provisions;
}

/**
 * Fallback parser when no <A NAME='Art.N'> anchors are found.
 */
function parseArticlesFallback(html: string): ParsedProvision[] {
  const provisions: ParsedProvision[] = [];
  const cleanText = cleanArticleHtml(html);

  const parts = cleanText.split(/(?=(?:Article|Art\.)\s+\d+)/i);

  for (const part of parts) {
    const artMatch = part.match(/^(?:Article|Art\.)\s+(\d+(?:er)?)/i);
    if (!artMatch) continue;

    const num = artMatch[1];
    const ref = `art${num.toLowerCase()}`;
    const content = part.trim();

    provisions.push({
      provision_ref: ref,
      section: num.replace(/er$/i, ''),
      title: `Article ${num}`,
      content,
    });
  }

  return provisions;
}

/**
 * Clean HTML from an article fragment, producing readable text.
 */
function cleanArticleHtml(html: string): string {
  let text = html;

  // Remove all anchor tags but keep surrounding text
  text = text.replace(/<A[^>]*>/gi, '');
  text = text.replace(/<\/A>/gi, '');

  // Convert <BR> to newlines
  text = text.replace(/<BR\s*\/?>/gi, '\n');

  // Remove heading tags
  text = text.replace(/<\/?h[1-6][^>]*>/gi, '');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&eacute;/g, '\u00e9');
  text = text.replace(/&egrave;/g, '\u00e8');
  text = text.replace(/&agrave;/g, '\u00e0');
  text = text.replace(/&acirc;/g, '\u00e2');
  text = text.replace(/&ecirc;/g, '\u00ea');
  text = text.replace(/&icirc;/g, '\u00ee');
  text = text.replace(/&ocirc;/g, '\u00f4');
  text = text.replace(/&ucirc;/g, '\u00fb');
  text = text.replace(/&ugrave;/g, '\u00f9');
  text = text.replace(/&ccedil;/g, '\u00e7');
  text = text.replace(/&laquo;/g, '\u00ab');
  text = text.replace(/&raquo;/g, '\u00bb');
  text = text.replace(/&#\d+;/g, (m) => {
    const code = parseInt(m.slice(2, -1), 10);
    return String.fromCharCode(code);
  });

  // Collapse multiple spaces
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n');

  // Trim each line
  text = text.split('\n').map(line => line.trim()).filter(Boolean).join('\n');

  return text;
}
