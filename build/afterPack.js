const { execSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log('[afterPack] Stripping resource forks from', appPath)
  try {
    execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' })
  } catch (e) {
    console.warn('[afterPack] xattr -cr failed:', e.message)
  }
}
