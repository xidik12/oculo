import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

// vi.hoisted runs before any imports — must use require() for Node builtins
const { TEST_DIR } = vi.hoisted(() => {
  const _path = require('path')
  const _fs = require('fs')
  const dir = _path.join('/tmp', 'oculo-vault-test-' + process.pid)
  _fs.mkdirSync(dir, { recursive: true })
  return { TEST_DIR: dir }
})

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (str: string) => Buffer.from(str),
    decryptString: (buf: Buffer) => buf.toString()
  },
  app: {
    getPath: () => TEST_DIR
  }
}))

import { SecurityManager } from '../../src/main/security/vault'

describe('SecurityManager', () => {
  let manager: SecurityManager

  beforeEach(() => {
    const dataDir = path.join(TEST_DIR, 'oculo-data')
    const vaultFile = path.join(dataDir, 'vault.enc')
    const settingsFile = path.join(dataDir, 'settings.json')
    try { fs.unlinkSync(vaultFile) } catch {}
    try { fs.unlinkSync(settingsFile) } catch {}
    manager = new SecurityManager()
  })

  describe('Credentials', () => {
    it('should add and retrieve a credential', () => {
      manager.addCredential('example.com', 'user@test.com', 'pass123')
      const cred = manager.getCredential('example.com')
      expect(cred).toBeTruthy()
      expect(cred!.username).toBe('user@test.com')
      expect(cred!.password).toBe('pass123')
    })

    it('should match subdomains via includes', () => {
      manager.addCredential('example.com', 'user', 'pass')
      const cred = manager.getCredential('www.example.com')
      expect(cred).toBeTruthy()
      expect(cred!.username).toBe('user')
    })

    it('should update existing credentials for the same domain', () => {
      manager.addCredential('example.com', 'user1', 'pass1')
      manager.addCredential('example.com', 'user2', 'pass2')
      const cred = manager.getCredential('example.com')
      expect(cred!.username).toBe('user2')
      expect(cred!.password).toBe('pass2')
    })

    it('should not expose password in addCredential return value', () => {
      const result = manager.addCredential('example.com', 'user', 'secret')
      expect(result.password).toBe('***')
    })

    it('should list credentials without passwords', () => {
      manager.addCredential('a.com', 'user1', 'pass1')
      manager.addCredential('b.com', 'user2', 'pass2')
      const list = manager.listCredentials()
      expect(list).toHaveLength(2)
      expect(list[0]).not.toHaveProperty('password')
      expect(list[0]).toHaveProperty('domain')
      expect(list[0]).toHaveProperty('username')
      expect(list[0]).toHaveProperty('id')
    })

    it('should delete credentials', () => {
      const entry = manager.addCredential('example.com', 'user', 'pass')
      expect(manager.deleteCredential(entry.id)).toBe(true)
      expect(manager.getCredential('example.com')).toBeNull()
    })

    it('should return false for deleting non-existent credential', () => {
      expect(manager.deleteCredential('non-existent')).toBe(false)
    })

    it('should return null for getting credential from unknown domain', () => {
      expect(manager.getCredential('unknown.com')).toBeNull()
    })
  })

  describe('TOTP', () => {
    it('should generate a 6-digit TOTP code', () => {
      manager.addCredential('example.com', 'user', 'pass', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
      const totp = manager.generateTOTP('example.com')
      expect(totp).toBeTruthy()
      expect(totp!.code).toMatch(/^\d{6}$/)
      expect(totp!.remainingSeconds).toBeGreaterThan(0)
      expect(totp!.remainingSeconds).toBeLessThanOrEqual(30)
    })

    it('should return null for domains without TOTP secret', () => {
      manager.addCredential('example.com', 'user', 'pass')
      expect(manager.generateTOTP('example.com')).toBeNull()
    })

    it('should return null for unknown domains', () => {
      expect(manager.generateTOTP('unknown.com')).toBeNull()
    })

    it('should set TOTP secret on existing credential', () => {
      manager.addCredential('example.com', 'user', 'pass')
      expect(manager.setTotpSecret('example.com', 'GEZDGNBVGY3TQOJQ')).toBe(true)
      const totp = manager.generateTOTP('example.com')
      expect(totp).toBeTruthy()
      expect(totp!.code).toMatch(/^\d{6}$/)
    })

    it('should return false when setting TOTP on non-existent domain', () => {
      expect(manager.setTotpSecret('unknown.com', 'SECRET')).toBe(false)
    })
  })

  describe('Settings', () => {
    it('should return default settings', () => {
      const settings = manager.getSettings()
      expect(settings).toBeTruthy()
      expect(settings.theme).toBeDefined()
      expect(settings.homePage).toBeDefined()
      expect(settings.searchEngine).toBeDefined()
    })

    it('should save and retrieve settings', () => {
      manager.saveSettings({ theme: 'dark' })
      const settings = manager.getSettings()
      expect(settings.theme).toBe('dark')
    })

    it('should merge settings instead of replacing', () => {
      const original = manager.getSettings()
      manager.saveSettings({ theme: 'light' })
      const updated = manager.getSettings()
      expect(updated.theme).toBe('light')
      expect(updated.searchEngine).toBe(original.searchEngine)
      expect(updated.homePage).toBe(original.homePage)
    })

    it('should return a copy of settings (not the internal reference)', () => {
      const s1 = manager.getSettings()
      s1.theme = 'dark'
      const s2 = manager.getSettings()
      expect(s2.theme).not.toBe('dark')
    })
  })
})
