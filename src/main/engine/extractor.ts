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
