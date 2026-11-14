import {KOURIER_AUTH_BASE, type OAuthCredentials} from '../types.js'
import {credentialsFromPayload, credentialKey, type TokenPayload} from './credentials.js'

/** Exchange a refresh token for new credentials. The old refresh token is kept when
 * the server does not rotate it, so a refresh never loses the ability to refresh again. */
export async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  const token = credentials.refresh
  if (!token) throw new Error('Kourier credentials do not contain a refresh token')
  const response = await fetch(`${KOURIER_AUTH_BASE}/oauth2/token`, {
    method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
    body: JSON.stringify({grant_type: 'refresh_token', refresh_token: token}),
  })
  const payload = await response.json() as TokenPayload
  if (!response.ok || credentialKey(payload) === undefined) throw new Error(payload.error_description ?? `Kourier token refresh failed (${response.status})`)
  return credentialsFromPayload(payload, credentials)
}
