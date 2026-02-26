import https from 'https'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MediaProviderId = 'gemini' | 'openai' | 'stability' | 'runway' | 'kling'

export interface MediaRequest {
  type: 'image' | 'video'
  prompt: string
  size?: string      // e.g. '1024x1024'
  style?: string     // e.g. 'natural', 'vivid'
  provider?: string  // force specific provider
  duration?: number  // video duration in seconds
}

export interface MediaResult {
  success: boolean
  filePath?: string
  provider?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Provider order
// ---------------------------------------------------------------------------

const IMAGE_PROVIDER_ORDER: MediaProviderId[] = ['gemini', 'openai', 'stability']
const VIDEO_PROVIDER_ORDER: MediaProviderId[] = ['runway', 'kling']

// ---------------------------------------------------------------------------
// MediaGenerator
// ---------------------------------------------------------------------------

/**
 * Phase 3 — Image & Video generation engine for Oculo AI autonomy.
 *
 * Supports 3 image providers (Gemini, DALL-E 3, Stability AI) and
 * 2 video providers (Runway ML, Kling — stubbed, async APIs).
 *
 * Uses only Node.js built-in `https` module — no external dependencies.
 * API keys are resolved lazily via the injected `getApiKey` callback so
 * this class stays decoupled from the provider config system.
 */
export class MediaGenerator {
  private getApiKey: (provider: string) => string | null

  constructor(getApiKey: (provider: string) => string | null) {
    this.getApiKey = getApiKey
  }

  // -------------------------------------------------------------------------
  // Public entry point
  // -------------------------------------------------------------------------

  async generate(request: MediaRequest): Promise<MediaResult> {
    if (request.type === 'image') {
      return this.generateImage(request)
    }
    return this.generateVideo(request)
  }

  // -------------------------------------------------------------------------
  // Image generation
  // -------------------------------------------------------------------------

  private async generateImage(request: MediaRequest): Promise<MediaResult> {
    const providerOrder = request.provider
      ? [request.provider as MediaProviderId]
      : IMAGE_PROVIDER_ORDER

    for (const providerId of providerOrder) {
      const key = this.getApiKey(providerId)
      if (!key) continue

      try {
        let base64: string

        if (providerId === 'gemini') {
          base64 = await this.generateWithGemini(request.prompt, key)
        } else if (providerId === 'openai') {
          base64 = await this.generateWithOpenAI(request.prompt, key, request)
        } else if (providerId === 'stability') {
          base64 = await this.generateWithStability(request.prompt, key, request)
        } else {
          return { success: false, error: `Unknown image provider: ${providerId}` }
        }

        const filePath = await this.saveImage(base64)
        return { success: true, filePath, provider: providerId }
      } catch (err) {
        const message = (err as Error).message || String(err)
        // If a specific provider was forced, surface the error immediately
        if (request.provider) {
          return { success: false, provider: providerId, error: message }
        }
        // Otherwise try the next provider in the chain
        console.warn(`[MediaGenerator] ${providerId} failed: ${message} — trying next provider`)
      }
    }

    return {
      success: false,
      error: request.provider
        ? `No API key configured for provider: ${request.provider}`
        : 'No image provider API keys configured. Add a Gemini, OpenAI, or Stability AI key in Settings.'
    }
  }

  // -------------------------------------------------------------------------
  // Video generation (stubbed — async queue APIs)
  // -------------------------------------------------------------------------

  private async generateVideo(request: MediaRequest): Promise<MediaResult> {
    const providerOrder = request.provider
      ? [request.provider as MediaProviderId]
      : VIDEO_PROVIDER_ORDER

    for (const providerId of providerOrder) {
      const key = this.getApiKey(providerId)
      if (!key) continue

      if (providerId === 'runway') {
        return { success: false, provider: 'runway', error: 'Video generation via runway coming soon' }
      }

      if (providerId === 'kling') {
        return { success: false, provider: 'kling', error: 'Video generation via kling coming soon' }
      }
    }

    return {
      success: false,
      error: request.provider
        ? `No API key configured for provider: ${request.provider}`
        : 'No video provider API keys configured. Add a Runway ML or Kling key in Settings.'
    }
  }

  // -------------------------------------------------------------------------
  // Provider: Gemini (gemini-2.0-flash-exp image generation)
  // -------------------------------------------------------------------------

  private generateWithGemini(prompt: string, apiKey: string): Promise<string> {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
    })

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: `/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            try {
              const parsed = JSON.parse(data)
              reject(new Error(parsed?.error?.message || `Gemini image error ${res.statusCode}`))
            } catch {
              reject(new Error(`Gemini image error ${res.statusCode}`))
            }
            return
          }

          try {
            const parsed = JSON.parse(data)
            const parts: any[] = parsed?.candidates?.[0]?.content?.parts ?? []
            const imagePart = parts.find(
              (p: any) => p?.inlineData?.mimeType?.startsWith('image/')
            )
            if (!imagePart?.inlineData?.data) {
              reject(new Error('Gemini did not return an image in the response'))
              return
            }
            resolve(imagePart.inlineData.data as string)
          } catch (parseErr) {
            reject(new Error(`Failed to parse Gemini image response: ${(parseErr as Error).message}`))
          }
        })
        res.on('error', reject)
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  // -------------------------------------------------------------------------
  // Provider: DALL-E 3 (OpenAI)
  // -------------------------------------------------------------------------

  private generateWithOpenAI(
    prompt: string,
    apiKey: string,
    request: MediaRequest
  ): Promise<string> {
    // DALL-E 3 supported sizes: 1024x1024, 1024x1792, 1792x1024
    const size = request.size || '1024x1024'

    const payload: Record<string, any> = {
      model: 'dall-e-3',
      prompt,
      size,
      quality: 'standard',
      response_format: 'b64_json'
    }

    if (request.style) {
      payload.style = request.style
    }

    const body = JSON.stringify(payload)

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/images/generations',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            try {
              const parsed = JSON.parse(data)
              reject(new Error(parsed?.error?.message || `OpenAI image error ${res.statusCode}`))
            } catch {
              reject(new Error(`OpenAI image error ${res.statusCode}`))
            }
            return
          }

          try {
            const parsed = JSON.parse(data)
            const b64 = parsed?.data?.[0]?.b64_json
            if (!b64) {
              reject(new Error('OpenAI DALL-E did not return image data'))
              return
            }
            resolve(b64 as string)
          } catch (parseErr) {
            reject(new Error(`Failed to parse OpenAI image response: ${(parseErr as Error).message}`))
          }
        })
        res.on('error', reject)
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  // -------------------------------------------------------------------------
  // Provider: Stability AI (SD3 — multipart/form-data)
  // -------------------------------------------------------------------------

  private generateWithStability(
    prompt: string,
    apiKey: string,
    request: MediaRequest
  ): Promise<string> {
    // Convert size (e.g. '1024x1024') to aspect_ratio (e.g. '1:1')
    const aspectRatio = this.sizeToAspectRatio(request.size)

    const boundary = `----OculoFormBoundary${Date.now().toString(16)}`

    const buildFormData = (fields: Record<string, string>): Buffer => {
      const parts: Buffer[] = []
      for (const [name, value] of Object.entries(fields)) {
        parts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
        ))
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`))
      return Buffer.concat(parts)
    }

    const body = buildFormData({
      prompt,
      output_format: 'png',
      aspect_ratio: aspectRatio
    })

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.stability.ai',
        port: 443,
        path: '/v2beta/stable-image/generate/sd3',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8')

          if (res.statusCode && res.statusCode >= 400) {
            try {
              const parsed = JSON.parse(raw)
              reject(new Error(parsed?.message || parsed?.errors?.[0] || `Stability AI error ${res.statusCode}`))
            } catch {
              reject(new Error(`Stability AI error ${res.statusCode}`))
            }
            return
          }

          try {
            // Stability returns base64 directly in the JSON body
            const parsed = JSON.parse(raw)
            const b64 = parsed?.image ?? parsed?.artifacts?.[0]?.base64 ?? parsed?.base64
            if (!b64) {
              reject(new Error('Stability AI did not return image data'))
              return
            }
            resolve(b64 as string)
          } catch (parseErr) {
            // Fall back: maybe the response IS raw base64 (some older versions)
            if (/^[A-Za-z0-9+/=\r\n]+$/.test(raw.trim())) {
              resolve(raw.trim())
            } else {
              reject(new Error(`Failed to parse Stability AI response: ${(parseErr as Error).message}`))
            }
          }
        })
        res.on('error', reject)
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  // -------------------------------------------------------------------------
  // File I/O helpers
  // -------------------------------------------------------------------------

  private getOutputDir(): string {
    const tempDir = app.getPath('temp')
    return path.join(tempDir, 'oculo-generated')
  }

  private async saveImage(base64: string): Promise<string> {
    const dir = this.getOutputDir()
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `img-${Date.now()}.png`)
    const buffer = Buffer.from(base64, 'base64')
    fs.writeFileSync(filePath, buffer)
    return filePath
  }

  /** Reserved for future use when video providers go live. */
  private async saveVideo(base64: string): Promise<string> {
    const dir = this.getOutputDir()
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `vid-${Date.now()}.mp4`)
    const buffer = Buffer.from(base64, 'base64')
    fs.writeFileSync(filePath, buffer)
    return filePath
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  /**
   * Converts a WxH size string (e.g. '1024x768') to an aspect ratio string
   * (e.g. '4:3') suitable for Stability AI's `aspect_ratio` field.
   * Falls back to '1:1' if the size is missing or unrecognised.
   */
  private sizeToAspectRatio(size?: string): string {
    if (!size) return '1:1'

    const match = size.match(/^(\d+)[xX×](\d+)$/)
    if (!match) return '1:1'

    const w = parseInt(match[1], 10)
    const h = parseInt(match[2], 10)
    if (!w || !h) return '1:1'

    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
    const divisor = gcd(w, h)
    return `${w / divisor}:${h / divisor}`
  }
}
