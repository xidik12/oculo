import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { Card } from '../../shared/types'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const CARDS_FILE = join(DATA_DIR, 'cards.json')

const DEFAULT_CARDS: Omit<Card, 'id' | 'createdAt'>[] = [
  {
    name: 'Shopping Assistant',
    icon: '🛍️',
    systemInstruction: 'You are a shopping assistant. Compare prices, find deals, check reviews, and help the user make informed purchasing decisions. Always check multiple sources before recommending.',
    triggerDomains: ['amazon.com', 'ebay.com', 'walmart.com', 'bestbuy.com'],
    isActive: false
  },
  {
    name: 'Research Mode',
    icon: '🔬',
    systemInstruction: 'You are in deep research mode. Extract key findings, cite sources, cross-reference claims, and build a comprehensive understanding of the topic. Summarize findings in structured format.',
    isActive: false
  },
  {
    name: 'Code Reviewer',
    icon: '👨‍💻',
    systemInstruction: 'You are a code reviewer. Analyze code for bugs, security issues, performance problems, and style. Suggest improvements with concrete examples. Focus on correctness first, then readability.',
    triggerDomains: ['github.com', 'gitlab.com', 'bitbucket.org'],
    isActive: false
  },
  {
    name: 'Translation Helper',
    icon: '🌐',
    systemInstruction: 'You are a translation assistant. When the user encounters foreign language content, translate it naturally. Preserve nuance and cultural context. Offer alternatives for ambiguous phrases.',
    isActive: false
  }
]

export class CardStore {
  private cards: Card[] = []

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      if (existsSync(CARDS_FILE)) {
        const data = readFileSync(CARDS_FILE, 'utf-8')
        this.cards = JSON.parse(data)
      } else {
        // Initialize with default cards
        this.cards = DEFAULT_CARDS.map(c => ({
          ...c,
          id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now()
        }))
        this.save()
      }
    } catch {
      this.cards = []
    }
  }

  private save(): void {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      writeFileSync(CARDS_FILE, JSON.stringify(this.cards, null, 2))
    } catch (err) {
      console.error('Failed to save cards:', err)
    }
  }

  list(): Card[] {
    return [...this.cards]
  }

  create(name: string, icon: string, systemInstruction: string, triggerDomains?: string[]): Card {
    const card: Card = {
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      icon,
      systemInstruction,
      triggerDomains,
      isActive: false,
      createdAt: Date.now()
    }
    this.cards.push(card)
    this.save()
    return card
  }

  update(id: string, updates: Partial<Omit<Card, 'id' | 'createdAt'>>): Card | null {
    const idx = this.cards.findIndex(c => c.id === id)
    if (idx === -1) return null
    this.cards[idx] = { ...this.cards[idx], ...updates }
    this.save()
    return this.cards[idx]
  }

  delete(id: string): boolean {
    const len = this.cards.length
    this.cards = this.cards.filter(c => c.id !== id)
    if (this.cards.length !== len) {
      this.save()
      return true
    }
    return false
  }

  activate(id: string): Card | null {
    const card = this.cards.find(c => c.id === id)
    if (!card) return null
    card.isActive = !card.isActive
    this.save()
    return card
  }

  getActive(): Card[] {
    return this.cards.filter(c => c.isActive)
  }

  getForDomain(domain: string): Card[] {
    return this.cards.filter(c =>
      c.triggerDomains?.some(d => domain.includes(d))
    )
  }

  /** Format active cards for inclusion in AI system prompt */
  toPromptSection(currentDomain?: string): string {
    const active = this.getActive()
    const domainCards = currentDomain ? this.getForDomain(currentDomain) : []
    const all = [...new Map([...active, ...domainCards].map(c => [c.id, c])).values()]
    if (all.length === 0) return ''
    const instructions = all.map(c => `[${c.icon} ${c.name}]: ${c.systemInstruction}`).join('\n')
    return '\n\nACTIVE AI CARDS:\n' + instructions
  }
}
