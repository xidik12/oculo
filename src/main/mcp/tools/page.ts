import { WebContents } from 'electron'
import { PageDescriber } from '../../engine/describer'

const describer = new PageDescriber()

export async function handlePageTool(
  webContents: WebContents,
  args: { scope?: string; include?: string[]; screenshot?: boolean }
): Promise<string> {
  return await describer.describe(webContents, {
    scope: args.scope,
    include: args.include
  })
}
