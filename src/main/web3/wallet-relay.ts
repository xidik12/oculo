/**
 * Oculo Web3 Wallet Relay Server
 *
 * A local HTTP + WebSocket server that bridges dApps running in Oculo with
 * MetaMask (or any EIP-1193 wallet) running in Chrome.
 *
 * Architecture:
 *   dApp in Oculo  <-->  WebSocket  <-->  Relay Server  <-->  WebSocket  <-->  Chrome relay page  <-->  MetaMask
 *
 * The relay server:
 *   1. Runs on localhost:19517 (one above the MCP server)
 *   2. Serves a relay HTML page at GET /relay
 *   3. Accepts WebSocket connections from Oculo (requester) and Chrome (signer)
 *   4. Forwards JSON-RPC requests from Oculo to Chrome and responses back
 */

import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { shell, BrowserWindow } from 'electron'

const RELAY_PORT = 19517
const REQUEST_TIMEOUT_MS = 60_000 // 60 seconds for user to approve in MetaMask

/** Status of the relay system */
export interface WalletRelayStatus {
  running: boolean
  port: number
  chromeConnected: boolean
  oculoClients: number
}

/**
 * The relay HTML page served to Chrome.
 * When opened, it connects back to ws://localhost:19517, receives JSON-RPC
 * requests, forwards them to MetaMask via window.ethereum, and returns results.
 */
function getRelayHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Oculo Wallet Relay</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a12;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 480px;
      width: 100%;
      text-align: center;
    }
    .logo {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
      background: linear-gradient(135deg, #818cf8, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      color: #94a3b8;
      font-size: 14px;
      margin-bottom: 32px;
    }
    .status-card {
      background: #1e1e2e;
      border: 1px solid #2d2d3f;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
    }
    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 16px;
      font-weight: 500;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot.connecting { background: #f59e0b; animation: pulse 1.5s infinite; }
    .dot.connected { background: #22c55e; }
    .dot.signing { background: #818cf8; animation: pulse 0.8s infinite; }
    .dot.error { background: #ef4444; }
    .dot.no-wallet { background: #ef4444; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .log {
      background: #0f0f1a;
      border: 1px solid #2d2d3f;
      border-radius: 8px;
      padding: 16px;
      margin-top: 16px;
      text-align: left;
      max-height: 200px;
      overflow-y: auto;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
      color: #94a3b8;
    }
    .log-entry { margin-bottom: 4px; }
    .log-entry.success { color: #22c55e; }
    .log-entry.error { color: #ef4444; }
    .log-entry.info { color: #818cf8; }
    .wallet-info {
      margin-top: 16px;
      padding: 12px;
      background: #1a1a2e;
      border-radius: 8px;
      font-size: 13px;
      color: #94a3b8;
    }
    .wallet-info .address {
      font-family: 'SF Mono', monospace;
      color: #818cf8;
      font-size: 12px;
      word-break: break-all;
    }
    .auto-close-notice {
      margin-top: 24px;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">&#128256;</div>
    <h1>Oculo Wallet Relay</h1>
    <p class="subtitle">Bridging your wallet to Oculo browser</p>

    <div class="status-card">
      <div class="status-indicator">
        <span class="dot" id="statusDot"></span>
        <span id="statusText">Initializing...</span>
      </div>
      <div class="wallet-info" id="walletInfo" style="display:none">
        <div>Connected wallet:</div>
        <div class="address" id="walletAddress"></div>
        <div style="margin-top:8px" id="chainInfo"></div>
      </div>
    </div>

    <div class="log" id="log"></div>

    <p class="auto-close-notice">
      This page auto-closes after 5 minutes of inactivity.
    </p>
  </div>

  <script>
    const logEl = document.getElementById('log');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const walletInfo = document.getElementById('walletInfo');
    const walletAddress = document.getElementById('walletAddress');
    const chainInfo = document.getElementById('chainInfo');

    let inactivityTimer = null;
    let ws = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 10;

    function addLog(msg, type = '') {
      const entry = document.createElement('div');
      entry.className = 'log-entry ' + type;
      entry.textContent = new Date().toLocaleTimeString() + ' ' + msg;
      logEl.appendChild(entry);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function setStatus(status, text) {
      statusDot.className = 'dot ' + status;
      statusText.textContent = text;
    }

    function resetInactivityTimer() {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        addLog('Auto-closing due to inactivity', 'info');
        if (ws) ws.close();
        setTimeout(() => window.close(), 1000);
      }, 5 * 60 * 1000); // 5 minutes
    }

    async function checkWallet() {
      if (typeof window.ethereum === 'undefined') {
        setStatus('no-wallet', 'No wallet detected');
        addLog('MetaMask or compatible wallet not found in this browser', 'error');
        addLog('Install MetaMask extension and refresh this page', 'info');
        return false;
      }
      addLog('Wallet provider detected', 'success');
      return true;
    }

    async function getWalletState() {
      try {
        // Use eth_requestAccounts to trigger MetaMask connection popup
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        return { accounts, chainId };
      } catch {
        // Fallback to eth_accounts if user rejects
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          const chainId = await window.ethereum.request({ method: 'eth_chainId' });
          return { accounts, chainId };
        } catch {
          return { accounts: [], chainId: '0x1' };
        }
      }
    }

    async function connectWS() {
      if (!(await checkWallet())) return;

      setStatus('connecting', 'Connecting to Oculo...');
      addLog('Connecting to relay server...', 'info');

      ws = new WebSocket('ws://localhost:${RELAY_PORT}');

      ws.onopen = async () => {
        reconnectAttempts = 0;
        setStatus('connected', 'Connected - Ready');
        addLog('Connected to Oculo relay server', 'success');

        // Send initial wallet state
        const state = await getWalletState();
        ws.send(JSON.stringify({
          type: 'signer-ready',
          accounts: state.accounts,
          chainId: state.chainId
        }));

        if (state.accounts.length > 0) {
          walletInfo.style.display = 'block';
          walletAddress.textContent = state.accounts[0];
          chainInfo.textContent = 'Chain: ' + state.chainId;
        }

        resetInactivityTimer();
      };

      ws.onmessage = async (event) => {
        resetInactivityTimer();
        let request;
        try {
          request = JSON.parse(event.data);
        } catch {
          addLog('Invalid message received', 'error');
          return;
        }

        // Only handle RPC requests (have id + method)
        if (!request.id || !request.method) return;

        setStatus('signing', 'Processing: ' + request.method);
        addLog('Request: ' + request.method, 'info');

        try {
          const result = await window.ethereum.request({
            method: request.method,
            params: request.params || []
          });

          ws.send(JSON.stringify({
            type: 'rpc-response',
            id: request.id,
            result: result
          }));

          addLog('Success: ' + request.method, 'success');

          // Update display if accounts changed
          if (request.method === 'eth_requestAccounts' || request.method === 'eth_accounts') {
            if (Array.isArray(result) && result.length > 0) {
              walletInfo.style.display = 'block';
              walletAddress.textContent = result[0];
            }
          }
          if (request.method === 'eth_chainId') {
            chainInfo.textContent = 'Chain: ' + result;
          }
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'rpc-response',
            id: request.id,
            error: {
              code: err.code || -32603,
              message: err.message || 'Unknown error'
            }
          }));
          addLog('Error: ' + (err.message || 'Unknown'), 'error');
        }

        setStatus('connected', 'Connected - Ready');
      };

      ws.onclose = () => {
        setStatus('connecting', 'Disconnected');
        addLog('Disconnected from relay server', 'error');

        if (reconnectAttempts < MAX_RECONNECT) {
          reconnectAttempts++;
          const delay = Math.min(1000 * reconnectAttempts, 5000);
          addLog('Reconnecting in ' + (delay / 1000) + 's...', 'info');
          setTimeout(connectWS, delay);
        } else {
          setStatus('error', 'Connection failed');
          addLog('Max reconnection attempts reached', 'error');
        }
      };

      ws.onerror = () => {
        // onclose will handle reconnection
      };

      // Listen for MetaMask events and forward them
      if (window.ethereum) {
        window.ethereum.on('accountsChanged', (accounts) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'event', event: 'accountsChanged', data: accounts }));
            addLog('Accounts changed', 'info');
            if (accounts.length > 0) {
              walletAddress.textContent = accounts[0];
            }
          }
        });

        window.ethereum.on('chainChanged', (chainId) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'event', event: 'chainChanged', data: chainId }));
            addLog('Chain changed to ' + chainId, 'info');
            chainInfo.textContent = 'Chain: ' + chainId;
          }
        });

        window.ethereum.on('disconnect', () => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'event', event: 'disconnect', data: null }));
            addLog('Wallet disconnected', 'error');
          }
        });
      }
    }

    // Start
    connectWS();
  </script>
</body>
</html>`
}

export class WalletRelayServer {
  private httpServer: http.Server | null = null
  private wss: WebSocketServer | null = null
  private signerSocket: WebSocket | null = null
  private oculoClients = new Set<WebSocket>()
  private pendingRequests = new Map<number, {
    oculoWs: WebSocket | null
    timer: ReturnType<typeof setTimeout>
    ipcResolve?: (value: any) => void
  }>()
  private running = false
  private mainWindow: BrowserWindow | null = null

  // Cached wallet state from signer
  private connectedAccounts: string[] = []
  private connectedChainId: string = '0x1'

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  /** Start the relay server */
  async start(): Promise<void> {
    if (this.running) return

    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        if (req.url === '/relay' && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store'
          })
          res.end(getRelayHTML())
          return
        }

        if (req.url === '/status' && req.method === 'GET') {
          const status = this.getStatus()
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          })
          res.end(JSON.stringify({
            ...status,
            accounts: this.connectedAccounts,
            chainId: this.connectedChainId
          }))
          return
        }

        // CORS preflight for /rpc
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
          })
          res.end()
          return
        }

        // HTTP RPC endpoint -- accepts POST with JSON-RPC request, returns response
        if (req.url === '/rpc' && req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', async () => {
            try {
              const request = JSON.parse(body)
              const result = await this.handleIpcRpcRequest(request)
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              })
              res.end(JSON.stringify(result))
            } catch (err: any) {
              res.writeHead(500, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              })
              res.end(JSON.stringify({ error: { code: -32603, message: err.message } }))
            }
          })
          return
        }

        res.writeHead(404)
        res.end('Not Found')
      })

      this.wss = new WebSocketServer({ server: this.httpServer })

      this.wss.on('connection', (ws) => {
        console.log('[WalletRelay] New WebSocket connection')

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString())
            this.handleMessage(ws, msg)
          } catch (err) {
            console.error('[WalletRelay] Invalid message:', err)
          }
        })

        ws.on('close', () => {
          if (ws === this.signerSocket) {
            console.log('[WalletRelay] Chrome signer disconnected')
            this.signerSocket = null
            this.connectedAccounts = []
            // Notify all Oculo clients that signer disconnected
            for (const client of this.oculoClients) {
              this.safeSend(client, { type: 'event', event: 'disconnect', data: null })
            }
            this.sendToast('Wallet relay disconnected', 'warning')
          } else {
            this.oculoClients.delete(ws)
            console.log(`[WalletRelay] Oculo client disconnected (${this.oculoClients.size} remaining)`)
          }
        })

        ws.on('error', (err) => {
          console.error('[WalletRelay] WebSocket error:', err.message)
        })
      })

      this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[WalletRelay] Port ${RELAY_PORT} in use, relay server not started`)
          reject(new Error(`Port ${RELAY_PORT} in use`))
        } else {
          reject(err)
        }
      })

      this.httpServer.listen(RELAY_PORT, '127.0.0.1', () => {
        this.running = true
        console.log(`[WalletRelay] Relay server running on http://127.0.0.1:${RELAY_PORT}`)
        console.log(`[WalletRelay] Relay page: http://127.0.0.1:${RELAY_PORT}/relay`)
        resolve()
      })
    })
  }

  /** Handle incoming WebSocket messages */
  private handleMessage(ws: WebSocket, msg: any): void {
    switch (msg.type) {
      case 'signer-ready':
        // Chrome relay page has connected and MetaMask is available
        this.signerSocket = ws
        this.connectedAccounts = msg.accounts || []
        this.connectedChainId = msg.chainId || '0x1'
        console.log(`[WalletRelay] Chrome signer connected, accounts: ${this.connectedAccounts.length}, chain: ${this.connectedChainId}`)
        // Broadcast to all webContents via IPC so preload providers get updated
        this.broadcastToWebviews({ type: 'wallet-state', accounts: this.connectedAccounts, chainId: this.connectedChainId })
        this.sendToast('Wallet connected via Chrome relay', 'success')

        // Notify all waiting Oculo clients about the wallet state
        for (const client of this.oculoClients) {
          this.safeSend(client, {
            type: 'wallet-state',
            accounts: this.connectedAccounts,
            chainId: this.connectedChainId
          })
        }
        break

      case 'rpc-request':
        // From Oculo: dApp wants to call an eth method
        if (!this.oculoClients.has(ws)) {
          this.oculoClients.add(ws)
        }

        if (!this.signerSocket || this.signerSocket.readyState !== WebSocket.OPEN) {
          // No signer connected - auto-open Chrome relay
          this.safeSend(ws, {
            type: 'rpc-response',
            id: msg.id,
            error: { code: -32603, message: 'Wallet not connected. Opening relay in Chrome...' }
          })
          this.openRelayInChrome()
          return
        }

        // Forward to signer
        const timer = setTimeout(() => {
          // Timeout - signer didn't respond
          this.pendingRequests.delete(msg.id)
          this.safeSend(ws, {
            type: 'rpc-response',
            id: msg.id,
            error: { code: -32603, message: 'Request timed out (60s). User may not have approved in MetaMask.' }
          })
        }, REQUEST_TIMEOUT_MS)

        this.pendingRequests.set(msg.id, { oculoWs: ws, timer })

        // Send RPC request to Chrome signer
        this.safeSend(this.signerSocket, {
          id: msg.id,
          method: msg.method,
          params: msg.params || []
        })
        break

      case 'rpc-response':
        // From Chrome: MetaMask response
        const pending = this.pendingRequests.get(msg.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingRequests.delete(msg.id)
          if (pending.ipcResolve) {
            // IPC-based request (from preload)
            pending.ipcResolve({ result: msg.result, error: msg.error })
          } else if (pending.oculoWs) {
            // WebSocket-based request
            this.safeSend(pending.oculoWs, {
              type: 'rpc-response',
              id: msg.id,
              result: msg.result,
              error: msg.error
            })
          }
        }
        break

      case 'event':
        // From Chrome: MetaMask event (accountsChanged, chainChanged, etc.)
        if (msg.event === 'accountsChanged') {
          this.connectedAccounts = msg.data || []
        } else if (msg.event === 'chainChanged') {
          this.connectedChainId = msg.data || '0x1'
        }

        // Forward event to all Oculo WebSocket clients
        for (const client of this.oculoClients) {
          this.safeSend(client, msg)
        }
        // Also broadcast to webviews via IPC
        this.broadcastToWebviews({ type: 'event', event: msg.event, data: msg.data })
        break

      case 'oculo-register':
        // From Oculo: webview client registering
        this.oculoClients.add(ws)
        console.log(`[WalletRelay] Oculo client registered (${this.oculoClients.size} total)`)

        // Send current wallet state if signer is connected
        if (this.signerSocket && this.signerSocket.readyState === WebSocket.OPEN) {
          this.safeSend(ws, {
            type: 'wallet-state',
            accounts: this.connectedAccounts,
            chainId: this.connectedChainId
          })
        }
        break

      default:
        console.warn('[WalletRelay] Unknown message type:', msg.type)
    }
  }

  /** Safely send a JSON message to a WebSocket */
  private safeSend(ws: WebSocket, data: any): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data))
      }
    } catch (err) {
      console.error('[WalletRelay] Send error:', err)
    }
  }

  /** Send a toast notification to the main window */
  private sendToast(message: string, type: 'info' | 'success' | 'warning' | 'error'): void {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('toast', { message, type })
      }
    } catch { /* window may be destroyed */ }
  }

  /** Open the relay page in Chrome (system default browser) */
  async openRelayInChrome(): Promise<void> {
    const url = `http://127.0.0.1:${RELAY_PORT}/relay`
    console.log(`[WalletRelay] Opening relay page in Chrome: ${url}`)
    this.sendToast('Opening wallet relay in Chrome...', 'info')
    await shell.openExternal(url)
  }

  /** Get current relay status */
  getStatus(): WalletRelayStatus {
    return {
      running: this.running,
      port: RELAY_PORT,
      chromeConnected: this.signerSocket !== null && this.signerSocket.readyState === WebSocket.OPEN,
      oculoClients: this.oculoClients.size
    }
  }

  /** Check if the Chrome signer is connected */
  isSignerConnected(): boolean {
    return this.signerSocket !== null && this.signerSocket.readyState === WebSocket.OPEN
  }

  /** Get connected accounts (cached from signer) */
  getAccounts(): string[] {
    return this.connectedAccounts
  }

  /** Get connected chain ID (cached from signer) */
  getChainId(): string {
    return this.connectedChainId
  }

  /** Broadcast wallet state to all webContents via executeJavaScript */
  private broadcastToWebviews(msg: any): void {
    try {
      const { webContents: allWebContents } = require('electron')
      const script = `if(window.__oculoWalletUpdate) window.__oculoWalletUpdate(${JSON.stringify(msg)})`
      for (const wc of allWebContents.getAllWebContents()) {
        if (!wc.isDestroyed()) {
          wc.executeJavaScript(script).catch(() => {})
        }
      }
    } catch { /* ignore */ }
  }

  /** Deliver an RPC response to a specific webContents via executeJavaScript */
  private deliverRpcResponse(wc: Electron.WebContents, id: number, result: any, error: any): void {
    try {
      const msg = { type: 'rpc-response', id, result, error }
      const script = `if(window.__oculoWalletUpdate) window.__oculoWalletUpdate(${JSON.stringify(msg)})`
      wc.executeJavaScript(script).catch(() => {})
    } catch { /* ignore */ }
  }

  /** Set up listeners on webContents for wallet RPC requests from the page */
  setupWebContentsListeners(wc: Electron.WebContents): void {
    // The page dispatches 'oculo-wallet-rpc' CustomEvents -- we can't listen for those
    // directly from main process. Instead, use ipc-message from the preload.
    // But since webview-preload can't use ipcRenderer, we'll use a different approach:
    // Poll-based message passing via executeJavaScript.
    // Actually -- let's use webContents.on('console-message') or
    // webContents.on('ipc-message') ... but webview preload can't send IPC.
    //
    // The REAL fix: Use webContents.on('did-finish-load') to inject a script that
    // sends RPC requests via window.postMessage, and use webContents.on('ipc-message-sync')
    // ... but that requires contextIsolation to be off.
    //
    // SIMPLEST approach: after loading, inject a script that overrides window.ethereum.request
    // to use fetch() to the local relay HTTP endpoint instead of WebSocket.
  }

  /** Handle an RPC request from the preload via IPC (no WebSocket needed from page) */
  async handleIpcRpcRequest(request: { id: number; method: string; params: any[] }): Promise<any> {
    if (!this.signerSocket || this.signerSocket.readyState !== WebSocket.OPEN) {
      // Try to open Chrome relay
      this.openRelayInChrome()
      return { error: { code: -32603, message: 'Wallet not connected. Opening relay in Chrome...' } }
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id)
        resolve({ error: { code: -32603, message: 'Request timed out (60s)' } })
      }, 60000)

      this.pendingRequests.set(request.id, {
        oculoWs: null as any, // Not using WebSocket for IPC requests
        timer,
        ipcResolve: resolve
      })

      // Forward to Chrome signer
      this.safeSend(this.signerSocket!, {
        type: 'rpc-request',
        id: request.id,
        method: request.method,
        params: request.params
      })
    })
  }

  /** Stop the relay server */
  stop(): void {
    if (!this.running) return

    // Clear all pending request timers
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
    }
    this.pendingRequests.clear()

    // Close all WebSocket connections
    if (this.signerSocket) {
      this.signerSocket.close()
      this.signerSocket = null
    }
    for (const client of this.oculoClients) {
      client.close()
    }
    this.oculoClients.clear()

    // Close WebSocket server
    this.wss?.close()
    this.wss = null

    // Close HTTP server
    this.httpServer?.close()
    this.httpServer = null

    this.running = false
    console.log('[WalletRelay] Relay server stopped')
  }
}
