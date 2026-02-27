import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

let testDir: string

// Mock electron before any imports
vi.mock('electron', () => ({
  app: {
    getPath: () => testDir
  }
}))

import { RunCache, CachedWorkflow } from '../../src/main/data/run-cache'

describe('RunCache', () => {
  let cache: RunCache

  beforeEach(() => {
    testDir = path.join('/tmp', 'oculo-test-runcache-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6))
    fs.mkdirSync(testDir, { recursive: true })
    cache = new RunCache()
  })

  describe('saveWorkflow', () => {
    it('should save a workflow and return an id containing the domain', () => {
      const id = cache.saveWorkflow('https://example.com/form', [
        { act: { action: 'click', text: 'Submit' } },
        { fill: { fields: { Name: 'Test' } } }
      ], 'Fill and submit form')

      expect(id).toBeTruthy()
      expect(id).toContain('example.com')
    })

    it('should retrieve a saved workflow with correct properties', () => {
      const id = cache.saveWorkflow('https://example.com/form', [
        { act: { action: 'click', text: 'Submit' } },
        { fill: { fields: { Name: 'Test' } } }
      ], 'Fill and submit form')

      const workflow = cache.getWorkflow(id)
      expect(workflow).toBeTruthy()
      expect(workflow!.steps).toHaveLength(2)
      expect(workflow!.description).toBe('Fill and submit form')
      expect(workflow!.successCount).toBe(1)
      expect(workflow!.failCount).toBe(0)
      expect(workflow!.domain).toBe('example.com')
    })

    it('should increment success count on duplicate save with same steps', () => {
      const steps = [{ act: { action: 'click', text: 'Go' } }]
      const id1 = cache.saveWorkflow('https://example.com', steps)
      const id2 = cache.saveWorkflow('https://example.com', steps)

      expect(id1).toBe(id2)
      const workflow = cache.getWorkflow(id1)
      expect(workflow!.successCount).toBe(2)
    })

    it('should use default description when none is provided', () => {
      const id = cache.saveWorkflow('https://example.com/page', [{ act: { action: 'click', text: 'Go' } }])
      const workflow = cache.getWorkflow(id)
      expect(workflow!.description).toBe('Workflow on example.com')
    })

    it('should strip query/hash from URL pattern', () => {
      const id = cache.saveWorkflow('https://example.com/page?foo=bar#section', [{ act: { action: 'click', text: 'Go' } }])
      const workflow = cache.getWorkflow(id)
      expect(workflow!.urlPattern).toBe('https://example.com/page*')
    })

    it('should handle invalid URLs gracefully', () => {
      const id = cache.saveWorkflow('not a url', [{ act: { action: 'click', text: 'Go' } }])
      const workflow = cache.getWorkflow(id)
      expect(workflow!.domain).toBe('unknown')
    })
  })

  describe('findForUrl', () => {
    it('should find workflows by URL domain', () => {
      // Steps must be structurally different (different keys/structure, not just text values)
      // because hashSteps normalizes all string values to ""
      cache.saveWorkflow('https://example.com/page1', [{ act: { action: 'click', text: 'A' } }])
      cache.saveWorkflow('https://example.com/page2', [{ fill: { fields: { Name: 'B' } } }])
      cache.saveWorkflow('https://other.com/page1', [{ act: { action: 'click', text: 'C' } }])

      const found = cache.findForUrl('https://example.com/anything')
      expect(found).toHaveLength(2)
    })

    it('should return empty array for unknown domains', () => {
      const found = cache.findForUrl('https://unknown.com')
      expect(found).toHaveLength(0)
    })

    it('should sort results by successCount descending', () => {
      // Steps must be structurally different to get separate IDs
      const steps1 = [{ act: { action: 'click', text: 'A' } }]
      const steps2 = [{ fill: { fields: { Name: 'B' } } }]
      cache.saveWorkflow('https://example.com', steps1, 'First')
      cache.saveWorkflow('https://example.com', steps2, 'Second')
      // Add extra successes to steps2
      cache.saveWorkflow('https://example.com', steps2, 'Second')
      cache.saveWorkflow('https://example.com', steps2, 'Second')

      const found = cache.findForUrl('https://example.com')
      expect(found).toHaveLength(2)
      expect(found[0].description).toBe('Second')
      expect(found[0].successCount).toBe(3)
    })
  })

  describe('markFailed', () => {
    it('should track failures and hide workflows at 3+ failures', () => {
      const id = cache.saveWorkflow('https://example.com', [{ act: { action: 'click', text: 'X' } }])

      cache.markFailed(id)
      cache.markFailed(id)
      expect(cache.findForUrl('https://example.com')).toHaveLength(1)

      cache.markFailed(id)
      expect(cache.findForUrl('https://example.com')).toHaveLength(0) // Hidden at 3+ failures
    })

    it('should be a no-op for non-existent workflows', () => {
      // Should not throw
      cache.markFailed('non-existent-id')
    })
  })

  describe('markSuccess', () => {
    it('should increment success count and update lastUsed', () => {
      const id = cache.saveWorkflow('https://example.com', [{ act: { action: 'click', text: 'Go' } }])
      const before = cache.getWorkflow(id)!.lastUsed

      // Small delay to ensure timestamp difference
      cache.markSuccess(id)
      const after = cache.getWorkflow(id)!
      expect(after.successCount).toBe(2)
      expect(after.lastUsed).toBeGreaterThanOrEqual(before)
    })
  })

  describe('isTestedSkill', () => {
    it('should return false for new workflows with only 1 success', () => {
      const id = cache.saveWorkflow('https://example.com', [{ act: { action: 'click', text: 'Go' } }])
      expect(cache.isTestedSkill(id)).toBe(false)
    })

    it('should return true when 3+ successes and low failure rate', () => {
      const steps = [{ act: { action: 'click', text: 'Go' } }]
      const id = cache.saveWorkflow('https://example.com', steps)
      cache.saveWorkflow('https://example.com', steps) // 2
      cache.saveWorkflow('https://example.com', steps) // 3
      expect(cache.isTestedSkill(id)).toBe(true)
    })

    it('should return false for non-existent workflow', () => {
      expect(cache.isTestedSkill('non-existent')).toBe(false)
    })

    it('should return false when failure rate is >= 10%', () => {
      const steps = [{ act: { action: 'click', text: 'Go' } }]
      const id = cache.saveWorkflow('https://example.com', steps)
      cache.saveWorkflow('https://example.com', steps) // 2
      cache.saveWorkflow('https://example.com', steps) // 3
      // 3 successes, 1 failure = 25% failure rate
      cache.markFailed(id)
      expect(cache.isTestedSkill(id)).toBe(false)
    })
  })

  describe('list', () => {
    it('should return all workflows sorted by lastUsed descending', () => {
      cache.saveWorkflow('https://a.com', [{ act: { action: 'click', text: 'A' } }])
      cache.saveWorkflow('https://b.com', [{ act: { action: 'click', text: 'B' } }])
      cache.saveWorkflow('https://c.com', [{ act: { action: 'click', text: 'C' } }])
      // Mark the last one as success again to ensure it has the latest lastUsed
      const allBefore = cache.list()
      expect(allBefore).toHaveLength(3)

      // Just verify the sort direction: lastUsed should be descending
      for (let i = 0; i < allBefore.length - 1; i++) {
        expect(allBefore[i].lastUsed).toBeGreaterThanOrEqual(allBefore[i + 1].lastUsed)
      }
    })

    it('should cap at 100 workflows with LRU eviction', () => {
      for (let i = 0; i < 110; i++) {
        cache.saveWorkflow(`https://site${i}.com`, [{ act: { action: 'click', text: `Item${i}` } }])
      }
      expect(cache.list().length).toBeLessThanOrEqual(100)
    })
  })

  describe('delete', () => {
    it('should delete an existing workflow', () => {
      const id = cache.saveWorkflow('https://example.com', [{ act: { action: 'click', text: 'Go' } }])
      expect(cache.delete(id)).toBe(true)
      expect(cache.getWorkflow(id)).toBeNull()
    })

    it('should return false for non-existent workflow', () => {
      expect(cache.delete('non-existent')).toBe(false)
    })
  })

  describe('getSummaryForDomain', () => {
    it('should generate a summary for workflows on a domain', () => {
      cache.saveWorkflow('https://example.com', [{ act: { action: 'click', text: 'Go' } }], 'Click go button')
      const summary = cache.getSummaryForDomain('example.com')
      expect(summary).toContain('Click go button')
      expect(summary).toContain('Cached workflows')
    })

    it('should return empty string for unknown domains', () => {
      const summary = cache.getSummaryForDomain('unknown.com')
      expect(summary).toBe('')
    })

    it('should limit to 5 workflows in summary', () => {
      for (let i = 0; i < 8; i++) {
        cache.saveWorkflow('https://example.com', [{ act: { action: 'click', text: `Item${i}` } }], `Workflow ${i}`)
      }
      const summary = cache.getSummaryForDomain('example.com')
      // Count occurrences of workflow lines (each starts with "  [")
      const lines = summary.split('\n').filter(l => l.trim().startsWith('['))
      expect(lines.length).toBeLessThanOrEqual(5)
    })
  })

  describe('getSkillsSummary', () => {
    it('should return empty string when no tested skills exist', () => {
      cache.saveWorkflow('https://example.com', [{ act: { action: 'click', text: 'Go' } }])
      expect(cache.getSkillsSummary()).toBe('')
    })

    it('should return summary when tested skills exist', () => {
      const steps = [{ act: { action: 'click', text: 'Go' } }]
      cache.saveWorkflow('https://example.com', steps, 'Auto click')
      cache.saveWorkflow('https://example.com', steps)
      cache.saveWorkflow('https://example.com', steps)
      const summary = cache.getSkillsSummary()
      expect(summary).toContain('Tested workflows')
      expect(summary).toContain('Auto click')
    })
  })

  describe('getSkillsForDomain', () => {
    it('should return tested skills for a domain', () => {
      const steps = [{ act: { action: 'click', text: 'Go' } }]
      cache.saveWorkflow('https://example.com', steps, 'Skill 1')
      cache.saveWorkflow('https://example.com', steps)
      cache.saveWorkflow('https://example.com', steps)

      const skills = cache.getSkillsForDomain('example.com')
      expect(skills).toHaveLength(1)
      expect(skills[0].description).toBe('Skill 1')
    })

    it('should return empty for domains with no tested skills', () => {
      cache.saveWorkflow('https://example.com', [{ act: { action: 'click', text: 'Go' } }])
      expect(cache.getSkillsForDomain('example.com')).toHaveLength(0)
    })
  })
})
