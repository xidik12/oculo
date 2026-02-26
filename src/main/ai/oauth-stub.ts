/**
 * OAuth stub — replaces the real OAuthManager in public builds.
 * All methods are no-ops or return errors. No OAuth client IDs,
 * PKCE logic, keychain access, or token endpoints are present.
 */
export class OAuthManager {
  oauthToken: string | null = null
  oauthExpiresAt: number = 0
  claudeLoggedIn: boolean = false
  claudeAuthChecked: boolean = true
  claudeAuthEmail: string | undefined = undefined
  codexToken: string | null = null
  codexRefreshToken: string | null = null
  codexTokenExpiresAt: number = 0
  codexEmail: string | undefined = undefined
  codexPlan: string | undefined = undefined

  setMainWindow(_win: any): void {}
  loadOAuthToken(): void {}
  getOAuthToken(): string | null { return null }
  loadCodexToken(): void {}
  async getCodexToken(): Promise<string | null> { return null }
  checkClaudeAuth(): void {}
  async startClaudeAuth(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'This feature is not available.' }
  }
  async startCodexAuth(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'This feature is not available.' }
  }
}
