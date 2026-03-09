/**
 * electron-builder beforeBuild hook
 *
 * Rebuilds only better-sqlite3 (which has prebuild-install support).
 * node-pty is skipped because it can't cross-compile, but it ships
 * bundled prebuilts for all platforms in its prebuilds/ directory.
 */
const { execSync } = require('child_process')

module.exports = async function (context) {
  const arch = context.arch === 1 ? 'x64' : context.arch === 3 ? 'arm64' : context.arch
  const electronVersion = context.electronVersion

  console.log(`[beforeBuild] Rebuilding better-sqlite3 for electron ${electronVersion} ${arch}`)

  try {
    execSync(
      `npx @electron/rebuild --force --only better-sqlite3 --arch ${arch} --electron-version ${electronVersion}`,
      { stdio: 'inherit', cwd: context.appDir }
    )
    console.log('[beforeBuild] better-sqlite3 rebuilt successfully')
  } catch (e) {
    console.warn('[beforeBuild] better-sqlite3 rebuild failed, will use JSONL fallback:', e.message)
  }

  // Return true to skip electron-builder's own npmRebuild
  return true
}
