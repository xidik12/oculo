import React from 'react'

const openExternal = (url: string) => {
  ;(window as any).oculo?.openExternal?.(url)
}

const providers = [
  {
    name: 'Claude',
    desc: "Anthropic's AI. Best for reasoning and coding.",
    color: '#D97706',
    bgClass: 'bg-amber-500/10',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
      </svg>
    ),
    steps: [
      'Go to console.anthropic.com',
      'Click API Keys → Create Key',
      'Copy the key (starts with sk-ant-...)',
      'Paste in Oculo Settings > AI Providers',
    ],
    link: 'https://console.anthropic.com',
    linkLabel: 'Get API Key',
  },
  {
    name: 'OpenAI',
    desc: "ChatGPT's creator. Great for conversations.",
    color: '#10B981',
    bgClass: 'bg-emerald-500/10',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500">
        <circle cx="12" cy="12" r="10" /><path d="M12 6v12M6 12h12" />
      </svg>
    ),
    steps: [
      'Go to platform.openai.com',
      'Click API Keys → Create new secret key',
      'Copy the key (starts with sk-...)',
      'Paste in Oculo Settings > AI Providers',
    ],
    link: 'https://platform.openai.com/api-keys',
    linkLabel: 'Get API Key',
  },
  {
    name: 'Gemini',
    desc: "Google's AI. Free tier available.",
    color: '#3B82F6',
    bgClass: 'bg-blue-500/10',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500">
        <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
      </svg>
    ),
    steps: [
      'Go to ai.google.dev',
      'Click "Get API Key"',
      'Copy the key',
      'Paste in Oculo Settings > AI Providers',
    ],
    link: 'https://ai.google.dev',
    linkLabel: 'Get API Key',
  },
  {
    name: 'Grok',
    desc: "xAI's model.",
    color: '#E5E7EB',
    bgClass: 'bg-gray-300/10',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300">
        <path d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    steps: [
      'Go to console.x.ai',
      'Click API Keys → Create',
      'Copy the key',
      'Paste in Oculo Settings > AI Providers',
    ],
    link: 'https://console.x.ai',
    linkLabel: 'Get API Key',
  },
  {
    name: 'OpenClaw',
    desc: 'OpenClaw AI.',
    color: '#A855F7',
    bgClass: 'bg-purple-500/10',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-500">
        <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" /><path d="M8 12l3 3 5-5" />
      </svg>
    ),
    steps: [
      'Get your API key from OpenClaw',
      'Copy the key',
      'Paste in Oculo Settings > AI Providers',
    ],
    link: '',
    linkLabel: '',
  },
  {
    name: 'Ollama',
    desc: 'Run AI on your own computer. Free, no key needed.',
    color: '#6B7280',
    bgClass: 'bg-gray-500/10',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
        <rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6v6H9z" />
      </svg>
    ),
    steps: [
      'Download from ollama.com and install',
      'Open Terminal and run: ollama serve',
      'Then run: ollama pull llama3.1:8b',
      'Select Ollama as your provider in Oculo',
    ],
    link: 'https://ollama.com',
    linkLabel: 'Download Ollama',
  },
]

const mcpTools = [
  {
    name: 'page',
    desc: 'See what\'s on screen — headings, buttons, forms, text.',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
  {
    name: 'act',
    desc: 'Click, navigate, scroll, type, screenshot, upload, download.',
    icon: 'M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122',
  },
  {
    name: 'fill',
    desc: 'Fill forms automatically by matching labels.',
    icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  },
  {
    name: 'read',
    desc: 'Extract lists, tables, and structured data.',
    icon: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  },
  {
    name: 'run',
    desc: 'Chain multiple actions into one pipeline.',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
  {
    name: 'devtools',
    desc: 'Console, inspect elements, evaluate JS, network, DOM.',
    icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
  },
  {
    name: 'media',
    desc: 'Generate images and videos from text prompts.',
    icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
]

const tips = [
  { shortcut: '\u2318 + L', label: 'Focus address bar' },
  { shortcut: '\u2318 + T', label: 'New tab' },
  { shortcut: '\u2318 + Shift + I', label: 'Toggle AI chat' },
  { shortcut: '\u2318 + K', label: 'Command palette' },
  { shortcut: '\u2318 + ,', label: 'Open settings' },
]

export default function GuidePage() {
  return (
    <div className="absolute inset-0 flex justify-center bg-surface-dark-0 overflow-auto">
      <div className="max-w-[620px] w-full px-6 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold text-gray-100 mb-2">Setup Guide</h1>
          <p className="text-sm text-gray-500 max-w-[420px] mx-auto">
            Everything you need to get started with Oculo — from AI providers to browser tools.
          </p>
        </div>

        {/* Section 1: Choose Your AI */}
        <div className="mb-10">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Choose Your AI</h2>
          <div className="space-y-2">
            {providers.map(p => (
              <div key={p.name} className="p-4 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-9 h-9 rounded-lg ${p.bgClass} flex items-center justify-center flex-shrink-0`}>
                    {p.icon}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-200">{p.name}</h3>
                    <p className="text-[11px] text-gray-500">{p.desc}</p>
                  </div>
                </div>
                <ol className="space-y-1.5 ml-1 mb-3">
                  {p.steps.map((step, i) => (
                    <li key={i} className="flex gap-2 text-[11px] text-gray-400">
                      <span className="text-accent font-semibold flex-shrink-0">{i + 1}.</span>
                      {step.includes('ollama serve') || step.includes('ollama pull') ? (
                        <span>{step.split(': ')[0]}: <code className="bg-surface-dark-0 px-1 py-0.5 rounded text-gray-300 font-mono text-[10px]">{step.split(': ')[1]}</code></span>
                      ) : (
                        <span>{step}</span>
                      )}
                    </li>
                  ))}
                </ol>
                {p.link && (
                  <a
                    href={p.link}
                    onClick={(e) => { e.preventDefault(); openExternal(p.link) }}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent hover:text-accent/80 transition-colors"
                  >
                    {p.linkLabel}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Section 2: Browser Tools */}
        <div className="mb-10">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Browser Tools</h2>
          <p className="text-[11px] text-gray-400 mb-4 leading-relaxed">
            Oculo gives your AI 7 tools to control the browser. These work with every provider — Claude, OpenAI, Gemini, Grok, Ollama, and OpenClaw.
          </p>

          {/* Claude Code setup box */}
          <div className="p-4 rounded-lg bg-surface-dark-1 border border-accent/20 mb-4">
            <p className="text-[11px] text-accent font-semibold mb-2">Use with Claude Code (optional)</p>
            <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
              Claude Code in your terminal can control Oculo's browser remotely via an open-source MCP bridge.
              All 7 tools above become available to Claude Code — so it can browse, screenshot, fill forms, and more.
            </p>
            <ol className="space-y-2 mb-3">
              <li className="flex gap-2 text-[11px] text-gray-400">
                <span className="text-accent font-semibold flex-shrink-0">1.</span>
                <span>Make sure Oculo is open and running</span>
              </li>
              <li className="flex gap-2 text-[11px] text-gray-400">
                <span className="text-accent font-semibold flex-shrink-0">2.</span>
                <span>Run this once in your terminal to register:</span>
              </li>
            </ol>
            <code className="block bg-surface-dark-0 px-3 py-2 rounded text-[11px] text-gray-300 font-mono mb-2">
              claude mcp add oculo -- node ~/Desktop/oculo/bin/oculo-mcp.mjs
            </code>
            <ol start={3} className="space-y-2 mb-3">
              <li className="flex gap-2 text-[11px] text-gray-400">
                <span className="text-accent font-semibold flex-shrink-0">3.</span>
                <span>Done! Claude Code now has access to Oculo's browser tools in every session</span>
              </li>
            </ol>
            <p className="text-[10px] text-gray-600">Oculo must be running whenever Claude Code uses these tools. No API keys needed — it connects locally.</p>
          </div>

          {/* 5 tool cards */}
          <div className="space-y-2">
            {mcpTools.map(tool => (
              <div key={tool.name} className="flex items-center gap-3 p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
                <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                    <path d={tool.icon} />
                  </svg>
                </div>
                <div>
                  <span className="text-xs font-semibold text-gray-200">{tool.name}</span>
                  <p className="text-[11px] text-gray-500">{tool.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 3: Media Generation */}
        <div className="mb-10">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Media Generation</h2>
          <p className="text-[11px] text-gray-400 mb-4 leading-relaxed">
            Oculo's AI can generate images and videos from text prompts. Generated files are saved locally and can be uploaded to web pages.
          </p>

          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500">
                  <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
                </svg>
              </div>
              <div>
                <span className="text-xs font-semibold text-gray-200">Gemini (auto)</span>
                <p className="text-[11px] text-gray-500">Reuses your Gemini API key. Free tier available.</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500">
                  <circle cx="12" cy="12" r="10" /><path d="M12 6v12M6 12h12" />
                </svg>
              </div>
              <div>
                <span className="text-xs font-semibold text-gray-200">DALL-E 3 (auto)</span>
                <p className="text-[11px] text-gray-500">Reuses your OpenAI API key for image generation.</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3">
              <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-500">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
              <div>
                <span className="text-xs font-semibold text-gray-200">Stability AI</span>
                <p className="text-[11px] text-gray-500">Stable Diffusion 3. Add key in Settings &gt; Media.</p>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-surface-dark-1 border border-accent/20">
            <p className="text-[11px] text-gray-400 mb-1">Example workflow:</p>
            <p className="text-[11px] text-gray-300 font-mono">"Generate an image of Oculo's logo, then post it on X"</p>
            <p className="text-[10px] text-gray-600 mt-1">The AI will: generate image → screenshot → upload → post.</p>
          </div>
        </div>

        {/* Section 4: Quick Tips */}
        <div className="mb-10">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Quick Tips</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {tips.map(tip => (
              <div key={tip.shortcut} className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-surface-dark-1 border border-surface-dark-3 text-center">
                <kbd className="text-[11px] font-mono font-semibold text-accent bg-surface-dark-0 px-2 py-0.5 rounded">{tip.shortcut}</kbd>
                <span className="text-[10px] text-gray-500">{tip.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
