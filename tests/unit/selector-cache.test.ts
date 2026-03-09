import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Electron and fs before importing SelectorCache
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/oculo-test'
  }
}))

vi.mock('fs', () => ({
  default: {
    existsSync: () => false,
    readFileSync: () => '[]',
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn()
  },
  existsSync: () => false,
  readFileSync: () => '[]',
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn()
}))

import { SelectorCache, type SelectorBundle, type SelectorEntry } from '../../src/main/engine/selector-cache'

describe('SelectorCache', () => {
  let cache: SelectorCache

  beforeEach(() => {
    cache = new SelectorCache()
  })

  describe('record and resolve', () => {
    it('should record a selector entry and resolve it', () => {
      const bundle: SelectorBundle = {
        id: 'login-btn',
        textContent: 'Sign In',
        role: 'button',
        name: 'Sign In',
        cssSelector: '#login-btn'
      }

      cache.record('example.com', '/login', 'click', 'click Sign In', bundle)

      const results = cache.resolve('example.com', 'click', { text: 'Sign In' })
      expect(results).toHaveLength(1)
      expect(results[0].domain).toBe('example.com')
      expect(results[0].action).toBe('click')
      expect(results[0].bundle.id).toBe('login-btn')
    })

    it('should not resolve entries for wrong domain', () => {
      cache.record('example.com', '/login', 'click', 'click Sign In', {
        id: 'btn',
        textContent: 'Sign In'
      })

      const results = cache.resolve('other.com', 'click', { text: 'Sign In' })
      expect(results).toHaveLength(0)
    })

    it('should not resolve entries for wrong action', () => {
      cache.record('example.com', '/login', 'click', 'click Sign In', {
        id: 'btn',
        textContent: 'Sign In'
      })

      const results = cache.resolve('example.com', 'fill', { text: 'Sign In' })
      expect(results).toHaveLength(0)
    })

    it('should merge selectors on re-record', () => {
      cache.record('example.com', '/login', 'click', 'click Sign In', {
        id: 'btn',
        textContent: 'Sign In'
      })

      cache.record('example.com', '/login', 'click', 'click Sign In', {
        id: 'btn',
        textContent: 'Sign In',
        ariaLabel: 'Sign in to account'
      })

      const results = cache.resolve('example.com', 'click', { text: 'Sign In' })
      expect(results).toHaveLength(1)
      expect(results[0].bundle.ariaLabel).toBe('Sign in to account')
      expect(results[0].successCount).toBe(2)
    })
  })

  describe('markFailed and markSuccess', () => {
    it('should track consecutive failures', () => {
      cache.record('example.com', '/page', 'click', 'click Submit', {
        id: 'submit',
        textContent: 'Submit'
      })

      const results = cache.resolve('example.com', 'click', { text: 'Submit' })
      const key = results[0].key

      cache.markFailed(key)
      cache.markFailed(key)

      // Should still resolve with 2 failures (threshold is 3)
      const afterTwo = cache.resolve('example.com', 'click', { text: 'Submit' })
      expect(afterTwo).toHaveLength(1)

      cache.markFailed(key)

      // After 3 consecutive failures, entry should be invalidated
      const afterThree = cache.resolve('example.com', 'click', { text: 'Submit' })
      expect(afterThree).toHaveLength(0)
    })

    it('should reset consecutive failures on success', () => {
      cache.record('example.com', '/page', 'click', 'click Submit', {
        id: 'submit',
        textContent: 'Submit'
      })

      const results = cache.resolve('example.com', 'click', { text: 'Submit' })
      const key = results[0].key

      cache.markFailed(key)
      cache.markFailed(key)
      cache.markSuccess(key)

      // After success, consecutive failures reset — should still resolve
      const afterSuccess = cache.resolve('example.com', 'click', { text: 'Submit' })
      expect(afterSuccess).toHaveLength(1)
      expect(afterSuccess[0].consecutiveFailures).toBe(0)
    })
  })

  describe('score', () => {
    it('should return correct stability scores', () => {
      expect(cache.score('id')).toBe(10)
      expect(cache.score('testId')).toBe(10)
      expect(cache.score('ariaLabel')).toBe(9)
      expect(cache.score('role')).toBe(8)
      expect(cache.score('placeholder')).toBe(7)
      expect(cache.score('textContent')).toBe(7)
      expect(cache.score('cssSelector')).toBe(5)
      expect(cache.score('xpath')).toBe(4)
      expect(cache.score('ref')).toBe(2)
    })
  })

  describe('stats', () => {
    it('should return correct statistics', () => {
      const stats = cache.stats()
      expect(stats.total).toBe(0)
      expect(stats.active).toBe(0)
      expect(stats.invalidated).toBe(0)
      expect(stats.hitRate).toBe('N/A')
    })

    it('should update stats after recording', () => {
      cache.record('example.com', '/', 'click', 'click Home', {
        id: 'home',
        textContent: 'Home'
      })

      const stats = cache.stats()
      expect(stats.total).toBe(1)
      expect(stats.active).toBe(1)
      expect(stats.invalidated).toBe(0)
    })
  })

  describe('resolve sorting', () => {
    it('should sort results by stability score (id > cssSelector)', () => {
      // Entry with id (score 10)
      cache.record('example.com', '/', 'click', 'click Login', {
        id: 'login',
        textContent: 'Login'
      })

      // Entry with only cssSelector (score 5)
      cache.record('example.com', '/', 'click', 'click Register', {
        cssSelector: 'div > button.register',
        textContent: 'Register'
      })

      // Resolve with broad hint — both should match if hints match
      const loginResults = cache.resolve('example.com', 'click', { text: 'Login' })
      expect(loginResults).toHaveLength(1)
      expect(loginResults[0].bundle.id).toBe('login')

      const registerResults = cache.resolve('example.com', 'click', { text: 'Register' })
      expect(registerResults).toHaveLength(1)
      expect(registerResults[0].bundle.cssSelector).toBe('div > button.register')
    })
  })

  describe('fuzzy matching', () => {
    it('should match by ariaLabel hint', () => {
      cache.record('example.com', '/', 'click', 'click Close', {
        id: 'close-btn',
        ariaLabel: 'Close dialog',
        textContent: 'X'
      })

      const results = cache.resolve('example.com', 'click', { ariaLabel: 'Close dialog' })
      expect(results).toHaveLength(1)
    })

    it('should match by placeholder hint', () => {
      cache.record('example.com', '/', 'fill', 'fill Email', {
        placeholder: 'Enter your email',
        textContent: ''
      })

      const results = cache.resolve('example.com', 'fill', { placeholder: 'Enter your email' })
      expect(results).toHaveLength(1)
    })

    it('should match by role and name', () => {
      cache.record('example.com', '/', 'click', 'click Save', {
        role: 'button',
        name: 'Save changes',
        textContent: 'Save changes'
      })

      const results = cache.resolve('example.com', 'click', { role: 'button', name: 'Save changes' })
      expect(results).toHaveLength(1)
    })
  })
})
