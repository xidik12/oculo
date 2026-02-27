import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'

export interface Lesson {
  id: string
  text: string
  timestamp: number
}

const MAX_LESSONS = 50 // Keep prompt size manageable

export class LessonStore {
  private lessons: Lesson[] = []
  private filePath: string

  constructor() {
    const dataDir = path.join(app.getPath('userData'), 'oculo-data')
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
    this.filePath = path.join(dataDir, 'agent-lessons.json')
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        this.lessons = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      }
    } catch {
      this.lessons = []
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.lessons, null, 2))
  }

  add(text: string): string {
    // Deduplicate — don't store near-identical lessons
    const lower = text.toLowerCase()
    const isDupe = this.lessons.some(l => {
      const ll = l.text.toLowerCase()
      return ll === lower || ll.includes(lower) || lower.includes(ll)
    })
    if (isDupe) return 'Already known.'

    const lesson: Lesson = {
      id: crypto.randomUUID(),
      text: text.trim(),
      timestamp: Date.now()
    }
    this.lessons.push(lesson)

    // Trim old lessons if over limit
    if (this.lessons.length > MAX_LESSONS) {
      this.lessons = this.lessons.slice(-MAX_LESSONS)
    }

    this.save()
    return 'Learned: ' + text.trim()
  }

  remove(id: string): boolean {
    const before = this.lessons.length
    this.lessons = this.lessons.filter(l => l.id !== id)
    if (this.lessons.length < before) {
      this.save()
      return true
    }
    return false
  }

  getAll(): Lesson[] {
    return this.lessons
  }

  /** Build a prompt section from stored lessons */
  toPromptSection(): string {
    if (this.lessons.length === 0) return ''
    const items = this.lessons.map(l => '- ' + l.text).join('\n')
    return `\n\nLEARNED FROM PAST EXPERIENCE (apply these lessons):\n${items}`
  }
}
