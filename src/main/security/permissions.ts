import { BrowserWindow, dialog, Notification, systemPreferences } from 'electron'
import { PERMISSION_MAP } from '../../shared/constants'
import { AppSettings, PermissionLevel } from '../../shared/types'
import { AuditLog } from './audit'
import { isHeadless, headlessAutoApprove, headlessLog } from '../headless'

/** Actions that ALWAYS require explicit confirm even in autonomous mode */
const AUTONOMOUS_SAFETY_LIST = new Set([
  'payment', 'delete_account', 'change_password', 'send_email', 'shell'
])

export class PermissionGate {
  private mainWindow: BrowserWindow
  private auditLog: AuditLog
  private getSettings: () => AppSettings

  constructor(mainWindow: BrowserWindow, auditLog: AuditLog, getSettings: () => AppSettings) {
    this.mainWindow = mainWindow
    this.auditLog = auditLog
    this.getSettings = getSettings
  }

  /** Check if Touch ID / biometric auth is available */
  static async canUseBiometric(): Promise<boolean> {
    if (process.platform !== 'darwin') return false
    try {
      return systemPreferences.canPromptTouchID()
    } catch {
      return false
    }
  }

  /** Prompt for Touch ID / biometric authentication */
  static async promptBiometric(reason: string): Promise<boolean> {
    if (process.platform !== 'darwin') return false
    try {
      await systemPreferences.promptTouchID(reason)
      return true
    } catch {
      return false // User cancelled or Touch ID not available
    }
  }

  /**
   * Check if an action is allowed.
   * Returns true if allowed, false if denied.
   */
  async check(action: string, details: string): Promise<boolean> {
    const level = this.getPermissionLevel(action)

    switch (level) {
      case 'auto':
        return true

      case 'notify':
        this.notify(action, details)
        return true

      case 'confirm':
        // Autonomous mode: downgrade non-safety confirms to notify (auto-approve + log)
        if (this.getSettings().autonomousMode && !AUTONOMOUS_SAFETY_LIST.has(action)) {
          this.notify(action, details)
          return true
        }
        return await this.confirm(action, details)

      case 'blocked':
        this.auditLog.log(action, details, 'blocked')
        return false

      default:
        return true
    }
  }

  private getPermissionLevel(action: string): PermissionLevel {
    // Check exact match first
    if (action in PERMISSION_MAP) {
      return PERMISSION_MAP[action]
    }
    
    // Check if action contains a known keyword (longest match first to prevent
    // "read" matching before "read_vault", which would bypass security)
    const actionLower = action.toLowerCase()
    const entries = Object.entries(PERMISSION_MAP).sort((a, b) => b[0].length - a[0].length)
    for (const [key, level] of entries) {
      if (actionLower.includes(key)) {
        return level
      }
    }

    // Default to notify for unknown actions
    return 'notify'
  }

  private notify(action: string, details: string): void {
    // Skip OS notifications — actions are visible in the chat panel's tool call UI
    this.auditLog.log(action, details, 'success')
  }

  private async confirm(action: string, details: string): Promise<boolean> {
    // Headless auto-approve: skip native dialog, log to console instead
    if (isHeadless && headlessAutoApprove) {
      headlessLog(`auto-approved CONFIRM action: ${action} — ${details.substring(0, 200)}`)
      this.auditLog.log(action, details, 'confirmed')
      return true
    }

    // Track focus state — dialog.showMessageBox steals focus on macOS
    const wasFocused = this.mainWindow.isFocused()

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: 'question',
      title: 'Oculo: Confirm Action',
      message: `Claude wants to perform: ${action}`,
      detail: details.substring(0, 300),
      buttons: ['Allow', 'Deny'],
      defaultId: 1,
      cancelId: 1
    })

    const approved = result.response === 0
    this.auditLog.log(action, details, approved ? 'confirmed' : 'denied')

    // Restore focus to previous app if dialog stole it
    if (!wasFocused && !this.mainWindow.isDestroyed() && this.mainWindow.isFocused()) {
      this.mainWindow.blur()
    }

    return approved
  }
}
