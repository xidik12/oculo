import https from 'https'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MediaProviderId = 'gemini' | 'openai' | 'stability' | 'veo'

export interface MediaRequest {
  type: 'image' | 'video'
  prompt: string
  size?: string      // e.g. '1024x1024', '2K', '4K'
  style?: string     // e.g. 'natural', 'vivid'
  provider?: string  // force specific provider
  duration?: number  // video duration in seconds (4, 6, or 8)
  model?: string     // force specific model: 'nano-banana-2', 'nano-banana-pro', 'nano-banana', 'dall-e-3'
}

export interface MediaResult {
  success: boolean
  filePath?: string
  provider?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Gemini image models (Nano Banana family)
// ---------------------------------------------------------------------------

const GEMINI_IMAGE_MODELS: Record<string, string> = {
  'nano-banana-2':   'gemini-3.1-flash-image-preview',     // Latest — Pro quality at Flash speed, 4K
  'nano-banana-pro': 'gemini-3-pro-image-preview',          // Best quality — reasoning-enhanced, text rendering
  'nano-banana':     'gemini-2.5-flash-image',              // Good quality, fast, free tier friendly
  'nano-banana-og':  'gemini-2.0-flash-exp-image-generation', // Original — widest free tier support
}
const DEFAULT_GEMINI_IMAGE_MODEL = 'nano-banana'

// ---------------------------------------------------------------------------
// Provider order
// ---------------------------------------------------------------------------

const IMAGE_PROVIDER_ORDER: MediaProviderId[] = ['gemini', 'openai', 'stability']
const VIDEO_PROVIDER_ORDER: MediaProviderId[] = ['veo', 'gemini']

// ---------------------------------------------------------------------------
// MediaGenerator
// ---------------------------------------------------------------------------

/**
 * Image & Video generation engine for Oculo AI.
 *
 * Image providers:
 *   - Gemini Nano Banana 2 (gemini-3.1-flash-image-preview) — default
 *   - Gemini Nano Banana Pro (gemini-3-pro-image-preview) — best quality
 *   - Gemini Nano Banana (gemini-2.5-flash-image) — fastest
 *   - OpenAI DALL-E 3
 *   - Stability AI SD3
 *
 * Video providers:
 *   - Google Veo 3.1 (veo-3.1-generate-preview) — uses Gemini API key
 *
 * Uses only Node.js built-in `https` module — no external dependencies.
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

    const errors: string[] = []

    for (const providerId of providerOrder) {
      const key = this.getApiKey(providerId)
      if (!key) continue

      try {
        let base64: string

        if (providerId === 'gemini') {
          // Try requested model, then auto-fallback through all Gemini image models
          const requestedModel = request.model || DEFAULT_GEMINI_IMAGE_MODEL
          const fallbackOrder = Object.keys(GEMINI_IMAGE_MODELS).filter(m => m !== requestedModel)
          const modelsToTry = [requestedModel, ...fallbackOrder]
          let lastGeminiErr: Error | null = null

          for (const modelKey of modelsToTry) {
            try {
              base64 = await this.generateWithGemini(request.prompt, key, { ...request, model: modelKey })
              lastGeminiErr = null
              break
            } catch (geminiErr: any) {
              lastGeminiErr = geminiErr
              console.log(`[MediaGenerator] Gemini ${modelKey} failed: ${geminiErr.message?.substring(0, 80)}`)
            }
          }
          if (lastGeminiErr) throw lastGeminiErr
        } else if (providerId === 'openai') {
          base64 = await this.generateWithOpenAI(request.prompt, key, request)
        } else if (providerId === 'stability') {
          base64 = await this.generateWithStability(request.prompt, key, request)
        } else {
          return { success: false, error: `Unknown image provider: ${providerId}` }
        }

        const filePath = await this.saveImage(base64)
        const modelName = providerId === 'gemini'
          ? (request.model || DEFAULT_GEMINI_IMAGE_MODEL)
          : providerId
        return { success: true, filePath, provider: modelName }
      } catch (err) {
        const message = (err as Error).message || String(err)
        errors.push(`${providerId}: ${message}`)
        console.error(`[MediaGenerator] ${providerId} FAILED: ${message}`)
        if (request.provider) {
          return { success: false, provider: providerId, error: message }
        }
      }
    }

    if (errors.length > 0) {
      return { success: false, error: `Image generation failed — ${errors.join('; ')}` }
    }

    return {
      success: false,
      error: request.provider
        ? `No API key configured for provider: ${request.provider}`
        : 'No image provider API keys configured. Add a Gemini (Google AI Studio), OpenAI, or Stability AI key in Settings.'
    }
  }

  // -------------------------------------------------------------------------
  // Video generation — Veo 3.1 via Gemini API
  // -------------------------------------------------------------------------

  private async generateVideo(request: MediaRequest): Promise<MediaResult> {
    // Veo 3.1 uses the Gemini API key
    const key = this.getApiKey('veo') || this.getApiKey('gemini')
    if (!key) {
      return {
        success: false,
        error: 'No Gemini API key configured. Veo 3.1 video generation requires a Google AI Studio API key — add it in Settings → AI Providers → Gemini.'
      }
    }

    try {
      const filePath = await this.generateWithVeo(request.prompt, key, request)
      return { success: true, filePath, provider: 'veo-3.1' }
    } catch (err) {
      const message = (err as Error).message || String(err)
      return { success: false, provider: 'veo-3.1', error: message }
    }
  }

  // -------------------------------------------------------------------------
  // Provider: Gemini Nano Banana (3 models)
  // -------------------------------------------------------------------------

  private generateWithGemini(prompt: string, apiKey: string, request: MediaRequest): Promise<string> {
    // Resolve model: user can specify 'nano-banana-2', 'nano-banana-pro', or 'nano-banana'
    const modelKey = request.model && GEMINI_IMAGE_MODELS[request.model]
      ? request.model
      : DEFAULT_GEMINI_IMAGE_MODEL
    const modelId = GEMINI_IMAGE_MODELS[modelKey]

    // Build generation config
    const generationConfig: Record<string, any> = {
      responseModalities: ['IMAGE', 'TEXT']
    }

    // Add image config for size/aspect ratio
    if (request.size) {
      const validSizes = ['1K', '2K', '4K']
      if (validSizes.includes(request.size.toUpperCase())) {
        generationConfig.imageConfig = { imageSize: request.size.toUpperCase() }
      } else {
        // Convert WxH to aspect ratio
        const ar = this.sizeToAspectRatio(request.size)
        if (ar !== '1:1') {
          generationConfig.imageConfig = { aspectRatio: ar }
        }
      }
    }

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig
    })

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: `/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
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
  // Provider: Veo 3.1 (async video generation via Gemini API)
  // -------------------------------------------------------------------------

  private async generateWithVeo(prompt: string, apiKey: string, request: MediaRequest): Promise<string> {
    // Step 1: Start async generation
    const operationName = await this.veoStartGeneration(prompt, apiKey, request)

    // Step 2: Poll until done (max 6 minutes)
    const maxPollTime = 6 * 60 * 1000
    const pollInterval = 10_000
    const startTime = Date.now()

    while (Date.now() - startTime < maxPollTime) {
      await this.sleep(pollInterval)
      const result = await this.veoPollOperation(operationName, apiKey)

      if (result.done) {
        if (result.error) {
          throw new Error(`Veo 3.1 error: ${result.error}`)
        }
        if (!result.videoUri) {
          throw new Error('Veo 3.1 completed but returned no video URI')
        }
        // Step 3: Download the video
        const videoBuffer = await this.veoDownloadVideo(result.videoUri, apiKey)
        const filePath = await this.saveVideoBuffer(videoBuffer)
        return filePath
      }
    }

    throw new Error('Veo 3.1 video generation timed out after 6 minutes')
  }

  private veoStartGeneration(prompt: string, apiKey: string, request: MediaRequest): Promise<string> {
    const duration = request.duration || 6
    const validDurations = [4, 6, 8]
    const durationSec = validDurations.includes(duration) ? duration : 6

    // Determine aspect ratio
    let aspectRatio = '16:9'
    if (request.size) {
      const ar = this.sizeToAspectRatio(request.size)
      if (['16:9', '9:16'].includes(ar)) aspectRatio = ar
    }

    const body = JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        aspectRatio,
        durationSeconds: String(durationSec),
        resolution: '720p'
      }
    })

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: `/v1beta/models/veo-3.1-generate-preview:predictLongRunning?key=${apiKey}`,
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
              reject(new Error(parsed?.error?.message || `Veo 3.1 start error ${res.statusCode}`))
            } catch {
              reject(new Error(`Veo 3.1 start error ${res.statusCode}`))
            }
            return
          }

          try {
            const parsed = JSON.parse(data)
            const opName = parsed?.name
            if (!opName) {
              reject(new Error('Veo 3.1 did not return an operation name'))
              return
            }
            resolve(opName)
          } catch (parseErr) {
            reject(new Error(`Failed to parse Veo 3.1 response: ${(parseErr as Error).message}`))
          }
        })
        res.on('error', reject)
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  private veoPollOperation(operationName: string, apiKey: string): Promise<{ done: boolean; videoUri?: string; error?: string }> {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: `/v1beta/${operationName}?key=${apiKey}`,
        method: 'GET'
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (parsed.done) {
              if (parsed.error) {
                resolve({ done: true, error: parsed.error.message || JSON.stringify(parsed.error) })
              } else {
                const videoUri = parsed?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
                resolve({ done: true, videoUri })
              }
            } else {
              resolve({ done: false })
            }
          } catch {
            resolve({ done: false })
          }
        })
        res.on('error', reject)
      })
      req.end()
    })
  }

  private veoDownloadVideo(uri: string, apiKey: string): Promise<Buffer> {
    // The URI might be a googleapis URL that needs the API key
    const url = new URL(uri)
    if (!url.searchParams.has('key')) {
      url.searchParams.set('key', apiKey)
    }

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { 'Accept': 'video/mp4' }
      }, (res) => {
        // Follow redirects
        if (res.statusCode && (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
          this.veoDownloadVideo(res.headers.location, apiKey).then(resolve).catch(reject)
          return
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Failed to download Veo video: HTTP ${res.statusCode}`))
          return
        }

        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      })
      req.on('error', reject)
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
            const parsed = JSON.parse(raw)
            const b64 = parsed?.image ?? parsed?.artifacts?.[0]?.base64 ?? parsed?.base64
            if (!b64) {
              reject(new Error('Stability AI did not return image data'))
              return
            }
            resolve(b64 as string)
          } catch (parseErr) {
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
    return path.join(app.getPath('pictures'), 'Oculo')
  }

  private async saveImage(base64: string): Promise<string> {
    const dir = this.getOutputDir()
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `img-${Date.now()}.png`)
    const buffer = Buffer.from(base64, 'base64')
    fs.writeFileSync(filePath, buffer)
    return filePath
  }

  private async saveVideoBuffer(buffer: Buffer): Promise<string> {
    const dir = this.getOutputDir()
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `vid-${Date.now()}.mp4`)
    fs.writeFileSync(filePath, buffer)
    return filePath
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
