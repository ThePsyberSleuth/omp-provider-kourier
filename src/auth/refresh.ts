import {KOURIER_AUTH_BASE, type OAuthCredentials} from '../types.js'

/** Exchange a refresh token for new credentials. The old refresh token is kept when
 * the server does not rotate it, so a refresh never loses the ability to refresh again. */
export async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  const token = credentials.refresh
  if (!token) throw new Error('Kourier credentials do not contain a refresh token')
  const response = await fetch(`${KOURIER_AUTH_BASE}/oauth2/token`, {
    method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
    body: JSON.stringify({grant_type: 'refresh_token', refresh_token: token}),
  })
  const payload = await response.json() as {access_token?: string; api_key?: string; refresh_token?: string; expires_in?: number; error_description?: string}
  if (!response.ok || !(payload.api_key || payload.access_token)) throw new Error(payload.error_description ?? `Kourier token refresh failed (${response.status})`)
  const key = payload.api_key ?? payload.access_token!
  return {...credentials, access: key, refresh: payload.refresh_token ?? token, expires: Date.now() + (payload.expires_in ?? 31536000) * 1000}
}
