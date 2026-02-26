import { WebContents } from 'electron'
import { FormDetector } from '../../engine/form-detector'

const formDetector = new FormDetector()

export async function handleFillTool(
  webContents: WebContents,
  args: { fields: Record<string, string | boolean>; submit?: boolean | string; screenshot?: boolean }
): Promise<string> {
  return await formDetector.fillForm(webContents, args.fields, args.submit)
}
