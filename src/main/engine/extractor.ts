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

    const script = `
      (function() {
        const root = document.querySelector(${JSON.stringify(scope)}) || document.body;
        const limit = ${limit};
        const what = ${JSON.stringify(what.toLowerCase())};
        
        function getText(el) {
          return (el?.textContent?.trim() || '').replace(/\\s+/g, ' ').substring(0, 200);
        }

        // Try to find the main content area that matches "what"
        function findContentArea() {
          // Look for common list/grid containers
          const candidates = root.querySelectorAll('ul, ol, table, [class*="list"], [class*="grid"], [class*="results"], [class*="items"], [class*="cards"], main, article, [role="list"], [role="main"]');
          // Find the one with the most repeated children
          let best = null;
          let bestCount = 0;
          candidates.forEach(container => {
            const children = container.children;
            if (children.length > bestCount && children.length > 1) {
              bestCount = children.length;
              best = container;
            }
          });
          return best || root;
        }

        // Extract from table
        function extractTable(table) {
          const headers = [];
          const headerRow = table.querySelector('thead tr, tr:first-child');
          if (headerRow) {
            headerRow.querySelectorAll('th, td').forEach(cell => {
              headers.push(getText(cell));
            });
          }
          
          const rows = [];
          const bodyRows = table.querySelectorAll('tbody tr, tr');
          bodyRows.forEach((row, i) => {
            if (i === 0 && headers.length > 0) return; // skip header row
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
          // Check if area contains a table
          const table = area.querySelector('table');
          if (table && table.rows.length > 2) {
            results = extractTable(table);
          } else {
            results = extractList(area);
          }
        }

        if (results.length === 0) {
          // Fallback: just get main text content
          const text = getText(area).substring(0, 500);
          return text || 'No data found for "' + what + '"';
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
