import { safeStorage, app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { VaultEntry, AppSettings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/constants'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const VAULT_FILE = join(DATA_DIR, 'vault.enc')
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

export class SecurityManager {
  private vault: VaultEntry[] = []
  private settings: AppSettings = { ...DEFAULT_SETTINGS }

  constructor() {
    ensureDir()
    this.loadVault()
    this.loadSettings()
  }

  // === Vault ===

  private loadVault(): void {
    try {
      if (existsSync(VAULT_FILE) && safeStorage.isEncryptionAvailable()) {
        const encrypted = readFileSync(VAULT_FILE)
        const decrypted = safeStorage.decryptString(encrypted)
        this.vault = JSON.parse(decrypted)
      }
    } catch {
      this.vault = []
    }
  }

  private saveVault(): void {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const json = JSON.stringify(this.vault, null, 2)
        const encrypted = safeStorage.encryptString(json)
        writeFileSync(VAULT_FILE, encrypted)
      }
    } catch (err) {
      console.error('Failed to save vault:', err)
    }
  }

  addCredential(domain: string, username: string, password: string): VaultEntry {
    // Check if domain already exists, update if so
    const existing = this.vault.find(v => v.domain === domain)
    if (existing) {
      existing.username = username
      existing.password = password
      existing.updatedAt = Date.now()
      this.saveVault()
      return { ...existing, password: '***' }
    }

    const entry: VaultEntry = {
      id: `vault-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      domain,
      username,
      password,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.vault.push(entry)
    this.saveVault()
    return { ...entry, password: '***' }
  }

  getCredential(domain: string): { domain: string; username: string; password: string } | null {
    const entry = this.vault.find(v => v.domain === domain || domain.includes(v.domain))
    if (!entry) return null
    return { domain: entry.domain, username: entry.username, password: entry.password }
  }

  listCredentials(): { id: string; domain: string; username: string; updatedAt: number }[] {
    return this.vault.map(v => ({
      id: v.id,
      domain: v.domain,
      username: v.username,
      updatedAt: v.updatedAt
    }))
  }

  deleteCredential(id: string): boolean {
    const idx = this.vault.findIndex(v => v.id === id)
    if (idx === -1) return false
    this.vault.splice(idx, 1)
    this.saveVault()
    return true
  }

  // === Settings ===

  private loadSettings(): void {
    try {
      if (existsSync(SETTINGS_FILE)) {
        const data = readFileSync(SETTINGS_FILE, 'utf-8')
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) }
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS }
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings }
  }

  saveSettings(settings: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...settings }
    try {
      writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2))
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
    return { ...this.settings }
  }
}
