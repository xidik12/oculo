import React from 'react'
import oculoIcon from '../../assets/oculo-icon.png'

export default function AboutPage() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-dark-0 overflow-auto">
      <div className="max-w-[560px] w-full px-6 py-12 text-center">
        {/* Logo + Name */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={oculoIcon} alt="Oculo" className="w-20 h-20 rounded-2xl shadow-lg" />
          <h1 className="text-3xl font-bold text-gray-100 tracking-tight">Oculo</h1>
          <p className="text-sm text-gray-500">AI-Powered Native Browser</p>
          <span className="text-xs text-gray-600 font-mono bg-surface-dark-1 px-2 py-0.5 rounded">v0.1.0</span>
        </div>

        {/* Tagline */}
        <p className="text-sm text-gray-400 leading-relaxed mb-10 max-w-[420px] mx-auto">
          Oculo gives AI the ability to see, understand, and interact with web pages natively.
          Built for the era where browsers and AI are one.
        </p>

        {/* 5 MCP Tools */}
        <div className="mb-10">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">5 Tools. Infinite Possibilities.</h2>
          <div className="grid grid-cols-5 gap-2">
            {[
              { name: 'page', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', desc: 'See' },
              { name: 'act', icon: 'M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122', desc: 'Do' },
              { name: 'fill', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', desc: 'Fill' },
              { name: 'read', icon: 'M4 6h16M4 10h16M4 14h16M4 18h16', desc: 'Extract' },
              { name: 'run', icon: 'M13 10V3L4 14h7v7l9-11h-7z', desc: 'Pipeline' },
            ].map(tool => (
              <div key={tool.name} className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                  <path d={tool.icon} />
                </svg>
                <span className="text-[11px] font-semibold text-gray-300">{tool.name}</span>
                <span className="text-[9px] text-gray-600">{tool.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Differentiators */}
        <div className="mb-10 space-y-3 text-left">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 text-center">What Makes Oculo Different</h2>
          {[
            { title: 'Native Browser, Not an Extension', desc: 'Full Electron browser with direct webview control — no DOM injection hacks.' },
            { title: 'MCP-First Architecture', desc: 'Claude Code connects via Model Context Protocol. 5 tools, under 300 tokens per flow.' },
            { title: 'Multi-Provider AI', desc: 'Claude, OpenAI, Gemini, Grok, OpenClaw, Ollama — switch in one click.' },
            { title: 'Security by Design', desc: 'Permission gates, credential vault, PII redaction, anti-injection boundaries.' },
          ].map(item => (
            <div key={item.title} className="flex gap-3 p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
              <div className="w-1 rounded-full bg-accent/40 flex-shrink-0" />
              <div>
                <h3 className="text-xs font-semibold text-gray-200 mb-0.5">{item.title}</h3>
                <p className="text-[11px] text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Credits */}
        <div className="border-t border-surface-dark-3 pt-6">
          <p className="text-[11px] text-gray-600 mb-1">
            Built by <span className="text-gray-400">Salakhitdinov Khidayotullo</span>
          </p>
          <p className="text-[10px] text-gray-700">
            Electron {'\u00B7'} React {'\u00B7'} TypeScript {'\u00B7'} Tailwind CSS
          </p>
        </div>
      </div>
    </div>
  )
}
