import { WebContents } from 'electron'
import { FormDetector } from '../../engine/form-detector'

const formDetector = new FormDetector()

export async function handleFillTool(
  webContents: WebContents,
  args: { fields: Record<string, string | boolean>; submit?: boolean | string; screenshot?: boolean }
): Promise<string> {
  const result = await formDetector.fillForm(webContents, args.fields, args.submit)

  // Capture screenshot if requested
  if (args.screenshot) {
    try {
      const image = await webContents.capturePage()
      const fs = await import('fs')
      const path = await import('path')
      const os = await import('os')
      const dir = path.join(os.homedir(), 'Pictures', 'Oculo')
      fs.mkdirSync(dir, { recursive: true })
      const filePath = path.join(dir, `fill-${Date.now()}.png`)
      fs.writeFileSync(filePath, image.toPNG())
      return result + ` Screenshot: ${filePath}`
    } catch { /* screenshot is best-effort */ }
  }

  return result
}
