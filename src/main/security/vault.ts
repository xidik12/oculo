import { safeStorage, app } from 'electron'
import crypto from 'crypto'
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
      id: `vault-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
