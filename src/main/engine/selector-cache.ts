import fs from 'fs'
import path from 'path'
import { app } from 'electron'

/**
 * SelectorCache — Stores multiple selectors per element interaction.
 * When an action succeeds on an element, we cache ALL possible selectors
 * with stability scores. On replay, we try the most stable first.
 *
 * This is what makes Stagehand v3 fast — skip AI re-engagement when
 * cached selectors still resolve to the correct element.
 */

/** All possible ways to reference a single element */
export interface SelectorBundle {
  ref?: string           // a11y ref (e.g. "e5") — volatile, changes between snapshots
  cssSelector?: string   // generated CSS path
  xpath?: string         // XPath expression
  textContent?: string   // visible text on the element
  role?: string          // ARIA role
  name?: string          // accessible name
  testId?: string        // data-testid attribute
  ariaLabel?: string     // aria-label attribute
  id?: string            // DOM id
  placeholder?: string   // placeholder attribute
  tagName?: string       // element tag name for context
}

/** A cached selector entry for a specific domain + action pair */
export interface SelectorEntry {
  /** Cache key: domain:action:identifier */
  key: string
  /** The domain this entry is for */
  domain: string
  /** URL pattern (path stripped of query/hash) */
  urlPattern: string
  /** The action that was performed (click, type, fill, etc.) */
  action: string
  /** Human-readable action description (e.g. "click Sign In") */
  actionDesc: string
  /** All known selectors for this element */
  bundle: SelectorBundle
  /** When this entry was created */
  createdAt: number
  /** When this entry was last successfully used */
  lastUsed: number
  /** How many times this selector resolved successfully */
  successCount: number
  /** How many times this selector failed to resolve */
  failCount: number
  /** Consecutive failures — invalidate at 3 */
  consecutiveFailures: number
}

/** Selector type stability scores — higher = more stable across page changes */
const STABILITY_SCORES: Record<string, number> = {
  id: 10,
  testId: 10,
  ariaLabel: 9,
  role: 8,        // role + name combo
  placeholder: 7,
  textContent: 7,
  cssSelector: 5,
  xpath: 4,
  ref: 2          // volatile — changes between page loads
}

/** Max entries in cache before LRU eviction */
const MAX_ENTRIES = 10_000

/** Max consecutive failures before invalidation */
const MAX_CONSECUTIVE_FAILURES = 3

export class SelectorCache {
  private entries: Map<string, SelectorEntry> = new Map()
  private filePath: string
  private dirty = false
  private saveTimer: NodeJS.Timeout | null = null

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'oculo-data', 'selector-cache.json')
    this.load()
  }

  /** Load cache from disk */
  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
        if (Array.isArray(data)) {
          for (const entry of data) {
            this.entries.set(entry.key, entry)
          }
        }
        console.log(`[SelectorCache] Loaded ${this.entries.size} entries`)
      }
    } catch {
      this.entries = new Map()
    }
  }

  /** Save cache to disk (debounced) */
  private scheduleSave(): void {
    this.dirty = true
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      if (!this.dirty) return
      this.dirty = false
      try {
        const dir = path.dirname(this.filePath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        const arr = Array.from(this.entries.values())
        fs.writeFileSync(this.filePath, JSON.stringify(arr))
      } catch (err) {
        console.error('[SelectorCache] Save error:', err)
      }
    }, 2000)
  }

  /** Generate a cache key from domain + action + identifier */
  private makeKey(domain: string, action: string, identifier: string): string {
    return `${domain}:${action}:${identifier}`
  }

  /** Extract a stable identifier from the bundle for keying */
  private getIdentifier(bundle: SelectorBundle, actionDesc?: string): string {
    // Use the most stable identifiers for the key
    if (bundle.id) return `id:${bundle.id}`
    if (bundle.testId) return `tid:${bundle.testId}`
    if (bundle.ariaLabel) return `aria:${bundle.ariaLabel}`
    if (bundle.role && bundle.name) return `role:${bundle.role}:${bundle.name}`
    if (bundle.placeholder) return `ph:${bundle.placeholder}`
    if (bundle.textContent) return `text:${bundle.textContent.substring(0, 60)}`
    if (actionDesc) return `desc:${actionDesc.substring(0, 60)}`
    if (bundle.cssSelector) return `css:${bundle.cssSelector.substring(0, 80)}`
    return `unknown:${Date.now()}`
  }

  /** Get stability score for a selector type */
  score(type: keyof typeof STABILITY_SCORES): number {
    return STABILITY_SCORES[type] || 0
  }

  /**
   * Record a successful element interaction.
   * Called after act/fill succeeds — caches all selectors for the element.
   */
  record(domain: string, urlPattern: string, action: string, actionDesc: string, bundle: SelectorBundle): void {
    const identifier = this.getIdentifier(bundle, actionDesc)
    const key = this.makeKey(domain, action, identifier)

    const existing = this.entries.get(key)
    if (existing) {
      // Update existing entry — merge selectors, bump counts
      existing.bundle = { ...existing.bundle, ...bundle }
      existing.successCount++
      existing.consecutiveFailures = 0
      existing.lastUsed = Date.now()
      existing.urlPattern = urlPattern
    } else {
      // New entry
      const entry: SelectorEntry = {
        key,
        domain,
        urlPattern,
        action,
        actionDesc,
        bundle,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        successCount: 1,
        failCount: 0,
        consecutiveFailures: 0
      }
      this.entries.set(key, entry)
    }

    // LRU eviction if over limit
    if (this.entries.size > MAX_ENTRIES) {
      this.evict()
    }

    this.scheduleSave()
  }

  /**
   * Find cached selectors for a domain + action.
   * Returns matching entries sorted by stability score (highest first).
   */
  resolve(domain: string, action: string, hints?: { text?: string; role?: string; name?: string; label?: string; placeholder?: string; selector?: string; ariaLabel?: string }): SelectorEntry[] {
    const matches: SelectorEntry[] = []

    for (const entry of this.entries.values()) {
      if (entry.domain !== domain) continue
      if (entry.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) continue

      // Match by action type
      const actionMatch = entry.action === action

      // Match by hints (fuzzy)
      let hintMatch = false
      if (hints) {
        const b = entry.bundle
        if (hints.text && b.textContent && this.fuzzyMatch(hints.text, b.textContent)) hintMatch = true
        if (hints.label && b.ariaLabel && this.fuzzyMatch(hints.label, b.ariaLabel)) hintMatch = true
        if (hints.placeholder && b.placeholder && this.fuzzyMatch(hints.placeholder, b.placeholder)) hintMatch = true
        if (hints.role && b.role && hints.role === b.role) {
          if (!hints.name || (b.name && this.fuzzyMatch(hints.name, b.name))) hintMatch = true
        }
        if (hints.selector && b.cssSelector && hints.selector === b.cssSelector) hintMatch = true
        if (hints.ariaLabel && b.ariaLabel && this.fuzzyMatch(hints.ariaLabel, b.ariaLabel)) hintMatch = true
      }

      if (actionMatch && hintMatch) {
        matches.push(entry)
      }
    }

    // Sort by best stability score of their selectors, then by success count
    matches.sort((a, b) => {
      const scoreA = this.bestScore(a.bundle)
      const scoreB = this.bestScore(b.bundle)
      if (scoreB !== scoreA) return scoreB - scoreA
      return b.successCount - a.successCount
    })

    return matches
  }

  /**
   * Build a JavaScript snippet that tries cached selectors in stability order.
   * Returns the CSS selector of the first element that resolves, or null.
   * Runs entirely in-page — zero AI tokens.
   */
  buildResolutionScript(entry: SelectorEntry): string {
    const b = entry.bundle
    const attempts: { type: string; script: string }[] = []

    // Order by stability score (highest first)
    if (b.id) {
      attempts.push({ type: 'id', script: `document.getElementById(${JSON.stringify(b.id)})` })
    }
    if (b.testId) {
      attempts.push({ type: 'testId', script: `document.querySelector('[data-testid=${JSON.stringify(b.testId)}]')` })
    }
    if (b.ariaLabel) {
      attempts.push({ type: 'ariaLabel', script: `document.querySelector('[aria-label=${JSON.stringify(b.ariaLabel)}]')` })
    }
    if (b.role && b.name) {
      const roleSelectors: Record<string, string> = {
        button: 'button, [role="button"]',
        link: 'a, [role="link"]',
        textbox: 'input:not([type="hidden"]), textarea, [role="textbox"]',
        checkbox: 'input[type="checkbox"], [role="checkbox"]',
        combobox: 'select, [role="combobox"]'
      }
      const sel = roleSelectors[b.role] || `[role="${b.role}"]`
      attempts.push({
        type: 'role',
        script: `(function(){var els=document.querySelectorAll(${JSON.stringify(sel)});for(var i=0;i<els.length;i++){var t=(els[i].textContent||'').trim().toLowerCase();if(t.includes(${JSON.stringify(b.name.toLowerCase())}))return els[i]}return null})()`
      })
    }
    if (b.placeholder) {
      attempts.push({
        type: 'placeholder',
        script: `document.querySelector('[placeholder=${JSON.stringify(b.placeholder)}]')`
      })
    }
    if (b.textContent) {
      const text = b.textContent.substring(0, 80).toLowerCase()
      attempts.push({
        type: 'textContent',
        script: `(function(){var els=document.querySelectorAll('button,a,[role="button"],[role="link"],label,span,h1,h2,h3,h4,h5,h6,p,div,li');for(var i=0;i<els.length;i++){var s=getComputedStyle(els[i]);if(s.display==='none'||s.visibility==='hidden')continue;var t=(els[i].textContent||'').trim().toLowerCase();if(t===${JSON.stringify(text)}||t.includes(${JSON.stringify(text)}))return els[i]}return null})()`
      })
    }
    if (b.cssSelector) {
      attempts.push({ type: 'cssSelector', script: `document.querySelector(${JSON.stringify(b.cssSelector)})` })
    }

    // Generate combined script that tries each and returns the first hit
    const expectedText = b.textContent || ''
    const tryBlocks = attempts.map((a, i) => {
      const textCheck = expectedText
        ? `if(e${i}){var expectedText=${JSON.stringify(expectedText)};if(expectedText&&e${i}.textContent&&!e${i}.textContent.includes(expectedText)){e${i}=null}}`
        : ''
      return `try{var e${i}=${a.script};${textCheck}if(e${i}&&e${i}.offsetParent!==null){return{found:true,selector:getUniqueSelector(e${i}),type:${JSON.stringify(a.type)}}}}catch(ex){}`
    }).join('\n')

    return `(function(){
      function getUniqueSelector(el){
        if(el.id)return'#'+CSS.escape(el.id);
        var path=[];var c=el;
        while(c&&c!==document.body){
          var s=c.tagName.toLowerCase();
          if(c.id){path.unshift('#'+CSS.escape(c.id));break}
          var p=c.parentElement;
          if(p){var sibs=Array.from(p.children).filter(function(x){return x.tagName===c.tagName});
          if(sibs.length>1)s+=':nth-of-type('+(sibs.indexOf(c)+1)+')'}
          path.unshift(s);c=c.parentElement
        }
        return path.join(' > ')
      }
      ${tryBlocks}
      return{found:false}
    })()`
  }

  /**
   * Mark a cached entry as failed (selector didn't resolve).
   * After MAX_CONSECUTIVE_FAILURES, the entry is effectively invalidated.
   */
  markFailed(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.failCount++
    entry.consecutiveFailures++
    if (entry.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.log(`[SelectorCache] Invalidated: ${key} (${entry.consecutiveFailures} consecutive failures)`)
    }
    this.scheduleSave()
  }

  /** Mark a cached entry as successfully resolved */
  markSuccess(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.successCount++
    entry.consecutiveFailures = 0
    entry.lastUsed = Date.now()
    this.scheduleSave()
  }

  /** Get cache statistics */
  stats(): { total: number; active: number; invalidated: number; hitRate: string } {
    let active = 0
    let invalidated = 0
    let totalSuccess = 0
    let totalFail = 0
    for (const entry of this.entries.values()) {
      if (entry.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        invalidated++
      } else {
        active++
      }
      totalSuccess += entry.successCount
      totalFail += entry.failCount
    }
    const total = totalSuccess + totalFail
    const hitRate = total > 0 ? `${((totalSuccess / total) * 100).toFixed(1)}%` : 'N/A'
    return { total: this.entries.size, active, invalidated, hitRate }
  }

  /** Fuzzy text comparison */
  private fuzzyMatch(a: string, b: string): boolean {
    const la = a.toLowerCase().trim()
    const lb = b.toLowerCase().trim()
    if (la === lb) return true
    if (la.includes(lb) || lb.includes(la)) return true
    // Token overlap
    const ta = la.split(/[\s\-_/]+/).filter(t => t.length > 2)
    const tb = lb.split(/[\s\-_/]+/).filter(t => t.length > 2)
    if (!ta.length || !tb.length) return false
    let m = 0
    for (const a of ta) {
      for (const b of tb) {
        if (a === b) m++
      }
    }
    return m >= Math.min(ta.length, tb.length) * 0.5
  }

  /** Get the highest stability score from a bundle */
  private bestScore(bundle: SelectorBundle): number {
    let best = 0
    if (bundle.id) best = Math.max(best, STABILITY_SCORES.id)
    if (bundle.testId) best = Math.max(best, STABILITY_SCORES.testId)
    if (bundle.ariaLabel) best = Math.max(best, STABILITY_SCORES.ariaLabel)
    if (bundle.role) best = Math.max(best, STABILITY_SCORES.role)
    if (bundle.placeholder) best = Math.max(best, STABILITY_SCORES.placeholder)
    if (bundle.textContent) best = Math.max(best, STABILITY_SCORES.textContent)
    if (bundle.cssSelector) best = Math.max(best, STABILITY_SCORES.cssSelector)
    if (bundle.xpath) best = Math.max(best, STABILITY_SCORES.xpath)
    if (bundle.ref) best = Math.max(best, STABILITY_SCORES.ref)
    return best
  }

  /** Remove entries that have been invalidated (too many consecutive failures) */
  private prune(): void {
    for (const [key, entry] of this.entries) {
      if (entry.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.entries.delete(key)
      }
    }
  }

  /** LRU eviction — remove oldest entries by lastUsed until under limit */
  private evict(): void {
    this.prune() // Clean invalidated first
    if (this.entries.size <= MAX_ENTRIES) return // Pruning was enough
    const sorted = Array.from(this.entries.entries())
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    const toRemove = sorted.length - MAX_ENTRIES
    for (let i = 0; i < toRemove; i++) {
      this.entries.delete(sorted[i][0])
    }
    console.log(`[SelectorCache] Evicted ${toRemove} entries (${this.entries.size} remaining)`)
  }

  /** Force save (for shutdown) */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.dirty) {
      this.dirty = false
      try {
        const dir = path.dirname(this.filePath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(this.filePath, JSON.stringify(Array.from(this.entries.values())))
      } catch (err) {
        console.error('[SelectorCache] Flush error:', err)
      }
    }
  }
}
