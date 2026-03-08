import { app, session as electronSession, net, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')

export interface ProxyConfig {
  type: 'http' | 'https' | 'socks4' | 'socks5' | 'direct'
  host: string
  port: number
  username?: string
  password?: string
  /** Bypass list — domains that should NOT use proxy */
  bypass?: string[]
}

/**
 * ProxyManager — configures HTTP/SOCKS proxies on the webview session (`persist:oculo`).
 *
 * Uses Electron's `session.setProxy()` API for seamless per-session proxy support.
 * Proxy config is persisted in settings.json alongside other app settings.
 */
export class ProxyManager {
  private config: ProxyConfig | null = null
  private readonly sessionPartition = 'persist:oculo'
  private loginHandler: ((...args: any[]) => void) | null = null

  constructor() {
    this.loadFromSettings()
  }

  /**
   * Set a proxy on the webview session.
   * Immediately applies via `session.setProxy()` and persists to settings.json.
   */
  async setProxy(config: ProxyConfig): Promise<void> {
    // Always clean up old handler first to prevent memory leaks
    if (this.loginHandler) {
      app.removeListener('login', this.loginHandler)
      this.loginHandler = null
    }

    this.config = config

    const webviewSession = electronSession.fromPartition(this.sessionPartition)
    const proxyRules = this.buildProxyRules(config)
    const bypassRules = config.bypass?.join(',') || ''

    await webviewSession.setProxy({
      proxyRules,
      proxyBypassRules: bypassRules || undefined
    })

    // Handle authentication for proxies that require it
    if (config.username && config.password) {
      this.loginHandler = (event, _webContents, _request, authInfo, callback) => {
        if (authInfo.isProxy) {
          event.preventDefault()
          callback(config.username!, config.password!)
        }
      }
      app.on('login', this.loginHandler)
    }

    this.saveToSettings()
    console.log(`[ProxyManager] Proxy set: ${config.type}://${config.host}:${config.port}`)
  }

  /**
   * Clear the proxy — revert to direct connection.
   */
  async clearProxy(): Promise<void> {
    this.config = null

    const webviewSession = electronSession.fromPartition(this.sessionPartition)
    await webviewSession.setProxy({ proxyRules: '' })
    if (this.loginHandler) {
      app.removeListener('login', this.loginHandler)
      this.loginHandler = null
    }

    this.saveToSettings()
    console.log('[ProxyManager] Proxy cleared — direct connection')
  }

  /**
   * Get the current proxy configuration, or null if no proxy is set.
   */
  getProxy(): ProxyConfig | null {
    return this.config ? { ...this.config } : null
  }

  /**
   * Test the proxy by making a request to an IP-echo service.
   * Returns the visible IP address through the proxy.
   */
  async testProxy(testUrl?: string): Promise<{ success: boolean; ip?: string; error?: string }> {
    try {
      const response = await new Promise<string>((resolve, reject) => {
        const url = testUrl || 'https://api.ipify.org?format=json'
        const request = net.request({
          url,
          partition: this.sessionPartition
        })

        let timeoutId: NodeJS.Timeout | null = null
        let data = ''
        request.on('response', (response) => {
          if (timeoutId) clearTimeout(timeoutId)
          response.on('data', (chunk) => { data += chunk.toString() })
          response.on('end', () => resolve(data))
          response.on('error', (err) => reject(err))
        })
        request.on('error', (err) => {
          if (timeoutId) clearTimeout(timeoutId)
          reject(err)
        })

        // 10 second timeout
        timeoutId = setTimeout(() => {
          timeoutId = null
          request.abort()
          reject(new Error('Proxy test timed out after 10 seconds'))
        }, 10_000)

        request.end()
      })

      const parsed = JSON.parse(response)
      return { success: true, ip: parsed.ip }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  /**
   * Build Electron proxy rules string from ProxyConfig.
   * Format: "http=http://host:port;https=http://host:port" or "socks5://host:port"
   */
  private buildProxyRules(config: ProxyConfig): string {
    if (config.type === 'direct') return 'direct://'

    const scheme = config.type // http, https, socks4, socks5
    const proxyUrl = `${scheme}://${config.host}:${config.port}`

    // SOCKS proxies handle all protocols
    if (config.type === 'socks4' || config.type === 'socks5') {
      return proxyUrl
    }

    // HTTP/HTTPS proxies — route both http and https through them
    return `http=${proxyUrl};https=${proxyUrl}`
  }

  /**
   * Load proxy config from settings.json on startup.
   * If a saved proxy exists, apply it immediately.
   */
  private loadFromSettings(): void {
    try {
      if (!existsSync(SETTINGS_FILE)) return
      const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'))
      if (data.proxyConfig) {
        const saved = data.proxyConfig
        // Decrypt credentials if they were encrypted
        if (saved._encrypted && safeStorage.isEncryptionAvailable()) {
          saved.username = safeStorage.decryptString(Buffer.from(saved.username, 'base64'))
          saved.password = saved.password ? safeStorage.decryptString(Buffer.from(saved.password, 'base64')) : undefined
          delete saved._encrypted
        }
        this.config = saved
        // Apply the saved proxy asynchronously (app may not be fully ready yet)
        // We schedule this to run after the session is available
        process.nextTick(() => {
          this.setProxy(this.config!).catch((err) => {
            console.error('[ProxyManager] Failed to restore saved proxy:', err)
          })
        })
      }
    } catch {
      // settings not available yet, no proxy
    }
  }

  /**
   * Persist proxy config to settings.json.
   */
  private saveToSettings(): void {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      let settings: Record<string, unknown> = {}
      if (existsSync(SETTINGS_FILE)) {
        settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'))
      }

      if (this.config) {
        const configToSave: Record<string, unknown> = { ...this.config }
        if (configToSave.username && safeStorage.isEncryptionAvailable()) {
          configToSave.username = safeStorage.encryptString(configToSave.username as string).toString('base64')
          configToSave.password = configToSave.password ? safeStorage.encryptString(configToSave.password as string).toString('base64') : undefined
          configToSave._encrypted = true
        }
        settings.proxyConfig = configToSave
      } else {
        delete settings.proxyConfig
      }

      writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
    } catch (err) {
      console.error('[ProxyManager] Failed to save proxy settings:', err)
    }
  }
}
