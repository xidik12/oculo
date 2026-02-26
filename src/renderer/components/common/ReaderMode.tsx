import React, { useState, useEffect } from 'react'

interface ReaderModeProps {
  isOpen: boolean
  onClose: () => void
  activeTabId: string
}

interface ReaderContent {
  title: string
  content: string
  siteName?: string
  author?: string
}

export default function ReaderMode({ isOpen, onClose, activeTabId }: ReaderModeProps) {
  const [article, setArticle] = useState<ReaderContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [fontSize, setFontSize] = useState(18)

  useEffect(() => {
    if (!isOpen) { setArticle(null); return }
    extractContent()
  }, [isOpen, activeTabId])

  async function extractContent() {
    setLoading(true)
    try {
      const api = (window as any).oculo
      if (!api?.executeInWebview) { setLoading(false); return }

      // Readability-lite extraction via webview JS execution
      const result = await api.executeInWebview(activeTabId, `
        (function() {
          // Clone body to avoid modifying the page
          const clone = document.cloneNode(true);
          const body = clone.querySelector('body');
          if (!body) return null;

          // Remove scripts, styles, nav, footer, ads
          const remove = 'script, style, nav, footer, header, aside, .ad, .ads, .advertisement, [role="banner"], [role="navigation"], [role="complementary"], iframe, .sidebar, .menu, .nav';
          body.querySelectorAll(remove).forEach(el => el.remove());

          // Find the main content area
          const article = body.querySelector('article, [role="main"], main, .post-content, .article-content, .entry-content');
          const contentEl = article || body;

          // Get paragraphs
          const paragraphs = [];
          contentEl.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre').forEach(el => {
            const text = el.textContent.trim();
            if (text.length > 20) {
              const tag = el.tagName.toLowerCase();
              if (tag.startsWith('h')) {
                paragraphs.push('<h' + tag[1] + '>' + el.textContent.trim() + '</h' + tag[1] + '>');
              } else if (tag === 'pre') {
                paragraphs.push('<pre>' + el.textContent + '</pre>');
              } else if (tag === 'blockquote') {
                paragraphs.push('<blockquote>' + el.textContent.trim() + '</blockquote>');
              } else {
                paragraphs.push('<p>' + el.textContent.trim() + '</p>');
              }
            }
          });

          return {
            title: document.title,
            content: paragraphs.join('\\n'),
            siteName: document.querySelector('meta[property="og:site_name"]')?.content || '',
            author: document.querySelector('meta[name="author"]')?.content || ''
          };
        })()
      `)

      if (result && result.content) {
        setArticle(result)
      } else {
        setArticle({ title: 'Could not extract content', content: '<p>This page does not have extractable article content.</p>' })
      }
    } catch {
      setArticle({ title: 'Error', content: '<p>Failed to extract page content.</p>' })
    }
    setLoading(false)
  }

  if (!isOpen) return null

  return (
    <div className="absolute inset-0 z-20 bg-surface-0 dark:bg-[#1c1c1e] overflow-y-auto">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 h-[40px] bg-surface-0/90 dark:bg-[#1c1c1e]/90 backdrop-blur-sm border-b border-surface-3 dark:border-surface-dark-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setFontSize(f => Math.max(14, f - 2))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-500 text-xs font-bold">A-</button>
          <span className="text-[10px] text-gray-400 tabular-nums w-6 text-center">{fontSize}</span>
          <button onClick={() => setFontSize(f => Math.min(28, f + 2))} className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-gray-500 text-sm font-bold">A+</button>
        </div>
        <button onClick={onClose} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-surface-3 dark:hover:bg-surface-dark-3 text-xs text-gray-500 transition-colors">
          Exit Reader
          <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1L1 7" /></svg>
        </button>
      </div>

      {/* Content */}
      <div className="max-w-[680px] mx-auto px-6 py-10">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : article ? (
          <>
            {article.siteName && <p className="text-xs text-accent font-medium mb-2">{article.siteName}</p>}
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2 leading-tight">{article.title}</h1>
            {article.author && <p className="text-sm text-gray-500 mb-6">By {article.author}</p>}
            <div
              className="prose prose-sm dark:prose-invert max-w-none text-gray-800 dark:text-gray-200 leading-relaxed"
              style={{ fontSize: `${fontSize}px`, lineHeight: 1.75 }}
              dangerouslySetInnerHTML={{ __html: article.content }}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}
