import { REDACTION_PATTERNS } from '../../shared/constants'

/**
 * Redacts sensitive data from MCP responses.
 * This runs on EVERY response before it leaves the app.
 * Patterns: credit cards, SSNs, JWTs, API keys, bearer tokens, private keys.
 */
export class Redactor {
  private customPatterns: RegExp[] = []

  setCustomPatterns(patterns: string[]): void {
    this.customPatterns = patterns.map(p => {
      try { return new RegExp(p, 'gi') }
      catch { return null }
    }).filter(Boolean) as RegExp[]
  }

  /**
   * Redact sensitive data from a string response
   */
  redact(text: string): string {
    let result = text

    // Apply built-in patterns
    result = result.replace(REDACTION_PATTERNS.creditCard, '[REDACTED:card]')
    result = result.replace(REDACTION_PATTERNS.ssn, '[REDACTED:ssn]')
    result = result.replace(REDACTION_PATTERNS.jwt, '[REDACTED:token]')
    result = result.replace(REDACTION_PATTERNS.apiKey, (match, key) => {
      // Keep the label part, redact the value
      const labelEnd = match.indexOf(key)
      return match.substring(0, labelEnd) + '[REDACTED:key]'
    })
    result = result.replace(REDACTION_PATTERNS.privateKey, '[REDACTED:private-key]')
    result = result.replace(REDACTION_PATTERNS.bearer, 'Bearer [REDACTED:token]')

    // Apply custom patterns
    for (const pattern of this.customPatterns) {
      result = result.replace(pattern, '[REDACTED]')
    }

    return result
  }

  /**
   * Redact password field values from page descriptions.
   * Ensures type="password" field values never appear in output.
   */
  redactFormFields(text: string): string {
    // Replace password field values that might leak through
    return text.replace(
      /password[^,\n)]*\([^)]*,\s*([^)]+)\)/gi,
      (match) => match.replace(/,\s*[^)]+\)/, ', ***)')
    )
  }
}
