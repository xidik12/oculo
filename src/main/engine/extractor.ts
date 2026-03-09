import { WebContents } from 'electron'

export class DataExtractor {
  async extract(
    webContents: WebContents,
    what: string,
    options?: { scope?: string; fields?: string[]; limit?: number; format?: 'text' | 'json' }
  ): Promise<string> {
    const limit = options?.limit || 10
    const scope = options?.scope || 'body'
    const format = options?.format || 'text'
    const fields = options?.fields || []

    const script = `
      (function() {
        const root = document.querySelector(${JSON.stringify(scope)}) || document.body;
        const limit = ${limit};
        const what = ${JSON.stringify(what.toLowerCase())};
        const fields = ${JSON.stringify(fields)};
        const format = ${JSON.stringify(format)};

        function getText(el) {
          return (el?.textContent?.trim() || '').replace(/\\s+/g, ' ').substring(0, 200);
        }

        // Scored content area finder — excludes nav/header/footer, scores by structure
        function findContentArea() {
          const excludeSelectors = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]';
          const excludeEls = new Set();
          root.querySelectorAll(excludeSelectors).forEach(el => excludeEls.add(el));

          function isExcluded(el) {
            let node = el;
            while (node && node !== root) {
              if (excludeEls.has(node)) return true;
              node = node.parentElement;
            }
            return false;
          }

          const candidates = root.querySelectorAll('ul, ol, table, [class*="list"], [class*="grid"], [class*="results"], [class*="items"], [class*="cards"], main, article, [role="list"], [role="main"], [role="feed"], section');
          let best = null;
          let bestScore = 0;

          candidates.forEach(container => {
            if (isExcluded(container)) return;

            let score = 0;
            const children = container.children;
            if (children.length < 2) return;

            // Repeated children of same tag (core signal)
            const tagCounts = {};
            Array.from(children).forEach(c => {
              const t = c.tagName;
              tagCounts[t] = (tagCounts[t] || 0) + 1;
            });
            const maxRepeated = Math.max(...Object.values(tagCounts));
            score += maxRepeated;

            // Semantic tag bonus
            const tag = container.tagName.toLowerCase();
            if (tag === 'main' || container.getAttribute('role') === 'main') score += 5;
            if (tag === 'table') score += 3;
            if (tag === 'article') score += 2;

            // Class/id keyword match against 'what'
            const whatWords = what.split(/\\s+/);
            const classId = ((container.className || '') + ' ' + (container.id || '')).toLowerCase();
            whatWords.forEach(w => {
              if (w.length > 2 && classId.includes(w)) score += 4;
            });

            if (score > bestScore) {
              bestScore = score;
              best = container;
            }
          });

          return best || root;
        }

        // Extract from table — handles multi-row record tables (e.g. HN's 3-row-per-story)
        function extractTable(table) {
          const headers = [];
          const headerRow = table.querySelector('thead tr, tr:first-child');
          if (headerRow) {
            headerRow.querySelectorAll('th, td').forEach(cell => {
              const t = getText(cell);
              if (t) headers.push(t);
            });
          }

          // Detect header cell count (minimum 2 for valid header)
          const headerCellCount = headers.length >= 2 ? headers.length : 0;
          const allRows = table.querySelectorAll('tbody tr, tr');

          // If we have a good header, use standard extraction
          if (headerCellCount > 0) {
            const rows = [];
            allRows.forEach((row, i) => {
              if (i === 0 && headerCellCount > 0) return;
              if (rows.length >= limit) return;
              const cells = [];
              row.querySelectorAll('td, th').forEach((cell, j) => {
                const header = headers[j] || '';
                cells.push(header ? header + ': ' + getText(cell) : getText(cell));
              });
              if (cells.some(c => c.length > 0)) rows.push(cells.join(' | '));
            });
            return rows;
          }

          // Multi-row record mode: accumulate rows into records
          // A "spacer" row has 0-1 cells or very little text
          const records = [];
          let currentRecord = [];

          allRows.forEach(row => {
            if (records.length >= limit) return;
            const cells = row.querySelectorAll('td, th');
            const cellTexts = Array.from(cells).map(c => getText(c)).filter(t => t.length > 0);
            const totalText = cellTexts.join(' ').trim();

            // Spacer row detection: 0-1 meaningful cells OR very short text
            if (cellTexts.length <= 1 && totalText.length < 5) {
              // Flush current record
              if (currentRecord.length > 0) {
                records.push(currentRecord.join(' | '));
                currentRecord = [];
              }
              return;
            }

            currentRecord.push(totalText);
          });
          // Flush last record
          if (currentRecord.length > 0 && records.length < limit) {
            records.push(currentRecord.join(' | '));
          }
          return records;
        }

        // Extract from list/grid
        function extractList(container) {
          const items = [];
          const children = container.querySelectorAll(':scope > li, :scope > div, :scope > article, :scope > a, :scope > tr');
          const elements = children.length > 0 ? children : container.children;

          Array.from(elements).slice(0, limit).forEach((item, i) => {
            const text = getText(item);
            if (text.length > 5) {
              items.push((i + 1) + '. ' + text.substring(0, 200));
            }
          });
          return items;
        }

        const area = findContentArea();
        let results = [];

        if (area.tagName === 'TABLE') {
          results = extractTable(area);
        } else {
          const table = area.querySelector('table');
          if (table && table.rows.length > 2) {
            results = extractTable(table);
          } else {
            results = extractList(area);
          }
        }

        // Filter by 'what' keywords if it produces results
        if (what && what !== 'data') {
          const whatWords = what.split(/\\s+/).filter(w => w.length > 2);
          if (whatWords.length > 0) {
            const filtered = results.filter(r => {
              const lower = r.toLowerCase();
              return whatWords.some(w => lower.includes(w));
            });
            if (filtered.length > 0) results = filtered;
          }
        }

        // Filter by fields parameter
        if (fields.length > 0 && results.length > 0) {
          const fieldsLower = fields.map(f => f.toLowerCase());
          results = results.map(line => {
            const parts = line.split(' | ');
            const kept = parts.filter(part => {
              const partLower = part.toLowerCase();
              return fieldsLower.some(f => partLower.startsWith(f + ':') || partLower.includes(f));
            });
            return kept.length > 0 ? kept.join(' | ') : line;
          });
        }

        if (results.length === 0) {
          const text = getText(area).substring(0, 1000);
          return text || 'No data found for "' + what + '"';
        }

        // JSON format
        if (format === 'json') {
          const jsonArray = results.map(line => {
            const obj = {};
            const parts = line.split(' | ');
            parts.forEach(part => {
              const colonIdx = part.indexOf(': ');
              if (colonIdx > 0) {
                obj[part.substring(0, colonIdx).trim()] = part.substring(colonIdx + 2).trim();
              } else {
                obj['text'] = (obj['text'] ? obj['text'] + ' ' : '') + part.trim();
              }
            });
            return obj;
          });
          return JSON.stringify(jsonArray);
        }

        const header = results.length + ' results' + (what !== 'data' ? ' for "' + what + '"' : '') + ':';
        return header + '\\n' + results.join('\\n');
      })()
    `

    try {
      return await webContents.executeJavaScript(script)
    } catch (err) {
      return `Extract error: ${(err as Error).message}`
    }
  }
}

/**
 * Build JS code to detect and extract data from HTML tables.
 * Returns structured table data with headers and rows.
 */
export function buildTableExtractionCode(): string {
  return `(function() {
    var tables = document.querySelectorAll('table');
    if (!tables.length) return JSON.stringify({ tables: [] });

    var result = [];
    for (var t = 0; t < Math.min(tables.length, 10); t++) {
      var table = tables[t];
      var headers = [];
      var rows = [];

      // Extract headers from thead or first row
      var ths = table.querySelectorAll('thead th, thead td');
      if (ths.length) {
        for (var h = 0; h < ths.length; h++) {
          headers.push(ths[h].textContent.trim());
        }
      }

      // Extract body rows
      var trs = table.querySelectorAll('tbody tr, tr');
      for (var r = 0; r < Math.min(trs.length, 100); r++) {
        var cells = trs[r].querySelectorAll('td, th');
        if (cells.length === 0) continue;
        // Skip header row if we already got headers
        if (r === 0 && headers.length > 0 && !trs[r].closest('tbody')) continue;
        var row = [];
        for (var c = 0; c < cells.length; c++) {
          row.push(cells[c].textContent.trim().substring(0, 200));
        }
        // If no headers, use first row as headers
        if (headers.length === 0 && r === 0) {
          headers = row;
          continue;
        }
        rows.push(row);
      }

      result.push({ headers: headers, rows: rows, rowCount: rows.length });
    }

    return JSON.stringify({ tables: result });
  })()`
}

/**
 * Build JS code to detect card-like patterns (product listings, search results, etc.)
 */
export function buildCardDetectionCode(): string {
  return `(function() {
    // Detect repeated patterns (cards, list items, product tiles)
    var containers = document.querySelectorAll('[class*="card"], [class*="item"], [class*="result"], [class*="product"], [class*="tile"], [class*="listing"], ul > li, ol > li, [role="listitem"]');

    // Group by parent to find repeated patterns
    var groups = new Map();
    containers.forEach(function(el) {
      var parent = el.parentElement;
      if (!parent) return;
      var key = parent.tagName + '.' + (parent.className || '').split(' ').slice(0, 2).join('.');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
    });

    var cards = [];
    groups.forEach(function(elements, key) {
      if (elements.length < 2) return; // Need at least 2 for a pattern

      for (var i = 0; i < Math.min(elements.length, 20); i++) {
        var el = elements[i];
        var card = {
          title: '',
          description: '',
          link: '',
          image: ''
        };

        // Find title (h1-h6, or first bold/strong element)
        var heading = el.querySelector('h1, h2, h3, h4, h5, h6, strong, b, [class*="title"], [class*="name"]');
        if (heading) card.title = heading.textContent.trim().substring(0, 100);

        // Find description (p tag or text content)
        var desc = el.querySelector('p, [class*="desc"], [class*="summary"], [class*="text"]');
        if (desc) card.description = desc.textContent.trim().substring(0, 200);

        // Find link
        var link = el.querySelector('a[href]');
        if (link) card.link = link.href;

        // Find image
        var img = el.querySelector('img[src]');
        if (img) card.image = img.src;

        if (card.title || card.description) cards.push(card);
      }
    });

    return JSON.stringify({ cards: cards.slice(0, 50), total: cards.length });
  })()`
}

/**
 * Build JS code to extract ARIA landmarks for page structure understanding.
 */
export function buildLandmarkExtractionCode(): string {
  return `(function() {
    var landmarks = [];

    // ARIA landmark roles
    var roles = ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form', 'region'];
    roles.forEach(function(role) {
      var elements = document.querySelectorAll('[role="' + role + '"]');
      elements.forEach(function(el) {
        landmarks.push({
          role: role,
          label: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '',
          childCount: el.children.length
        });
      });
    });

    // Also check semantic HTML5 elements
    var semanticMap = { header: 'banner', nav: 'navigation', main: 'main', aside: 'complementary', footer: 'contentinfo' };
    Object.keys(semanticMap).forEach(function(tag) {
      var elements = document.querySelectorAll(tag);
      elements.forEach(function(el) {
        // Don't duplicate if already has explicit role
        if (el.getAttribute('role')) return;
        landmarks.push({
          role: semanticMap[tag],
          label: el.getAttribute('aria-label') || '',
          childCount: el.children.length,
          implicit: true
        });
      });
    });

    return JSON.stringify({ landmarks: landmarks });
  })()`
}

/**
 * Build JS code to detect pagination patterns.
 */
export function buildPaginationDetectionCode(): string {
  return `(function() {
    var pagination = null;

    // Look for pagination elements
    var navs = document.querySelectorAll('nav[aria-label*="pag"], [class*="paginat"], [class*="pager"], [role="navigation"]');

    for (var i = 0; i < navs.length; i++) {
      var nav = navs[i];
      var links = nav.querySelectorAll('a[href]');
      if (links.length < 2) continue;

      var pages = [];
      var currentPage = null;

      for (var j = 0; j < links.length; j++) {
        var link = links[j];
        var text = link.textContent.trim();
        var isCurrent = link.getAttribute('aria-current') === 'page' || link.classList.contains('active') || link.classList.contains('current');

        if (/^\\d+$/.test(text)) {
          pages.push({ page: parseInt(text), url: link.href, current: isCurrent });
          if (isCurrent) currentPage = parseInt(text);
        } else if (text.toLowerCase().includes('next') || text.includes('\u203a') || text.includes('\u2192')) {
          pages.push({ page: 'next', url: link.href, current: false });
        } else if (text.toLowerCase().includes('prev') || text.includes('\u2039') || text.includes('\u2190')) {
          pages.push({ page: 'prev', url: link.href, current: false });
        }
      }

      if (pages.length > 0) {
        pagination = { currentPage: currentPage, pages: pages };
        break;
      }
    }

    return JSON.stringify({ pagination: pagination });
  })()`
}
