import { WebContents } from 'electron'
import { DataExtractor } from '../../engine/extractor'

const extractor = new DataExtractor()

export async function handleReadTool(
  webContents: WebContents,
  args: { what: string; scope?: string; fields?: string[]; limit?: number; format?: 'text' | 'json' }
): Promise<string> {
  return await extractor.extract(webContents, args.what, args)
}
