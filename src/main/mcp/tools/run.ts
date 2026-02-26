import { WebContents } from 'electron'
import { PipelineRunner } from '../../engine/pipeline'
import { SecurityManager } from '../../security/vault'

const pipeline = new PipelineRunner()

export async function handleRunTool(
  webContents: WebContents,
  args: { steps: any[]; returnAll?: boolean },
  security: SecurityManager
): Promise<string> {
  return await pipeline.run(webContents, args.steps, args.returnAll)
}
