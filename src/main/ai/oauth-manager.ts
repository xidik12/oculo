import { execFileSync, execFile } from 'child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import path from 'path'
import os from 'os'
import { BrowserWindow, safeStorage } from 'electron'
import { CodexOAuthBase } from './oauth-codex'

/**
 * OAuth manager — handles Claude CLI subscription (macOS Keychain) and
 * OpenAI Codex CLI subscription (~/.codex/auth.json), plus in-app PKCE flows.
 */
export class OAuthManager extends CodexOAuthBase {
  oauthToken: string | null = null
  oauthExpiresAt: number = 0
  claudeLoggedIn: boolean = false
  claudeAuthChecked: boolean = false
  claudeAuthEmail: string | undefined

  private mainWindow: BrowserWindow | null = null

  protected getMainWindow() { return this.mainWindow }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  // === Claude OAuth Token (macOS: Keychain, Windows/Linux: safeStorage file) ===

  loadOAuthToken(): void {
    let creds: any = null

    if (process.platform === 'darwin') {
      try {
        const raw = execFileSync('security', [
          'find-generic-password', '-s', 'Oculo-credentials', '-w'
        ], { encoding: 'utf-8', timeout: 5000 }).trim()
        creds = JSON.parse(raw)
      } catch { /* keychain not available */ }
    } else {
      try {
        const dataDir = path.join(os.homedir(), '.oculo-data')
        const encPath = path.join(dataDir, 'claude-oauth.enc')
        const jsonPath = path.join(dataDir, 'claude-oauth.json')
        if (existsSync(encPath) && safeStorage.isEncryptionAvailable()) {
          const encrypted = readFileSync(encPath)
          const raw = safeStorage.decryptString(encrypted)
          creds = JSON.parse(raw)
        } else if (existsSync(jsonPath)) {
          creds = JSON.parse(readFileSync(jsonPath, 'utf-8'))
        }
      } catch { /* file not available */ }
    }

    if (!creds) return
    const oauth = creds?.claudeAiOauth
    if (oauth?.accessToken) {
      this.oauthToken = oauth.accessToken
      this.oauthExpiresAt = oauth.expiresAt || 0
      this.claudeLoggedIn = true
      this.claudeAuthChecked = true
      if (oauth.subscriptionType) {
        this.claudeAuthEmail = `${oauth.subscriptionType} subscription`
      }
    }
  }

  getOAuthToken(): string | null {
    if (this.oauthToken && this.oauthExpiresAt > 0 && Date.now() > this.oauthExpiresAt - 300000) {
      this.loadOAuthToken()
    }
    return this.oauthToken
  }

  // === Claude CLI Auth Check ===

  checkClaudeAuth(claudePath: string, env: Record<string, string>): void {
    if (!claudePath) return
    execFile(claudePath, ['auth', 'status'], { env, timeout: 15000 }, (err, stdout) => {
      if (err) { this.claudeAuthChecked = true; this.claudeLoggedIn = false; return }
      try {
        const status = JSON.parse(stdout.trim())
        this.claudeAuthChecked = true
        this.claudeLoggedIn = !!status.loggedIn
        this.claudeAuthEmail = status.email
      } catch { this.claudeAuthChecked = true; this.claudeLoggedIn = false }
    })
  }

  // === Sign Out ===

  signOut(provider: 'claude' | 'openai'): void {
    if (provider === 'claude') {
      this.oauthToken = null
      this.oauthExpiresAt = 0
      this.claudeLoggedIn = false
      this.claudeAuthChecked = true
      this.claudeAuthEmail = undefined
      if (process.platform === 'darwin') {
        try { execFileSync('security', ['delete-generic-password', '-s', 'Oculo-credentials'], { timeout: 5000 }) } catch {}
      } else {
        try {
          const dataDir = path.join(os.homedir(), '.oculo-data')
          const encPath = path.join(dataDir, 'claude-oauth.enc')
          const jsonPath = path.join(dataDir, 'claude-oauth.json')
          if (existsSync(encPath)) { unlinkSync(encPath) }
          if (existsSync(jsonPath)) { unlinkSync(jsonPath) }
        } catch {}
      }
    } else if (provider === 'openai') {
      this.signOutCodex()
    }
  }

  // === In-App OAuth PKCE Flows ===

  async startClaudeAuth(): Promise<{ success: boolean; error?: string }> {
    const clientId = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
    const scope = 'user:inference user:mcp_servers user:profile user:sessions:claude_code'
    const tokenUrl = 'https://platform.claude.com/v1/oauth/token'
    const authorizeUrl = 'https://claude.ai/oauth/authorize'

    return this.runOAuthPKCE({
      clientId,
      scope,
      authorizeUrl,
      tokenUrl,
      callbackPath: '/oauth/code/callback',
      provider: 'claude',
      onTokens: (tokens) => {
        const creds = {
          claudeAiOauth: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token || null,
            expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : 0,
            scopes: scope.split(' '),
            subscriptionType: tokens.subscription_type || 'subscription'
          }
        }
        if (process.platform === 'darwin') {
          try {
            const credJson = JSON.stringify(creds)
            execFileSync('security', [
              'add-generic-password', '-s', 'Oculo-credentials',
              '-a', 'default', '-w', credJson, '-U'
            ], { timeout: 5000 })
          } catch {
            try {
              execFileSync('security', ['delete-generic-password', '-s', 'Oculo-credentials'], { timeout: 5000 })
              execFileSync('security', [
                'add-generic-password', '-s', 'Oculo-credentials',
                '-a', 'default', '-w', JSON.stringify(creds)
              ], { timeout: 5000 })
            } catch { /* keychain write failed */ }
          }
        } else {
          try {
            const credJson = JSON.stringify(creds)
            const dataDir = path.join(os.homedir(), '.oculo-data')
            if (!existsSync(dataDir)) {
              mkdirSync(dataDir, { recursive: true })
            }
            if (safeStorage.isEncryptionAvailable()) {
              const encrypted = safeStorage.encryptString(credJson)
              writeFileSync(path.join(dataDir, 'claude-oauth.enc'), encrypted)
            } else {
              console.warn('[Oculo] safeStorage unavailable — Claude OAuth credentials will not persist (memory only)')
            }
          } catch { /* storage write failed */ }
        }
        this.oauthToken = tokens.access_token
        this.oauthExpiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : 0
        this.claudeLoggedIn = true
        this.claudeAuthChecked = true
        this.claudeAuthEmail = `Claude ${tokens.subscription_type || ''} subscription`.replace(/\s+/g, ' ').trim()
      }
    })
  }
}
