import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

// vi.hoisted runs before any imports — must use require() for Node builtins
const { TEST_DIR } = vi.hoisted(() => {
  const _path = require('path')
  const _fs = require('fs')
  const dir = _path.join('/tmp', 'oculo-audit-test-' + process.pid)
  _fs.mkdirSync(dir, { recursive: true })
  return { TEST_DIR: dir }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => TEST_DIR
  }
}))

import { AuditLog } from '../../src/main/security/audit'

describe('AuditLog', () => {
  let audit: AuditLog

  beforeEach(() => {
    const dataDir = path.join(TEST_DIR, 'oculo-data')
    const logFile = path.join(dataDir, 'audit.jsonl')
    try { fs.unlinkSync(logFile) } catch {}
    audit = new AuditLog()
  })

  describe('log', () => {
    it('should log an entry with all fields', () => {
      audit.log('click', 'Submit button', 'success', 'Clicked the submit button', 'act')
      const entries = audit.query(10)
      expect(entries).toHaveLength(1)
      expect(entries[0].action).toBe('click')
      expect(entries[0].target).toBe('Submit button')
      expect(entries[0].result).toBe('success')
      expect(entries[0].details).toBe('Clicked the submit button')
      expect(entries[0].toolName).toBe('act')
    })

    it('should auto-increment entry IDs', () => {
      audit.log('click', 'Button 1', 'success')
      audit.log('navigate', 'https://example.com', 'success')
      const entries = audit.query(10)
      expect(entries[0].id).toBe(2)
      expect(entries[1].id).toBe(1)
    })

    it('should truncate long target strings to 500 chars', () => {
      const longTarget = 'x'.repeat(600)
      audit.log('click', longTarget, 'success')
      const entries = audit.query(10)
      expect(entries[0].target.length).toBeLessThanOrEqual(500)
    })

    it('should truncate long details to 1000 chars', () => {
      const longDetails = 'y'.repeat(1500)
      audit.log('click', 'target', 'success', longDetails)
      const entries = audit.query(10)
      expect(entries[0].details!.length).toBeLessThanOrEqual(1000)
    })

    it('should log entries with timestamp', () => {
      const before = Date.now()
      audit.log('navigate', 'https://example.com', 'success')
      const after = Date.now()
      const entries = audit.query(10)
      expect(entries[0].timestamp).toBeGreaterThanOrEqual(before)
      expect(entries[0].timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('query', () => {
    it('should return entries in newest-first order', () => {
      audit.log('action1', 'target1', 'success')
      audit.log('action2', 'target2', 'success')
      audit.log('action3', 'target3', 'success')
      const entries = audit.query(10)
      expect(entries[0].action).toBe('action3')
      expect(entries[2].action).toBe('action1')
    })

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        audit.log(`action${i}`, `target${i}`, 'success')
      }
      const entries = audit.query(3)
      expect(entries).toHaveLength(3)
    })

    it('should respect offset parameter', () => {
      audit.log('first', 'target', 'success')
      audit.log('second', 'target', 'success')
      audit.log('third', 'target', 'success')
      const entries = audit.query(10, 1)
      expect(entries).toHaveLength(2)
      expect(entries[0].action).toBe('second')
    })

    it('should return empty array when no entries exist', () => {
      const entries = audit.query(10)
      expect(entries).toHaveLength(0)
    })

    it('should default to 100 entries', () => {
      for (let i = 0; i < 110; i++) {
        audit.log(`action${i}`, `target${i}`, 'success')
      }
      const entries = audit.query()
      expect(entries).toHaveLength(100)
    })
  })

  describe('cleanup', () => {
    it('should remove entries older than retention period', () => {
      const dataDir = path.join(TEST_DIR, 'oculo-data')
      fs.mkdirSync(dataDir, { recursive: true })
      const logFile = path.join(dataDir, 'audit.jsonl')

      const oldEntry = JSON.stringify({
        id: 1,
        timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000),
        action: 'old_action',
        target: 'old_target',
        result: 'success'
      })
      const newEntry = JSON.stringify({
        id: 2,
        timestamp: Date.now(),
        action: 'new_action',
        target: 'new_target',
        result: 'success'
      })
      fs.writeFileSync(logFile, oldEntry + '\n' + newEntry + '\n')

      const removed = audit.cleanup(30)
      expect(removed).toBe(1)

      const remaining = audit.query(10)
      expect(remaining).toHaveLength(1)
      expect(remaining[0].action).toBe('new_action')
    })

    it('should return 0 when no entries exist', () => {
      const removed = audit.cleanup(30)
      expect(removed).toBe(0)
    })

    it('should keep all entries within retention period', () => {
      audit.log('recent', 'target', 'success')
      audit.log('also_recent', 'target', 'success')
      const removed = audit.cleanup(30)
      expect(removed).toBe(0)
      expect(audit.query(10)).toHaveLength(2)
    })
  })

  describe('close', () => {
    it('should not throw when called', () => {
      expect(() => audit.close()).not.toThrow()
    })
  })
})
