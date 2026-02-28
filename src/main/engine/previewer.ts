import https from 'https'
import http from 'http'
import { URL } from 'url'

interface PreviewResult {
  url: string
  title: string
  description: string
  snippet: string
  ogImage?: string
}

interface CacheEntry {
  result: PreviewResult
  expiresAt: number
}

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const MAX_CACHE = 50
const TIMEOUT = 5000

export class Previewer {
  private cache = new Map<string, CacheEntry>()

  async preview(url: string): Promise<PreviewResult> {
    // Check cache
    const cached = this.cache.get(url)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result
    }

    const html = await this.fetch(url)
    const result = this.parse(url, html)

    // Cache result
    if (this.cache.size >= MAX_CACHE) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }
    this.cache.set(url, { result, expiresAt: Date.now() + CACHE_TTL })

    return result
  }

  private fetch(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const client = parsedUrl.protocol === 'https:' ? https : http

      const req = client.get(url, {
        timeout: TIMEOUT,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml'
        }
      }, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).toString()
          this.fetch(redirectUrl).then(resolve).catch(reject)
          return
        }

        let body = ''
        res.setEncoding('utf-8')
        res.on('data', (chunk: string) => {
          body += chunk
          // Only read first 50KB
          if (body.length > 50000) {
            res.destroy()
            resolve(body)
          }
        })
        res.on('end', () => resolve(body))
        res.on('error', reject)
      })

      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
      req.on('error', reject)
    })
  }

  private parse(url: string, html: string): PreviewResult {
    const title = this.extractTag(html, 'title') ||
                  this.extractMeta(html, 'og:title') ||
                  this.extractMeta(html, 'twitter:title') ||
                  url

    const description = this.extractMeta(html, 'description') ||
                        this.extractMeta(html, 'og:description') ||
                        this.extractMeta(html, 'twitter:description') ||
                        ''

    const ogImage = this.extractMeta(html, 'og:image') || undefined

    // Extract first 500 chars of visible text
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    let snippet = ''
    if (bodyMatch) {
      snippet = bodyMatch[1]
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 500)
    }

    return { url, title, description, snippet, ogImage }
  }

  private extractTag(html: string, tag: string): string {
    const match = html.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'))
    return match ? match[1].trim() : ''
  }

  private extractMeta(html: string, name: string): string {
    // Try both name= and property= attributes
    const patterns = [
      new RegExp(`<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i')
    ]
    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match) return match[1].trim()
    }
    return ''
  }
}
