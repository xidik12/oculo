import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import crypto from 'crypto'

export interface CachedWorkflow {
  id: string
  domain: string          // e.g. "acceleratingasia.com"
  urlPattern: string      // e.g. "https://acceleratingasia.com/apply*"
  description: string     // AI-generated summary: "Fill application form"
  steps: any[]            // The original run pipeline steps
  createdAt: number
  lastUsed: number
  successCount: number
  failCount: number
}

export class RunCache {
  private cacheDir: string
  private workflows: CachedWorkflow[] = []

  constructor() {
    this.cacheDir = path.join(app.getPath('userData'), 'oculo-data', 'run-cache')
    fs.mkdirSync(this.cacheDir, { recursive: true })
    this.load()
  }

  private load(): void {
    const indexPath = path.join(this.cacheDir, 'index.json')
    try {
      if (fs.existsSync(indexPath)) {
        this.workflows = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
      }
    } catch { this.workflows = [] }
  }

  private save(): void {
    const indexPath = path.join(this.cacheDir, 'index.json')
    fs.writeFileSync(indexPath, JSON.stringify(this.workflows, null, 2))
  }

  /** Generate a hash for steps to detect duplicates */
  private hashSteps(steps: any[]): string {
    const normalized = JSON.stringify(steps).replace(/["'][^"']*["']/g, '""') // normalize string values
    return crypto.createHash('md5').update(normalized).digest('hex').substring(0, 12)
  }

  /** Extract domain from URL */
  private getDomain(url: string): string {
    try { return new URL(url).hostname } catch { return 'unknown' }
  }

  /** Save a successful run pipeline as a cached workflow */
  saveWorkflow(url: string, steps: any[], description?: string): string {
    const domain = this.getDomain(url)
    const hash = this.hashSteps(steps)
    const id = domain + '_' + hash

    // Check if already exists
    const existing = this.workflows.find(w => w.id === id)
    if (existing) {
      existing.successCount++
      existing.lastUsed = Date.now()
      existing.steps = steps // Update with latest steps
      this.save()
      return id
    }

    // Create new workflow
    const workflow: CachedWorkflow = {
      id,
      domain,
      urlPattern: url.replace(/[?#].*$/, '*'), // Strip query/hash, add wildcard
      description: description || 'Workflow on ' + domain,
      steps,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      successCount: 1,
      failCount: 0
    }
    this.workflows.push(workflow)

    // Keep max 100 workflows, remove oldest by lastUsed
    if (this.workflows.length > 100) {
      this.workflows.sort((a, b) => b.lastUsed - a.lastUsed)
      this.workflows = this.workflows.slice(0, 100)
    }

    this.save()
    return id
  }

  /** Find cached workflows for a given URL */
  findForUrl(url: string): CachedWorkflow[] {
    const domain = this.getDomain(url)
    return this.workflows
      .filter(w => w.domain === domain && w.failCount < 3)
      .sort((a, b) => b.successCount - a.successCount)
  }

  /** Get a specific workflow by ID */
  getWorkflow(id: string): CachedWorkflow | null {
    return this.workflows.find(w => w.id === id) || null
  }

  /** Mark a workflow as failed (don't delete, just track) */
  markFailed(id: string): void {
    const w = this.workflows.find(w => w.id === id)
    if (w) {
      w.failCount++
      this.save()
    }
  }

  /** Mark a workflow as successfully replayed */
  markSuccess(id: string): void {
    const w = this.workflows.find(w => w.id === id)
    if (w) {
      w.successCount++
      w.lastUsed = Date.now()
      this.save()
    }
  }

  /** List all workflows */
  list(): CachedWorkflow[] {
    return [...this.workflows].sort((a, b) => b.lastUsed - a.lastUsed)
  }

  /** Delete a workflow */
  delete(id: string): boolean {
    const idx = this.workflows.findIndex(w => w.id === id)
    if (idx === -1) return false
    this.workflows.splice(idx, 1)
    this.save()
    return true
  }

  /** Check if a workflow qualifies as a tested "skill" (3+ successes, <10% failure rate) */
  isTestedSkill(id: string): boolean {
    const w = this.workflows.find(w => w.id === id)
    if (!w) return false
    return w.successCount >= 3 && w.failCount / (w.successCount + w.failCount) < 0.1
  }

  /** Get all tested skills for a domain */
  getSkillsForDomain(domain: string): CachedWorkflow[] {
    return this.workflows
      .filter(w => w.domain === domain && this.isTestedSkill(w.id))
      .sort((a, b) => b.successCount - a.successCount)
  }

  /** Get a compact summary of available skills (for system prompt enrichment) */
  getSkillsSummary(): string {
    const skills = this.workflows.filter(w => this.isTestedSkill(w.id))
    if (!skills.length) return ''
    return '\nTested workflows (replay with run({workflow:"id"})):\n' +
      skills.slice(0, 10).map(s => `  [${s.id}] ${s.description} on ${s.domain} (${s.successCount}x)`).join('\n')
  }

  /** Get workflows summary for a domain (compact, for page tool hints) */
  getSummaryForDomain(domain: string): string {
    const matching = this.workflows
      .filter(w => w.domain === domain && w.failCount < 3)
      .sort((a, b) => b.successCount - a.successCount)
      .slice(0, 5)

    if (!matching.length) return ''

    return '\nCached workflows for this site:\n' +
      matching.map(w => `  [${w.id}] ${w.description} (used ${w.successCount}x)`).join('\n') +
      '\nUse run({workflow: "id"}) to replay a cached workflow.'
  }
}
