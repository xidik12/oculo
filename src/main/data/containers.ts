import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { Container } from '../../shared/types'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const CONTAINERS_FILE = join(DATA_DIR, 'containers.json')

export class ContainerStore {
  private containers: Container[] = []

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      if (existsSync(CONTAINERS_FILE)) {
        const data = readFileSync(CONTAINERS_FILE, 'utf-8')
        this.containers = JSON.parse(data)
      }
    } catch {
      this.containers = []
    }
  }

  private save(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      writeFileSync(CONTAINERS_FILE, JSON.stringify(this.containers, null, 2))
    } catch (err) {
      console.error('Failed to save containers:', err)
    }
  }

  list(): Container[] {
    return [...this.containers]
  }

  create(name: string, color: string, icon: string): Container {
    const id = `ct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const container: Container = {
      id,
      name,
      color,
      icon,
      partition: `persist:container-${id}`
    }
    this.containers.push(container)
    this.save()
    return container
  }

  update(id: string, updates: Partial<Pick<Container, 'name' | 'color' | 'icon'>>): Container | null {
    const idx = this.containers.findIndex(c => c.id === id)
    if (idx === -1) return null
    this.containers[idx] = { ...this.containers[idx], ...updates }
    this.save()
    return this.containers[idx]
  }

  delete(id: string): boolean {
    const len = this.containers.length
    this.containers = this.containers.filter(c => c.id !== id)
    if (this.containers.length !== len) {
      this.save()
      return true
    }
    return false
  }

  get(id: string): Container | undefined {
    return this.containers.find(c => c.id === id)
  }
}
