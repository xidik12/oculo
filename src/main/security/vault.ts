import { safeStorage, app } from 'electron'
import crypto from 'crypto'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { VaultEntry, AppSettings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/constants'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const VAULT_FILE = join(DATA_DIR, 'vault.enc')
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')
const API_KEYS_FILE = join(DATA_DIR, 'api-keys.enc')

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

  addCredential(domain: string, username: string, password: string, totpSecret?: string): VaultEntry {
    // Check if domain already exists, update if so
    const existing = this.vault.find(v => v.domain === domain)
    if (existing) {
      existing.username = username
      existing.password = password
      if (totpSecret !== undefined) existing.totpSecret = totpSecret
      existing.updatedAt = Date.now()
      this.saveVault()
      return { ...existing, password: '***' }
    }

    const entry: VaultEntry = {
      id: crypto.randomUUID(),
      domain,
      username,
      password,
      totpSecret,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.vault.push(entry)
    this.saveVault()
    return { ...entry, password: '***' }
  }

  getCredential(domain: string): { domain: string; username: string; password: string } | null {
    // Match exact domain or subdomain-of (e.g., "sub.bank.com" matches stored "bank.com")
    const entry = this.vault.find(v => v.domain === domain || domain.endsWith('.' + v.domain))
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

  /** Generate current TOTP code from a stored secret (RFC 6238) */
  generateTOTP(domain: string): { code: string; remainingSeconds: number } | null {
    // Match exact domain or subdomain-of (e.g., "sub.bank.com" matches stored "bank.com")
    const entry = this.vault.find(v => v.domain === domain || domain.endsWith('.' + v.domain))
    if (!entry?.totpSecret) return null

    try {
      const secret = entry.totpSecret
      // Decode base32 secret
      const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
      let bits = ''
      const cleanSecret = secret.replace(/[\s=-]+/g, '').toUpperCase()
      for (const c of cleanSecret) {
        const val = base32chars.indexOf(c)
        if (val === -1) continue
        bits += val.toString(2).padStart(5, '0')
      }
      const keyBytes = new Uint8Array(Math.floor(bits.length / 8))
      for (let i = 0; i < keyBytes.length; i++) {
        keyBytes[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2)
      }

      // TOTP: HMAC-SHA1(key, time_step)
      const period = 30
      const time = Math.floor(Date.now() / 1000)
      const counter = Math.floor(time / period)
      const counterBuf = Buffer.alloc(8)
      counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
      counterBuf.writeUInt32BE(counter & 0xffffffff, 4)

      const hmac = crypto.createHmac('sha1', Buffer.from(keyBytes))
      hmac.update(counterBuf)
      const hash = hmac.digest()

      // Dynamic truncation
      const offset = hash[hash.length - 1] & 0x0f
      const code = ((hash[offset] & 0x7f) << 24 |
                     (hash[offset + 1] & 0xff) << 16 |
                     (hash[offset + 2] & 0xff) << 8 |
                     (hash[offset + 3] & 0xff)) % 1000000

      return {
        code: code.toString().padStart(6, '0'),
        remainingSeconds: period - (time % period)
      }
    } catch {
      return null
    }
  }

  /** Add or update TOTP secret for a domain */
  setTotpSecret(domain: string, totpSecret: string): boolean {
    const entry = this.vault.find(v => v.domain === domain)
    if (!entry) return false
    entry.totpSecret = totpSecret
    entry.updatedAt = Date.now()
    this.saveVault()
    return true
  }

  // === API Key Encryption ===

  private loadApiKeys(): Record<string, any> {
    try {
      if (existsSync(API_KEYS_FILE) && safeStorage.isEncryptionAvailable()) {
        const encrypted = readFileSync(API_KEYS_FILE)
        const decrypted = safeStorage.decryptString(encrypted)
        return JSON.parse(decrypted)
      }
    } catch { /* api-keys.enc not available or corrupt */ }
    return {}
  }

  private saveApiKeys(providers: Record<string, any>): void {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const json = JSON.stringify(providers, null, 2)
        const encrypted = safeStorage.encryptString(json)
        writeFileSync(API_KEYS_FILE, encrypted)
      }
    } catch (err) {
      console.error('Failed to save encrypted API keys:', err)
    }
  }

  // === Settings ===

  private loadSettings(): void {
    try {
      if (existsSync(SETTINGS_FILE)) {
        const data = readFileSync(SETTINGS_FILE, 'utf-8')
        const parsed = JSON.parse(data)
        // Migrate: if aiProviders are in settings.json (plaintext), move to encrypted storage
        if (parsed.aiProviders) {
          const hasKeys = Object.values(parsed.aiProviders as Record<string, any>).some(
            (p: any) => p.apiKey && p.apiKey.length > 0
          )
          if (hasKeys) {
            this.saveApiKeys(parsed.aiProviders)
            delete parsed.aiProviders
            writeFileSync(SETTINGS_FILE, JSON.stringify(parsed, null, 2))
          }
        }
        this.settings = { ...DEFAULT_SETTINGS, ...parsed }
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS }
    }
    // Merge encrypted API keys into settings
    const encryptedProviders = this.loadApiKeys()
    if (Object.keys(encryptedProviders).length > 0) {
      (this.settings as any).aiProviders = encryptedProviders
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings }
  }

  saveSettings(settings: Partial<AppSettings>): AppSettings {
    // Extract aiProviders for encrypted storage
    const { aiProviders, ...rest } = settings as any
    if (aiProviders) {
      this.saveApiKeys(aiProviders)
      ;(this.settings as any).aiProviders = aiProviders
    }
    this.settings = { ...this.settings, ...rest }
    try {
      // Save non-sensitive settings to plaintext JSON (without apiProviders)
      const toSave = { ...this.settings }
      delete (toSave as any).aiProviders
      writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2))
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
    return { ...this.settings }
  }
}
