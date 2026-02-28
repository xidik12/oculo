import { execFileSync, execFile } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import crypto from 'crypto'
import http from 'http'
import https from 'https'
import path from 'path'
import os from 'os'
import { BrowserWindow, safeStorage } from 'electron'
import { AIProviderConfig, AIProviderId } from '../../shared/ai-types'

/**
 * Full OAuth manager — handles Claude CLI subscription (macOS Keychain) and
 * OpenAI Codex CLI subscription (~/.codex/auth.json), plus in-app PKCE flows.
 *
 * This file is ONLY included in private/owner builds.
 * Public builds use oauth-stub.ts instead (via Vite alias).
 */
export class OAuthManager {
  oauthToken: string | null = null
  oauthExpiresAt: number = 0
  claudeLoggedIn: boolean = false
  claudeAuthChecked: boolean = false
  claudeAuthEmail: string | undefined
  codexToken: string | null = null
  codexRefreshToken: string | null = null
  codexTokenExpiresAt: number = 0
  codexEmail: string | undefined
  codexPlan: string | undefined

  private mainWindow: BrowserWindow | null = null
  private pendingAuthServer: http.Server | null = null

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  // === Claude OAuth Token (macOS: Keychain, Windows/Linux: safeStorage file) ===

  loadOAuthToken(): void {
    let creds: any = null

    if (process.platform === 'darwin') {
      try {
        const raw = execFileSync('security', [
          'find-generic-password', '-s', 'Claude Code-credentials', '-w'
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

  // === Codex (OpenAI) OAuth Token ===

  loadCodexToken(providerConfigs?: Map<AIProviderId, AIProviderConfig>): void {
    try {
      const authPath = path.join(os.homedir(), '.codex', 'auth.json')
      if (!existsSync(authPath)) return
      const raw = readFileSync(authPath, 'utf-8')
      const data = JSON.parse(raw)

      const tokens = data?.tokens
      if (tokens?.access_token) {
        this.codexToken = tokens.access_token
        this.codexRefreshToken = tokens.refresh_token || null
        try {
          const parts = tokens.access_token.split('.')
          if (parts.length >= 2) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
            this.codexTokenExpiresAt = (payload.exp || 0) * 1000
            const auth = payload['https://api.openai.com/auth'] || {}
            const profile = payload['https://api.openai.com/profile'] || {}
            this.codexPlan = auth.chatgpt_plan_type
            this.codexEmail = profile.email
          }
        } catch { /* JWT decode failed */ }
        return
      }

      if (providerConfigs && data?.OPENAI_API_KEY && typeof data.OPENAI_API_KEY === 'string' && data.OPENAI_API_KEY.length > 10) {
        if (!providerConfigs.has('openai')) {
          providerConfigs.set('openai', { providerId: 'openai', enabled: true, apiKey: data.OPENAI_API_KEY })
        } else {
          const config = providerConfigs.get('openai')!
          if (!config.apiKey) {
            config.apiKey = data.OPENAI_API_KEY
            config.enabled = true
          }
        }
        this.codexEmail = 'Codex CLI (API Key)'
      }
    } catch { /* auth.json not available */ }
  }

  private async refreshCodexToken(): Promise<boolean> {
    if (!this.codexRefreshToken) return false

    const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann'
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.codexRefreshToken,
      client_id: clientId
    }).toString()

    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'auth.openai.com',
        port: 443,
        path: '/oauth/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          try {
            const result = JSON.parse(data)
            if (result.access_token) {
              this.codexToken = result.access_token
              if (result.refresh_token) this.codexRefreshToken = result.refresh_token
              try {
                const parts = result.access_token.split('.')
                if (parts.length >= 2) {
                  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
                  this.codexTokenExpiresAt = (payload.exp || 0) * 1000
                }
              } catch { /* ignore */ }
              try {
                const authPath = path.join(os.homedir(), '.codex', 'auth.json')
                const existing = JSON.parse(readFileSync(authPath, 'utf-8'))
                existing.tokens.access_token = result.access_token
                if (result.refresh_token) existing.tokens.refresh_token = result.refresh_token
                if (result.id_token) existing.tokens.id_token = result.id_token
                existing.last_refresh = new Date().toISOString()
                writeFileSync(authPath, JSON.stringify(existing, null, 2))
              } catch { /* disk write failed */ }
              resolve(true)
            } else {
              resolve(false)
            }
          } catch { resolve(false) }
        })
      })
      req.on('error', () => resolve(false))
      req.setTimeout(10_000, () => { req.destroy(); resolve(false) })
      req.write(body)
      req.end()
    })
  }

  async getCodexToken(): Promise<string | null> {
    if (!this.codexToken) return null
    if (this.codexTokenExpiresAt > 0 && Date.now() > this.codexTokenExpiresAt - 300_000) {
      const refreshed = await this.refreshCodexToken()
      if (!refreshed) {
        this.loadCodexToken()
        if (this.codexTokenExpiresAt > 0 && Date.now() > this.codexTokenExpiresAt - 300_000) {
          return null
        }
      }
    }
    return this.codexToken
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
      // Remove stored credentials
      if (process.platform === 'darwin') {
        try { execFileSync('security', ['delete-generic-password', '-s', 'Claude Code-credentials'], { timeout: 5000 }) } catch {}
      } else {
        try {
          const dataDir = path.join(os.homedir(), '.oculo-data')
          const encPath = path.join(dataDir, 'claude-oauth.enc')
          const jsonPath = path.join(dataDir, 'claude-oauth.json')
          if (existsSync(encPath)) { const { unlinkSync } = require('fs'); unlinkSync(encPath) }
          if (existsSync(jsonPath)) { const { unlinkSync } = require('fs'); unlinkSync(jsonPath) }
        } catch {}
      }
    } else if (provider === 'openai') {
      this.codexToken = null
      this.codexRefreshToken = null
      this.codexTokenExpiresAt = 0
      this.codexEmail = undefined
      this.codexPlan = undefined
      // Remove stored credentials
      try {
        const authPath = path.join(os.homedir(), '.codex', 'auth.json')
        if (existsSync(authPath)) { const { unlinkSync } = require('fs'); unlinkSync(authPath) }
      } catch {}
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
            subscriptionType: 'subscription'
          }
        }
        if (process.platform === 'darwin') {
          try {
            const credJson = JSON.stringify(creds)
            execFileSync('security', [
              'add-generic-password', '-s', 'Claude Code-credentials',
              '-a', 'default', '-w', credJson, '-U'
            ], { timeout: 5000 })
          } catch {
            try {
              execFileSync('security', ['delete-generic-password', '-s', 'Claude Code-credentials'], { timeout: 5000 })
              execFileSync('security', [
                'add-generic-password', '-s', 'Claude Code-credentials',
                '-a', 'default', '-w', JSON.stringify(creds)
              ], { timeout: 5000 })
            } catch { /* keychain write failed */ }
          }
        } else {
          try {
            const credJson = JSON.stringify(creds)
            const dataDir = path.join(os.homedir(), '.oculo-data')
            if (!existsSync(dataDir)) {
              const { mkdirSync } = require('fs')
              mkdirSync(dataDir, { recursive: true })
            }
            if (safeStorage.isEncryptionAvailable()) {
              const encrypted = safeStorage.encryptString(credJson)
              writeFileSync(path.join(dataDir, 'claude-oauth.enc'), encrypted)
            } else {
              writeFileSync(path.join(dataDir, 'claude-oauth.json'), credJson)
            }
          } catch { /* storage write failed */ }
        }
        this.oauthToken = tokens.access_token
        this.oauthExpiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : 0
        this.claudeLoggedIn = true
        this.claudeAuthChecked = true
        this.claudeAuthEmail = 'Claude subscription'
      }
    })
  }

  async startCodexAuth(): Promise<{ success: boolean; error?: string }> {
    const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann'
    const scope = 'openid profile email offline_access'
    const tokenUrl = 'https://auth0.openai.com/oauth/token'
    const authorizeUrl = 'https://auth.openai.com/authorize'

    return this.runOAuthPKCE({
      clientId,
      scope,
      authorizeUrl,
      tokenUrl,
      callbackPath: '/auth/callback',
      provider: 'openai',
      onTokens: (tokens) => {
        const authData = {
          OPENAI_API_KEY: null,
          tokens: {
            id_token: tokens.id_token || null,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || null,
            account_id: null
          },
          last_refresh: new Date().toISOString()
        }
        try {
          const dir = path.join(os.homedir(), '.codex')
          if (!existsSync(dir)) {
            const { mkdirSync } = require('fs')
            mkdirSync(dir, { recursive: true })
          }
          writeFileSync(path.join(dir, 'auth.json'), JSON.stringify(authData, null, 2))
        } catch { /* disk write failed */ }

        this.codexToken = tokens.access_token
        this.codexRefreshToken = tokens.refresh_token || null
        try {
          const parts = tokens.access_token.split('.')
          if (parts.length >= 2) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
            this.codexTokenExpiresAt = (payload.exp || 0) * 1000
            const auth = payload['https://api.openai.com/auth'] || {}
            const profile = payload['https://api.openai.com/profile'] || {}
            this.codexPlan = auth.chatgpt_plan_type
            this.codexEmail = profile.email
          }
        } catch { /* JWT decode failed */ }
      }
    })
  }

  private async runOAuthPKCE(opts: {
    clientId: string
    scope: string
    authorizeUrl: string
    tokenUrl: string
    callbackPath: string
    provider: string
    onTokens: (tokens: any) => void
  }): Promise<{ success: boolean; error?: string }> {
    if (this.pendingAuthServer) {
      try { this.pendingAuthServer.close() } catch {}
      this.pendingAuthServer = null
    }

    const verifier = crypto.randomBytes(64).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
    const state = crypto.randomBytes(16).toString('hex')

    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost`)
        if (!url.pathname.endsWith(opts.callbackPath.replace(/^\//, '').split('/').pop() || 'callback')) {
          res.writeHead(404); res.end('Not found'); return
        }

        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        const returnedState = url.searchParams.get('state')

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Authentication Failed</h2><p>' + error + '</p><p>You can close this window.</p></body></html>')
          cleanup()
          resolve({ success: false, error })
          return
        }

        if (!code || returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Invalid response</h2><p>Missing code or state mismatch.</p></body></html>')
          return
        }

        const redirectUri = `http://localhost:${(server.address() as any).port}${opts.callbackPath}`
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: opts.clientId,
          code_verifier: verifier
        }).toString()

        const tokenUrlParsed = new URL(opts.tokenUrl)
        const tokenReq = https.request({
          hostname: tokenUrlParsed.hostname,
          port: 443,
          path: tokenUrlParsed.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body)
          }
        }, (tokenRes) => {
          let data = ''
          tokenRes.on('data', c => { data += c })
          tokenRes.on('end', () => {
            try {
              const tokens = JSON.parse(data)
              if (tokens.access_token) {
                opts.onTokens(tokens)
                res.writeHead(200, { 'Content-Type': 'text/html' })
                res.end('<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;background:#0a0a12;color:#22d3ee"><div style="text-align:center"><h2>Authenticated!</h2><p style="color:#aaa">You can close this window and return to Oculo.</p></div></body></html>')
                cleanup()
                resolve({ success: true })
              } else {
                res.writeHead(200, { 'Content-Type': 'text/html' })
                res.end('<html><body><h2>Token Exchange Failed</h2><p>' + (tokens.error_description || tokens.error || 'Unknown error') + '</p></body></html>')
                cleanup()
                resolve({ success: false, error: tokens.error_description || tokens.error || 'Token exchange failed' })
              }
            } catch (e: any) {
              res.writeHead(500, { 'Content-Type': 'text/html' })
              res.end('<html><body><h2>Error</h2><p>' + e.message + '</p></body></html>')
              cleanup()
              resolve({ success: false, error: e.message })
            }
          })
        })
        tokenReq.on('error', (e) => {
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Connection Error</h2><p>' + e.message + '</p></body></html>')
          cleanup()
          resolve({ success: false, error: e.message })
        })
        tokenReq.write(body)
        tokenReq.end()
      })

      this.pendingAuthServer = server

      const cleanup = () => {
        try { server.close() } catch {}
        this.pendingAuthServer = null
        if (authWindow && !authWindow.isDestroyed()) authWindow.close()
      }

      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as any).port
        const redirectUri = `http://localhost:${port}${opts.callbackPath}`

        const authUrl = `${opts.authorizeUrl}?` + new URLSearchParams({
          response_type: 'code',
          client_id: opts.clientId,
          redirect_uri: redirectUri,
          scope: opts.scope,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state
        }).toString()

        authWindow = new BrowserWindow({
          width: 600,
          height: 700,
          title: `Sign in to ${opts.provider === 'claude' ? 'Claude' : 'OpenAI'}`,
          parent: this.mainWindow!,
          modal: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        })

        authWindow.loadURL(authUrl)

        authWindow.on('closed', () => {
          authWindow = null
          if (this.pendingAuthServer === server) {
            cleanup()
            resolve({ success: false, error: 'Authentication window closed' })
          }
        })

        setTimeout(() => {
          if (this.pendingAuthServer === server) {
            cleanup()
            resolve({ success: false, error: 'Authentication timed out' })
          }
        }, 300_000)
      })

      let authWindow: BrowserWindow | null = null
    })
  }
}
