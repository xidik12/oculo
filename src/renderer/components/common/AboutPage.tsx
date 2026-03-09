import oculoIcon from '../../assets/oculo-icon.png'

export default function AboutPage() {
  const version = '0.4.0'

  return (
    <div className="absolute inset-0 flex flex-col bg-surface-dark-0 overflow-y-auto">
      <div className="max-w-[560px] w-full px-6 py-12 text-center m-auto">
        {/* Logo + Name */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={oculoIcon} alt="Oculo" className="w-20 h-20 rounded-2xl shadow-lg" />
          <h1 className="text-3xl font-bold text-gray-100 tracking-tight">Oculo</h1>
          <p className="text-sm text-gray-500">AI-Powered Native Browser</p>
          <span className="text-xs text-gray-600 font-mono bg-surface-dark-1 px-2 py-0.5 rounded">v{version}</span>
        </div>

        {/* Tagline */}
        <p className="text-sm text-gray-400 leading-relaxed mb-10 max-w-[420px] mx-auto">
          Oculo gives AI the ability to see, understand, and interact with web pages natively.
          Built for the era where browsers and AI are one.
        </p>

        {/* MCP Tools */}
        <div className="mb-10">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">12 Tools. Infinite Possibilities.</h2>
          <div className="grid grid-cols-4 gap-2">
            {[
              { name: 'page', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', desc: 'See' },
              { name: 'act', icon: 'M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122', desc: 'Do' },
              { name: 'fill', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', desc: 'Fill' },
              { name: 'read', icon: 'M4 6h16M4 10h16M4 14h16M4 18h16', desc: 'Extract' },
              { name: 'run', icon: 'M13 10V3L4 14h7v7l9-11h-7z', desc: 'Pipeline' },
              { name: 'media', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z', desc: 'Generate' },
              { name: 'shell', icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', desc: 'Execute' },
              { name: 'tabs', icon: 'M4 6h16M4 12h16m-7 6h7', desc: 'Manage' },
              { name: 'research', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', desc: 'Research' },
              { name: 'preview', icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0zm-3-9C6.48 3 2 8.03 2 12s4.48 9 10 9 10-4.03 10-9-4.48-9-10-9z', desc: 'Preview' },
              { name: 'translate', icon: 'M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129', desc: 'Translate' },
              { name: 'lens', icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z', desc: 'Vision' },
            ].map(tool => (
              <div key={tool.name} className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                  <path d={tool.icon} />
                </svg>
                <span className="text-[10px] font-semibold text-gray-300">{tool.name}</span>
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
            { title: 'MCP-First Architecture', desc: 'Claude Code connects via Model Context Protocol. 12 tools, under 300 tokens per flow.' },
            { title: 'Self-Healing Automation', desc: 'Selector caching + DOM diffing — skips AI re-engagement when pages haven\'t changed.' },
            { title: 'Multi-Provider AI', desc: 'Claude, OpenAI, Gemini, Grok, OpenClaw, Ollama — switch in one click.' },
            { title: 'Security by Design', desc: '4-level permission gates, OS keychain vault, PII redaction, anti-injection boundaries.' },
            { title: 'Advanced Stealth', desc: 'Canvas, WebRTC, audio, font, battery, and screen fingerprint evasion built-in.' },
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
          <p className="text-[10px] text-gray-700 mb-2">
            Electron {'\u00B7'} React {'\u00B7'} TypeScript {'\u00B7'} Tailwind CSS
          </p>
          <p className="text-[10px] text-gray-700">
            Open Source {'\u00B7'} MIT License {'\u00B7'} <a href="https://getoculo.com" className="text-accent/60 hover:text-accent transition-colors">getoculo.com</a>
          </p>
        </div>
      </div>
    </div>
  )
}
