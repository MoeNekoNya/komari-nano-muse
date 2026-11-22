const verifiedKey = base => 'cfsm_turnstile_verified:' + new URL(base).origin
let turnstileHandler = null
const siteConfigs = new Map()
let redirectingToAdmin = false

export class HttpError extends Error {
  constructor(status, message, url) {
    super(message || ('HTTP ' + status))
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

export function setTurnstileHandler(handler) {
  turnstileHandler = handler
}

export function setSiteConfig(base, config) {
  siteConfigs.set(base, config || {})
}

function readStorage(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value) } catch { /* storage may be disabled */ }
}
function removeStorage(key) {
  try { localStorage.removeItem(key) } catch { /* storage may be disabled */ }
}

function authHeaders() {
  const token = readStorage('jwt_token')
  return token ? { Authorization: 'Bearer ' + token } : {}
}

function adminRedirect() {
  removeStorage('jwt_token')
  if (redirectingToAdmin) return
  redirectingToAdmin = true
  window.location.assign('/admin#/admin')
}

async function decodeResponse(response, url) {
  const body = await response.text()
  let data
  try { data = body ? JSON.parse(body) : {} } catch {
    throw new Error('API 返回了非 JSON 内容：' + url)
  }
  if (!response.ok) {
    if (response.status === 401) adminRedirect()
    throw new HttpError(response.status, data?.error || data?.message || ('HTTP ' + response.status), url)
  }
  return data
}

async function fetchJson(base, path, options = {}) {
  const url = base + path
  const headers = { ...authHeaders(), ...(options.headers || {}) }
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  const sameOrigin = new URL(base).origin === window.location.origin
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    credentials: sameOrigin ? 'include' : 'omit',
    cache: 'no-store'
  })
  return decodeResponse(response, url)
}

async function obtainVerifiedCredential(base, config) {
  if (config?.turnstile_enabled !== true) return null
  if (!config.turnstile_site_key) throw new Error('Turnstile 已启用，但 /api/config 未返回 turnstile_site_key')
  if (typeof turnstileHandler !== 'function') throw new Error('Turnstile 验证组件尚未就绪')
  const token = await turnstileHandler(base, config.turnstile_site_key)
  if (!token) throw new Error('Turnstile 验证已取消')

  // CFSM returns the reusable encrypted credential only when /api/config
  // receives the one-time Turnstile token.
  const data = await fetchJson(base, '/api/config', {
    headers: { 'X-Turnstile-Token': token }
  })
  if (!data?.turnstile_verified) {
    throw new Error('Turnstile 已通过，但服务端没有返回 turnstile_verified')
  }
  writeStorage(verifiedKey(base), data.turnstile_verified)
  siteConfigs.set(base, { ...config, ...data })
  return data.turnstile_verified
}

export async function requestJson(base, path, options = {}) {
  if (!/^\/api\/(config|servers|server|history\/all|theme_options)(?:\?|$)/.test(path)) {
    throw new Error('主题禁止调用该 API：' + path)
  }
  const config = siteConfigs.get(base) || {}
  const headers = { ...(options.headers || {}) }
  if (config.turnstile_enabled === true) {
    const verified = readStorage(verifiedKey(base))
    if (verified) headers['X-Turnstile-Verified'] = verified
  }

  try {
    return await fetchJson(base, path, { ...options, headers })
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 403 || config.turnstile_enabled !== true) {
      throw error
    }
    removeStorage(verifiedKey(base))
    const verified = await obtainVerifiedCredential(base, config)
    return fetchJson(base, path, {
      ...options,
      headers: { ...(options.headers || {}), 'X-Turnstile-Verified': verified }
    })
  }
}
