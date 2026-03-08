/**
 * Codex (OpenAI) OAuth — base class used by oauth-manager.ts.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import crypto from 'crypto'
import http from 'http'
import https from 'https'
import path from 'path'
import os from 'os'
import { AIProviderConfig, AIProviderId } from '../../shared/ai-types'
import { IPC } from '../../shared/ipc-channels'

/** Escape HTML special characters to prevent XSS in OAuth callback pages */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Decode JWT payload without verification (for extracting expiry/claims) */
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  } catch { return null }
}

export abstract class CodexOAuthBase {
  // Codex state
  codexToken: string | null = null
  codexRefreshToken: string | null = null
  codexTokenExpiresAt: number = 0
  codexEmail: string | undefined
  codexPlan: string | undefined

  protected pendingAuthServer: http.Server | null = null
  protected abstract getMainWindow(): { webContents: { send: (...args: any[]) => void }; isDestroyed: () => boolean } | null

  // === Codex Token Management ===

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
        const payload = decodeJwtPayload(tokens.access_token)
        if (payload) {
          this.codexTokenExpiresAt = (payload.exp || 0) * 1000
          const auth = payload['https://api.openai.com/auth'] || {}
          const profile = payload['https://api.openai.com/profile'] || {}
          this.codexPlan = auth.chatgpt_plan_type
          this.codexEmail = profile.email
        }
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
              const payload = decodeJwtPayload(result.access_token)
              if (payload) this.codexTokenExpiresAt = (payload.exp || 0) * 1000
              try {
                const authPath = path.join(os.homedir(), '.codex', 'auth.json')
                const existing = JSON.parse(readFileSync(authPath, 'utf-8'))
                existing.tokens.access_token = result.access_token
                if (result.refresh_token) existing.tokens.refresh_token = result.refresh_token
                if (result.id_token) existing.tokens.id_token = result.id_token
                existing.last_refresh = new Date().toISOString()
                writeFileSync(authPath, JSON.stringify(existing, null, 2), { mode: 0o600 })
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

  signOutCodex(): void {
    this.codexToken = null
    this.codexRefreshToken = null
    this.codexTokenExpiresAt = 0
    this.codexEmail = undefined
    this.codexPlan = undefined
    try {
      const authPath = path.join(os.homedir(), '.codex', 'auth.json')
      if (existsSync(authPath)) { unlinkSync(authPath) }
    } catch {}
  }

  async startCodexAuth(): Promise<{ success: boolean; error?: string }> {
    const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann'
    const scope = 'openid profile email offline_access'
    const tokenUrl = 'https://auth.openai.com/oauth/token'
    const authorizeUrl = 'https://auth.openai.com/oauth/authorize'

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
            mkdirSync(dir, { recursive: true })
          }
          writeFileSync(path.join(dir, 'auth.json'), JSON.stringify(authData, null, 2), { mode: 0o600 })
        } catch { /* disk write failed */ }

        this.codexToken = tokens.access_token
        this.codexRefreshToken = tokens.refresh_token || null
        const payload = decodeJwtPayload(tokens.access_token)
        if (payload) {
          this.codexTokenExpiresAt = (payload.exp || 0) * 1000
          const auth = payload['https://api.openai.com/auth'] || {}
          const profile = payload['https://api.openai.com/profile'] || {}
          this.codexPlan = auth.chatgpt_plan_type
          this.codexEmail = profile.email
        }
      }
    })
  }

  // === Shared PKCE Flow ===

  protected async runOAuthPKCE(opts: {
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
        const pathname = url.pathname.replace(/\/+$/, '') // strip trailing slashes
        if (pathname !== opts.callbackPath) {
          res.writeHead(404); res.end('Not found'); return
        }

        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        const returnedState = url.searchParams.get('state')

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Authentication Failed</h2><p>' + esc(error) + '</p><p>You can close this window.</p></body></html>')
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
                res.end('<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;background:#0a0a12;color:#22d3ee"><div style="text-align:center"><h2>Authenticated!</h2><p style="color:#aaa">Signing you in...</p></div></body></html>')
                // Auto-close the auth tab
                const win = this.getMainWindow()
                if (win && !win.isDestroyed()) {
                  win.webContents.send(IPC.TAB_CLOSE_BY_URL, `http://localhost:${(server.address() as any).port}`)
                }
                cleanup()
                resolve({ success: true })
              } else {
                res.writeHead(200, { 'Content-Type': 'text/html' })
                res.end('<html><body><h2>Token Exchange Failed</h2><p>' + esc(tokens.error_description || tokens.error || 'Unknown error') + '</p></body></html>')
                cleanup()
                resolve({ success: false, error: tokens.error_description || tokens.error || 'Token exchange failed' })
              }
            } catch (e: any) {
              res.writeHead(500, { 'Content-Type': 'text/html' })
              res.end('<html><body><h2>Error</h2><p>' + esc(e.message) + '</p></body></html>')
              cleanup()
              resolve({ success: false, error: e.message })
            }
          })
        })
        tokenReq.on('error', (e) => {
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end('<html><body><h2>Connection Error</h2><p>' + esc(e.message) + '</p></body></html>')
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
      }

      server.on('error', (err: any) => {
        cleanup()
        resolve({ success: false, error: err.code === 'EADDRINUSE' ? 'Auth port 1455 is in use. Close other auth flows and retry.' : `Auth server error: ${err.message}` })
      })

      server.listen(1455, '127.0.0.1', () => {
        const port = (server.address() as any).port
        const redirectUri = `http://localhost:${port}${opts.callbackPath}`

        const authUrl = `${opts.authorizeUrl}?` + new URLSearchParams({
          response_type: 'code',
          client_id: opts.clientId,
          redirect_uri: redirectUri,
          scope: opts.scope,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          id_token_add_organizations: 'true',
          codex_cli_simplified_flow: 'true',
          state,
          originator: 'codex_cli_rs'
        }).toString()

        console.log('[OAuth] Auth URL:', authUrl)

        // Open auth URL in Oculo's own webview tab
        const win = this.getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.TAB_CREATE, authUrl)
        }

        setTimeout(() => {
          if (this.pendingAuthServer === server) {
            cleanup()
            resolve({ success: false, error: 'Authentication timed out' })
          }
        }, 300_000)
      })
    })
  }
}
