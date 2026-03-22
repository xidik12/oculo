/**
 * System Browser Authentication — reads cookies from macOS shared cookie store.
 *
 * Uses a small Swift script to read NSHTTPCookieStorage.shared, which contains
 * cookies from Safari and other apps that use the system cookie store.
 * This lets users authenticate in Safari (which supports passkeys) and
 * import the session back into Oculo.
 */
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFileSync, unlinkSync } from 'fs'

export interface SystemCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
}

/**
 * Extract the base domain for cookie matching.
 * "github.com" → "github.com"
 * "www.github.com" → "github.com"
 * ".github.com" → "github.com"
 */
export function extractBaseDomain(urlOrDomain: string): string {
  let domain = urlOrDomain
  // If it looks like a URL, parse it
  try {
    if (domain.includes('://')) {
      domain = new URL(domain).hostname
    }
  } catch {
    // Not a valid URL, treat as domain
  }
  // Remove leading dot
  domain = domain.replace(/^\./, '')
  // For multi-part domains, keep last two segments (handles github.com, google.com, etc.)
  const parts = domain.split('.')
  if (parts.length > 2) {
    return parts.slice(-2).join('.')
  }
  return domain
}

/**
 * Read cookies from the macOS system cookie store (NSHTTPCookieStorage.shared)
 * for a given domain. Uses a Swift script executed via the Swift CLI.
 */
export async function getSystemCookiesForDomain(domain: string): Promise<SystemCookie[]> {
  if (process.platform !== 'darwin') {
    console.warn('[SystemBrowserAuth] Only macOS is supported for system cookie import')
    return []
  }

  const baseDomain = extractBaseDomain(domain)

  const swiftScript = `
import Foundation

let storage = HTTPCookieStorage.shared
let cookies = storage.cookies ?? []
let domain = CommandLine.arguments[1]

var result: [[String: Any]] = []

for cookie in cookies {
    let cookieDomain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
    if cookieDomain.hasSuffix(domain) || domain.hasSuffix(cookieDomain) || cookieDomain == domain {
        var dict: [String: Any] = [
            "name": cookie.name,
            "value": cookie.value,
            "domain": cookie.domain,
            "path": cookie.path,
            "secure": cookie.isSecure,
            "httpOnly": cookie.isHTTPOnly
        ]
        if let expires = cookie.expiresDate {
            dict["expirationDate"] = expires.timeIntervalSince1970
        }
        result.append(dict)
    }
}

if let data = try? JSONSerialization.data(withJSONObject: result, options: []),
   let json = String(data: data, encoding: .utf8) {
    print(json)
} else {
    print("[]")
}
`

  const scriptPath = join(tmpdir(), `oculo-cookie-reader-${Date.now()}.swift`)
  writeFileSync(scriptPath, swiftScript)

  return new Promise((resolve) => {
    execFile('swift', [scriptPath, baseDomain], { timeout: 15000 }, (error, stdout, stderr) => {
      // Clean up temp file
      try { unlinkSync(scriptPath) } catch { /* ok */ }

      if (error) {
        console.error('[SystemBrowserAuth] Cookie reader error:', error.message)
        if (stderr) console.error('[SystemBrowserAuth] stderr:', stderr)
        resolve([])
        return
      }

      try {
        const raw = stdout.trim()
        if (!raw || raw === '[]') {
          resolve([])
          return
        }
        const cookies = JSON.parse(raw) as SystemCookie[]
        console.log(`[SystemBrowserAuth] Found ${cookies.length} cookies for domain "${baseDomain}"`)
        resolve(cookies)
      } catch (e) {
        console.error('[SystemBrowserAuth] Cookie parse error:', e)
        resolve([])
      }
    })
  })
}
