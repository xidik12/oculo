import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { BrowserWindow } from 'electron'

// node-pty is a native module — import dynamically to handle missing builds gracefully
let pty: typeof import('node-pty')
try {
  pty = require('node-pty')
} catch {
  console.error('[PtyManager] node-pty not available — terminal will not work')
}

/**
 * Manages PTY sessions for the interactive terminal tab and one-shot AI shell execution.
 *
 * Two modes:
 * - Interactive (spawn/write/resize/kill) — powers the user's terminal tab via xterm.js
 * - One-shot (exec) — powers the AI shell tool (separate process, capped output, timeout)
 */
export class PtyManager {
  private session: import('node-pty').IPty | null = null
  private mainWindow: BrowserWindow
  private shellEnv: Record<string, string>
  private shellPath: string

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
    this.shellPath = process.env['SHELL'] || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh')
    this.shellEnv = this.buildEnv()
  }

  /** Build an enriched environment — same PATH logic as AgentController.initShellEnv */
  private buildEnv(): Record<string, string> {
    const isWin = process.platform === 'win32'
    const home = process.env['HOME'] || process.env['USERPROFILE'] || ''
    const sep = isWin ? ';' : ':'

    const extraPaths = isWin
      ? [`${home}\\AppData\\Roaming\\npm`, `${home}\\.claude\\bin`, `${home}\\AppData\\Local\\Programs\\claude`]
      : [`${home}/.local/bin`, `${home}/.claude/bin`, `${home}/.npm-global/bin`, '/usr/local/bin']

    const currentPath = process.env['PATH'] || (isWin ? '' : '/usr/bin:/bin')

    let shellPath = ''
    if (!isWin) {
      try {
        const shell = process.env['SHELL'] || '/bin/zsh'
        shellPath = execFileSync(shell, ['-lc', 'echo $PATH'], {
          encoding: 'utf-8', timeout: 5000
        }).trim()
      } catch { /* ignore */ }
    }

    const allPaths = [...extraPaths, ...shellPath.split(sep), ...currentPath.split(sep)]
    const seen = new Set<string>()
    const dedupedPath = allPaths.filter(p => { if (!p || seen.has(p)) return false; seen.add(p); return true }).join(sep)

    // Build clean env — strip CLAUDECODE so the embedded terminal can launch Claude Code
    const env = { ...process.env as Record<string, string> }
    delete env['CLAUDECODE']
    delete env['CLAUDE_CODE_SESSION']

    return {
      ...env,
      PATH: dedupedPath,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env['LANG'] || 'en_US.UTF-8'
    }
  }

  /** Spawn an interactive PTY session for the terminal tab */
  spawn(cols: number, rows: number): void {
    if (!pty) {
      console.error('[PtyManager] node-pty not loaded — cannot spawn terminal')
      try {
        this.mainWindow.webContents.send('pty:data',
          '\r\n\x1b[31m[Error: node-pty not available. Try: npx electron-rebuild -f -w node-pty]\x1b[0m\r\n')
      } catch { /* window may be destroyed */ }
      return
    }
    console.log(`[PtyManager] Spawning PTY: ${cols}x${rows}, shell: ${this.shellPath}`)
    if (this.session) this.kill()

    const home = process.env['HOME'] || process.env['USERPROFILE'] || os.homedir()

    try {
      this.session = pty.spawn(this.shellPath, [], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: home,
        env: this.shellEnv
      })
    } catch (err) {
      console.error('[PtyManager] Failed to spawn PTY:', err)
      try {
        this.mainWindow.webContents.send('pty:data',
          `\r\n\x1b[31m[Error: Failed to spawn terminal: ${err instanceof Error ? err.message : err}]\x1b[0m\r\n`)
      } catch { /* window may be destroyed */ }
      return
    }

    console.log(`[PtyManager] PTY spawned successfully, pid: ${this.session.pid}`)

    this.session.onData((data) => {
      try {
        this.mainWindow.webContents.send('pty:data', data)
      } catch { /* window may be destroyed */ }
    })

    this.session.onExit(({ exitCode, signal }) => {
      console.log(`[PtyManager] PTY exited: code=${exitCode}, signal=${signal}`)
      try {
        this.mainWindow.webContents.send('pty:exit', exitCode, signal)
      } catch { /* window may be destroyed */ }
      this.session = null
    })
  }

  /** Write data (keystrokes) to the interactive PTY */
  write(data: string): void {
    this.session?.write(data)
  }

  /** Resize the interactive PTY */
  resize(cols: number, rows: number): void {
    if (this.session && cols > 0 && rows > 0) {
      try {
        this.session.resize(cols, rows)
      } catch { /* ignore resize errors */ }
    }
  }

  /** Kill the interactive PTY session */
  kill(): void {
    if (this.session) {
      try {
        this.session.kill()
      } catch { /* already dead */ }
      this.session = null
    }
  }

  /**
   * One-shot command execution for the AI shell tool.
   * Spawns a separate process (not the interactive session), collects output, returns result.
   */
  exec(command: string, timeout = 30_000): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve) => {
      if (!pty) {
        resolve({ output: 'Error: node-pty not available', exitCode: 1 })
        return
      }

      const maxOutput = 100 * 1024 // 100KB cap
      let output = ''
      let done = false

      const cwd = process.env['HOME'] || process.env['USERPROFILE'] || os.homedir()
      const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env['SHELL'] || '/bin/bash')
      const args = process.platform === 'win32' ? ['-Command', command] : ['-c', command]

      let proc: import('node-pty').IPty
      try {
        proc = pty.spawn(shell, args, {
          name: 'xterm-256color',
          cols: 120,
          rows: 40,
          cwd,
          env: { ...this.shellEnv, FORCE_COLOR: '0' }
        })
      } catch (err) {
        resolve({ output: `Error: Failed to spawn process: ${err instanceof Error ? err.message : err}`, exitCode: 1 })
        return
      }

      const timer = setTimeout(() => {
        if (!done) {
          done = true
          try { proc.kill() } catch { /* */ }
          resolve({ output: output + '\n[timed out]', exitCode: 124 })
        }
      }, timeout)

      proc.onData((data) => {
        if (output.length < maxOutput) {
          output += data
        }
      })

      proc.onExit(({ exitCode }) => {
        if (!done) {
          done = true
          clearTimeout(timer)
          resolve({ output, exitCode: exitCode ?? 0 })
        }
      })
    })
  }
}
