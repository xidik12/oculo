import React, { useState } from 'react'
import oculoIcon from '../../assets/oculo-icon.png'

export default function ContactPage() {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const handleSendFeedback = () => {
    const mailto = `mailto:oculo.browser@gmail.com?subject=${encodeURIComponent(subject || 'Oculo Feedback')}&body=${encodeURIComponent(body)}`
    ;(window as any).oculo?.openExternal?.(mailto)
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-dark-0 overflow-auto">
      <div className="max-w-[480px] w-full px-6 py-12">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 mb-8 text-center">
          <img src={oculoIcon} alt="Oculo" className="w-14 h-14 rounded-xl" />
          <h1 className="text-2xl font-bold text-gray-100">Contact & Feedback</h1>
          <p className="text-sm text-gray-500 max-w-[360px]">
            Found a bug? Have a feature request? We'd love to hear from you.
          </p>
        </div>

        {/* Contact Cards */}
        <div className="space-y-2 mb-8">
          <a
            href="mailto:oculo.browser@gmail.com"
            onClick={(e) => { e.preventDefault(); (window as any).oculo?.openExternal?.('mailto:oculo.browser@gmail.com') }}
            className="flex items-center gap-3 p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3 hover:border-accent/30 transition-colors group"
          >
            <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-200 group-hover:text-accent transition-colors">Email</div>
              <div className="text-[11px] text-gray-500">oculo.browser@gmail.com</div>
            </div>
          </a>

          <a
            href="https://github.com/xidik12/oculo-mcp-mcp"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { e.preventDefault(); (window as any).oculo?.openExternal?.('https://github.com/xidik12/oculo-mcp-mcp') }}
            className="flex items-center gap-3 p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3 hover:border-accent/30 transition-colors group"
          >
            <div className="w-9 h-9 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-gray-300">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-200 group-hover:text-accent transition-colors">GitHub</div>
              <div className="text-[11px] text-gray-500">xidik12/oculo-mcp</div>
            </div>
          </a>

          <a
            href="https://t.me/oculo_browser"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { e.preventDefault(); (window as any).oculo?.openExternal?.('https://t.me/oculo_browser') }}
            className="flex items-center gap-3 p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3 hover:border-accent/30 transition-colors group"
          >
            <div className="w-9 h-9 rounded-lg bg-[#229ED9]/10 flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-[#229ED9]">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-200 group-hover:text-accent transition-colors">Telegram</div>
              <div className="text-[11px] text-gray-500">@oculo_browser</div>
            </div>
          </a>
        </div>

        {/* Feedback Form */}
        <div className="border-t border-surface-dark-3 pt-6">
          <h2 className="text-sm font-semibold text-gray-200 mb-3">Send Feedback</h2>
          <div className="space-y-3">
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject (e.g. Bug Report, Feature Request)"
              className="w-full h-9 px-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3 text-gray-200 text-xs outline-none focus:border-accent/50 placeholder-gray-600"
            />
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Describe the issue or suggestion..."
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-surface-dark-1 border border-surface-dark-3 text-gray-200 text-xs outline-none focus:border-accent/50 placeholder-gray-600 resize-none"
            />
            <button
              onClick={handleSendFeedback}
              disabled={!body.trim()}
              className="w-full h-9 text-xs font-medium bg-accent/10 text-accent rounded-lg hover:bg-accent/20 disabled:opacity-30 disabled:hover:bg-accent/10 transition-colors"
            >
              Open in Email Client
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
