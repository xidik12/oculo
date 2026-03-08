/**
 * Headless mode configuration.
 *
 * Activated by:
 *   --headless            CLI flag
 *   OCULO_HEADLESS=1      Environment variable
 *
 * Optional:
 *   --headless-auto-approve   Auto-approve CONFIRM-level actions (BLOCKED still denied)
 */

const argv = process.argv

export const isHeadless: boolean =
  argv.includes('--headless') || process.env.OCULO_HEADLESS === '1'

export const headlessAutoApprove: boolean =
  isHeadless && argv.includes('--headless-auto-approve')

/** Log a message with the headless prefix (only when headless) */
export function headlessLog(message: string): void {
  if (isHeadless) {
    console.log(`[OCULO-HEADLESS] ${message}`)
  }
}
