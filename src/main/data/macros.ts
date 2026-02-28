import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { Macro, PipelineStep } from '../../shared/types'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const MACROS_FILE = join(DATA_DIR, 'macros.json')

export class MacroStore {
  private macros: Macro[] = []

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      if (existsSync(MACROS_FILE)) {
        const data = readFileSync(MACROS_FILE, 'utf-8')
        this.macros = JSON.parse(data)
      }
    } catch {
      this.macros = []
    }
  }

  private save(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      writeFileSync(MACROS_FILE, JSON.stringify(this.macros, null, 2))
    } catch (err) {
      console.error('Failed to save macros:', err)
    }
  }

  list(): Macro[] {
    return [...this.macros]
  }

  create(name: string, steps: PipelineStep[], shortcut?: string, description?: string): Macro {
    const macro: Macro = {
      id: `macro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      steps,
      shortcut,
      description,
      createdAt: Date.now()
    }
    this.macros.push(macro)
    this.save()
    return macro
  }

  update(id: string, updates: Partial<Omit<Macro, 'id' | 'createdAt'>>): Macro | null {
    const idx = this.macros.findIndex(m => m.id === id)
    if (idx === -1) return null
    this.macros[idx] = { ...this.macros[idx], ...updates }
    this.save()
    return this.macros[idx]
  }

  delete(id: string): boolean {
    const len = this.macros.length
    this.macros = this.macros.filter(m => m.id !== id)
    if (this.macros.length !== len) {
      this.save()
      return true
    }
    return false
  }

  get(id: string): Macro | undefined {
    return this.macros.find(m => m.id === id)
  }
}
