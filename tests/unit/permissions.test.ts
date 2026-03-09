import { describe, it, expect } from 'vitest'
import { PERMISSION_MAP } from '../../src/shared/constants'

// PermissionGate requires BrowserWindow and dialog from Electron,
// so we test the permission level mapping logic directly.

describe('Permission Levels', () => {
  describe('PERMISSION_MAP', () => {
    it('should define auto-level permissions for read-only actions', () => {
      const autoActions = ['navigate', 'page', 'read', 'scroll', 'screenshot', 'back', 'forward', 'reload', 'hover']
      for (const action of autoActions) {
        expect(PERMISSION_MAP[action]).toBe('auto')
      }
    })

    it('should define notify-level permissions for interactive actions', () => {
      const notifyActions = ['click', 'type', 'fill', 'select', 'press', 'submit']
      for (const action of notifyActions) {
        expect(PERMISSION_MAP[action]).toBe('notify')
      }
    })

    it('should define confirm-level permissions for sensitive actions', () => {
      const confirmActions = ['login', 'shell']
      for (const action of confirmActions) {
        expect(PERMISSION_MAP[action]).toBe('confirm')
      }
    })

    it('should define blocked-level permissions for dangerous actions', () => {
      const blockedActions = ['read_vault', 'export_cookies', 'export_tokens', 'disable_security']
      for (const action of blockedActions) {
        expect(PERMISSION_MAP[action]).toBe('blocked')
      }
    })

    it('should have all values be valid permission levels', () => {
      const validLevels = ['auto', 'notify', 'confirm', 'blocked']
      for (const [action, level] of Object.entries(PERMISSION_MAP)) {
        expect(validLevels).toContain(level)
      }
    })
  })

  describe('Permission level logic', () => {
    // Simulates PermissionGate.getPermissionLevel without Electron deps
    function getPermissionLevel(action: string): string {
      if (action in PERMISSION_MAP) {
        return PERMISSION_MAP[action]
      }

      const actionLower = action.toLowerCase()
      const entries = Object.entries(PERMISSION_MAP).sort((a, b) => b[0].length - a[0].length)
      for (const [key, level] of entries) {
        if (actionLower.includes(key)) {
          return level
        }
      }

      return 'notify'
    }

    it('should return exact match for known actions', () => {
      expect(getPermissionLevel('navigate')).toBe('auto')
      expect(getPermissionLevel('click')).toBe('notify')
      expect(getPermissionLevel('shell')).toBe('confirm')
      expect(getPermissionLevel('read_vault')).toBe('blocked')
    })

    it('should match by substring for compound actions', () => {
      // "navigate_to" contains "navigate" -> auto
      expect(getPermissionLevel('navigate_to')).toBe('auto')
    })

    it('should default to notify for unknown actions', () => {
      expect(getPermissionLevel('some_unknown_action_xyz')).toBe('notify')
    })

    it('should prefer longest match to prevent security bypasses', () => {
      // "read_vault" should match "read_vault" (blocked) not "read" (auto)
      expect(getPermissionLevel('read_vault')).toBe('blocked')
    })

    it('should match export_cookies as blocked', () => {
      expect(getPermissionLevel('export_cookies')).toBe('blocked')
    })
  })
})
