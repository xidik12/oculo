#!/usr/bin/env node

/**
 * Oculo Headless Launcher
 *
 * Launches the Oculo Electron app in headless mode (no visible window, no dock icon).
 * The MCP server still starts and accepts tool calls normally.
 *
 * Usage:
 *   node bin/oculo-headless.mjs                      # headless mode
 *   node bin/oculo-headless.mjs --headless-auto-approve  # + auto-approve CONFIRM actions
 *
 * All additional arguments are passed through to Electron.
 */

import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

// Resolve electron binary
let electronPath
try {
  const electronPkg = join(projectRoot, 'node_modules', 'electron', 'index.js')
  const electronModule = await import(electronPkg)
  electronPath = electronModule.default || electronModule
} catch {
  // Fallback: try npx electron
  electronPath = 'electron'
}

// Collect extra args (skip node and this script path)
const extraArgs = process.argv.slice(2)

// Build args: electron entry point + --headless + any extra flags
const appEntry = join(projectRoot, 'out', 'main', 'index.js')
const args = [appEntry, '--headless', ...extraArgs]

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env: { ...process.env, OCULO_HEADLESS: '1' }
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
