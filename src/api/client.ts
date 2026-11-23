import { S } from '../state'
import type { KomariNode, LiveRecord, PingTaskDef, ThemeSettings } from '../types/komari'

const API_BASE = window.location.origin
const VERIFIED_KEY = 'cfsm_turnstile_verified:' + API_BASE
const HISTORY_HOURS = new Set(['0.167', '0.5', '1', '6', '12', '24', '48', '96', '168'])
const configCache: { value: any; pending: Promise<any> | null } = { value: null, pending: null }
const serversCache: { value: any; pending: Promise<any> | null } = { value: null, pending: null }
const historyCache = new Map<string, Promise<any[]>>()
const serverCache = new Map<string, any>()
let configValue: any = {}
let sysConfig: any = {}
let taskCache: PingTaskDef[] | null = null
let redirecting = false

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* storage may be disabled */ }
}
function removeStorage(key: string): void {
  try { localStorage.removeItem(key) } catch { /* storage may be disabled */ }
}
function authHeaders(): Record<string, string> {
  const token = readStorage('jwt_token')
  return token ? { Authorization: 'Bearer ' + token } : {}
}
function toMillis(value: any, fallback = Date.now()): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n < 10000000000 ? n * 1000 : n
}
function toISO(value: any): string {
  const n = toMillis(value, 0)
  return n ? new Date(n).toISOString() : ''
}
function numberOrNull(value: any): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
/* CFSM memory and disk capacity values are reported in MiB; Komari's original
   view model stores byte counts. Keep values already expressed in bytes intact. */
function toBytes(value: any): number {
  const n = numberOrNull(value)
  if (n === null) return 0
  return n > 0 && n < 10000000 ? n * 1024 * 1024 : n
}
function parseLoad(value: any): [number, number, number] {
  if (Array.isArray(value)) return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0]
  const parts = String(value || '').trim().split(/[\s,]+/).map(Number)
  return [Number.isFinite(parts[0]) ? parts[0] : 0, Number.isFinite(parts[1]) ? parts[1] : 0, Number.isFinite(parts[2]) ? parts[2] : 0]
}
function parseTrafficLimit(value: any): number {
  if (value === null || value === undefined || value === '') return 0
  const raw = String(value).trim()
  const match = raw.match(/^([\d.]+)\s*(B|KB|KIB|MB|MIB|GB|GIB|TB|TIB)?$/i)
  if (!match) {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n * 1024 * 1024 * 1024 : 0
  }
  const n = Number(match[1])
  const unit = (match[2] || 'GB').toUpperCase()
  const powers: Record<string, number> = { B: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, TB: 4, TIB: 4 }
  return Number.isFinite(n) ? n * Math.pow(1024, powers[unit] || 0) : 0
}
function cycleDays(value: any): number {
  const v = String(value || '').toLowerCase()
  const map: Record<string, number> = {
    month: 30, monthly: 30, quarter: 90, quarterly: 90, half_year: 180,
    year: 365, yearly: 365, two_years: 730, three_years: 1095,
    four_years: 1460, five_years: 1825
  }
  return map[v] || (Number(value) > 0 ? Number(value) : 30)
}
function enabled(value: any): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}
function gpuName(value: any): string {
  if (Array.isArray(value)) return value.map((x: any) => x?.name).filter(Boolean).join(', ')
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map((x: any) => x?.name).filter(Boolean).join(', ')
    } catch { /* non-JSON label */ }
    return value
  }
  return ''
}
function bytesOrZero(value: any): number {
  return toBytes(value)
}
function isOnline(server: any): boolean {
  const updated = toMillis(server?.last_updated || server?.timestamp, 0)
  return updated > 0 && Date.now() - updated < 300000
}

let turnstileScript: Promise<void> | null = null
function loadTurnstileScript(): Promise<void> {
  const w = window as any
  if (w.turnstile) return Promise.resolve()
  if (turnstileScript) return turnstileScript
  turnstileScript = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-cfsm-turnstile]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile 脚本加载失败')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.cfsmTurnstile = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile 脚本加载失败'))
    document.head.appendChild(script)
  })
  return turnstileScript
}
async function askTurnstile(siteKey: string): Promise<string> {
  await loadTurnstileScript()
  const w = window as any
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div')
    overlay.id = 'nm-cfsm-turnstile'
    overlay.innerHTML =
      '<div class="nm-cfsm-turnstile-card"><button type="button" class="nm-cfsm-turnstile-close" aria-label="关闭">×</button>' +
      '<div class="nm-cfsm-turnstile-title">安全验证</div><p>请完成 Cloudflare 人机验证后继续查看监控数据。</p>' +
      '<div class="nm-cfsm-turnstile-widget"></div><div class="nm-cfsm-turnstile-error" aria-live="polite"></div></div>'
    const style = document.createElement('style')
    style.id = 'nm-cfsm-turnstile-style'
    style.textContent =
      '#nm-cfsm-turnstile{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(8,12,28,.68);backdrop-filter:blur(8px);padding:20px}' +
      '.nm-cfsm-turnstile-card{position:relative;width:min(440px,100%);padding:28px;border:1px solid var(--line2,#ccd3e5);border-radius:18px;background:var(--paper,#fff);color:var(--ink,#182139);box-shadow:0 24px 80px #0003}' +
      '.nm-cfsm-turnstile-title{font-size:20px;font-weight:600}.nm-cfsm-turnstile-card p{font-size:13px;line-height:1.7;color:var(--ink3,#667085)}' +
      '.nm-cfsm-turnstile-widget{display:flex;justify-content:center;min-height:66px;margin-top:18px}.nm-cfsm-turnstile-close{position:absolute;right:12px;top:8px;border:0;background:none;font-size:24px;color:inherit;cursor:pointer}' +
      '.nm-cfsm-turnstile-error{margin-top:10px;color:#d44;font-size:12px}'
    if (!document.getElementById(style.id)) document.head.appendChild(style)
    document.body.appendChild(overlay)
    let widgetId: any = null
    let done = false
    const finish = (value: string | null, error?: Error) => {
      if (done) return
      done = true
      try { if (widgetId !== null) w.turnstile.remove(widgetId) } catch { /* ignore */ }
      overlay.remove()
      if (error) reject(error)
      else resolve(value || '')
    }
    overlay.querySelector('.nm-cfsm-turnstile-close')?.addEventListener('click', () => finish(null, new Error('已取消安全验证')))
    try {
      widgetId = w.turnstile.render(overlay.querySelector('.nm-cfsm-turnstile-widget'), {
        sitekey: siteKey,
        callback: (token: string) => finish(token),
        'expired-callback': () => {
          const el = overlay.querySelector('.nm-cfsm-turnstile-error')
          if (el) el.textContent = '验证已过期，请重新完成验证。'
        },
        'error-callback': () => {
          const el = overlay.querySelector('.nm-cfsm-turnstile-error')
          if (el) el.textContent = '验证暂时失败，请重试。'
        }
      })
    } catch (error: any) {
      finish(null, new Error(error?.message || '无法启动 Turnstile'))
    }
  })
}
function adminRedirect(): void {
  removeStorage('jwt_token')
  if (redirecting) return
  redirecting = true
  window.location.assign('/admin#/admin')
}
async function decode(response: Response, path: string): Promise<any> {
  const raw = await response.text()
  let data: any
  try { data = raw ? JSON.parse(raw) : {} } catch {
    throw new Error('API 返回了非 JSON 内容：' + path)
  }
  if (!response.ok) {
    if (response.status === 401) adminRedirect()
    const error: any = new Error(data?.error || data?.message || ('HTTP ' + response.status))
    error.status = response.status
    throw error
  }
  return data
}
async function rawRequest(path: string, options: any = {}, extraHeaders: Record<string, string> = {}): Promise<any> {
  const headers: Record<string, string> = { ...authHeaders(), ...extraHeaders, ...(options.headers || {}) }
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  const response = await fetch(API_BASE + path, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    credentials: 'include',
    cache: 'no-store'
  })
  return decode(response, path)
}
function allowedPath(path: string): boolean {
  return /^\/api\/(config|servers|server|history\/all|theme_options)(?:\?|$)/.test(path)
}
async function requestJson(path: string, options: any = {}): Promise<any> {
  if (!allowedPath(path)) throw new Error('已拦截非 CFSM 公开 API：' + path)
  const verified = readStorage(VERIFIED_KEY)
  const cfg = configValue || {}
  try {
    return await rawRequest(path, options, cfg.turnstile_enabled === true && verified ? { 'X-Turnstile-Verified': verified } : {})
  } catch (error: any) {
    if (error?.status !== 403 || cfg.turnstile_enabled !== true) throw error
    removeStorage(VERIFIED_KEY)
    if (!cfg.turnstile_site_key) throw new Error('Turnstile 已启用，但服务端没有提供 Site Key')
    const token = await askTurnstile(cfg.turnstile_site_key)
    const checked = await rawRequest('/api/config', {}, { 'X-Turnstile-Token': token })
    if (!checked?.turnstile_verified) throw new Error('验证通过后未取得 turnstile_verified 凭证')
    writeStorage(VERIFIED_KEY, checked.turnstile_verified)
    configValue = { ...cfg, ...checked }
    configCache.value = configValue
    return rawRequest(path, options, { 'X-Turnstile-Verified': checked.turnstile_verified })
  }
}
function apiConfig(): Promise<any> {
  if (configCache.value) return Promise.resolve(configCache.value)
  if (!configCache.pending) {
    configCache.pending = requestJson('/api/config').then(data => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('/api/config 返回格式无效')
      configValue = data
      configCache.value = data
      return data
    }).catch(error => {
      configCache.pending = null
      throw error
    })
  }
  return configCache.pending
}
function apiServers(): Promise<any> {
  if (serversCache.value) return Promise.resolve(serversCache.value)
  if (!serversCache.pending) {
    serversCache.pending = requestJson('/api/servers').then(data => {
      if (!data || !Array.isArray(data.servers)) throw new Error('/api/servers 缺少 servers 数组')
      serversCache.value = data
      sysConfig = data.sysConfig || {}
      data.servers.forEach((server: any) => serverCache.set(String(server.id), server))
      return data
    }).catch(error => {
      serversCache.pending = null
      throw error
    })
  }
  return serversCache.pending
}
function mapServerToLive(server: any): LiveRecord {
  const load = parseLoad(server.load_avg)
  const updated = toISO(server.last_updated || server.timestamp)
  const tcp = numberOrNull(server.tcp_conn)
  const udp = numberOrNull(server.udp_conn)
  const netUp = numberOrNull(server.net_out_speed)
  const netDown = numberOrNull(server.net_in_speed)
  const ramUsed = bytesOrZero(server.ram_used)
  const ramTotal = bytesOrZero(server.ram_total)
  const diskUsed = bytesOrZero(server.disk_used)
  const diskTotal = bytesOrZero(server.disk_total)
  const swapUsed = bytesOrZero(server.swap_used)
  const swapTotal = bytesOrZero(server.swap_total)
  return {
    _hasCpu: numberOrNull(server.cpu) !== null,
    _hasMemory: ramUsed > 0 || ramTotal > 0,
    _hasDisk: diskUsed > 0 || diskTotal > 0,
    _hasNetwork: netUp !== null || netDown !== null,
    _hasSwap: swapUsed > 0 || swapTotal > 0,
    _hasTraffic: numberOrNull(server.net_tx) !== null || numberOrNull(server.net_rx) !== null,
    _hasLoad: String(server.load_avg || '').trim() !== '',
    _hasConnections: tcp !== null || udp !== null,
    _hasProcess: numberOrNull(server.processes) !== null,
    cpu: numberOrNull(server.cpu) || 0,
    mem_used: ramUsed,
    mem_total: ramTotal,
    swap_used: swapUsed,
    swap_total: swapTotal,
    disk_used: diskUsed,
    disk_total: diskTotal,
    up: netUp || 0,
    down: netDown || 0,
    total_up: numberOrNull(server.net_tx) || 0,
    total_down: numberOrNull(server.net_rx) || 0,
    tcp: tcp || 0,
    udp: udp || 0,
    load1: load[0],
    load5: load[1],
    load15: load[2],
    uptime: Math.max(0, Math.floor((Date.now() - toMillis(server.boot_time, Date.now())) / 1000)),
    process: numberOrNull(server.processes) || 0,
    updated_at: updated
  }
}
function mapServerToNode(server: any): KomariNode {
  const live = mapServerToLive(server)
  const trafficType: Record<string, string> = { total: 'sum', dl: 'down', ul: 'up', max: 'max', min: 'min' }
  return {
    uuid: String(server.id),
    name: String(server.name || server.id),
    os: server.os || '',
    cpu_name: server.cpu_info || '',
    cpu_cores: numberOrNull(server.cpu_cores) || undefined,
    arch: server.arch || '',
    virtualization: server.virtualization || '',
    kernel_version: server.kernel_version || '',
    gpu_name: gpuName(server.gpu_info),
    region: server.region || '',
    group: server.server_group || '',
    tags: typeof server.tags === 'string' ? server.tags : '',
    mem_total: live.mem_total,
    disk_total: live.disk_total,
    swap_total: live.swap_total,
    weight: numberOrNull(server.sort_order) || 0,
    hidden: false,
    price: server.price === -1 || server.price === '-1' ? -1 : numberOrNull(server.price) || 0,
    billing_cycle: cycleDays(server.billing_cycle),
    currency: server.currency || '',
    expired_at: server.expire_date || '',
    auto_renewal: enabled(server.auto_renewal),
    traffic_limit: parseTrafficLimit(server.traffic_limit),
    traffic_limit_type: trafficType[String(server.traffic_calc_type || 'max').toLowerCase()] || 'max'
  }
}
function rawServer(id: string): any {
  return serverCache.get(String(id))
}
function updateRawServer(id: string, patch: any, sampleTs?: any): any {
  const old = rawServer(id) || { id }
  const next = { ...old, ...patch }
  if (patch?.disk && typeof patch.disk === 'object') next.disk = { ...(old.disk || {}), ...patch.disk }
  if (patch?.last_updated == null && sampleTs != null) next.last_updated = toMillis(sampleTs)
  serverCache.set(String(id), next)
  return next
}
export function applyCfsmSample(id: string, patch: any, sampleTs?: any): LiveRecord {
  const next = updateRawServer(id, patch, sampleTs)
  const live = mapServerToLive(next)
  S.live[id] = live
  const updated = toMillis(next.last_updated || sampleTs, 0)
  if (updated && Date.now() - updated < 300000) S.online.add(id)
  else S.online.delete(id)
  return live
}
function rawServers(): any[] {
  return serversCache.value?.servers || []
}
function getTasks(): PingTaskDef[] {
  if (taskCache) return taskCache
  const defs = [
    { id: 1, key: 'ct', name: sysConfig.custom_ct_name || configValue.custom_ct_name || '电信' },
    { id: 2, key: 'cu', name: sysConfig.custom_cu_name || configValue.custom_cu_name || '联通' },
    { id: 3, key: 'cm', name: sysConfig.custom_cm_name || configValue.custom_cm_name || '移动' },
    { id: 4, key: 'bd', name: sysConfig.custom_bd_name || configValue.custom_bd_name || 'BGP' }
  ]
  const clients = rawServers().map((s: any) => String(s.id))
  taskCache = defs.map(x => ({ id: x.id, name: String(x.name), clients }))
  return taskCache
}
function snapshotPingRecords(uuid: string): any {
  const server = rawServer(uuid)
  if (!server) return { tasks: [], records: [] }
  const tasks = getTasks()
  if (sysConfig.show_three_net_details !== true) return { tasks: [], records: [] }
  const keys = ['ct', 'cu', 'cm', 'bd']
  const values = new Map<number, { time: string; values: Record<string, any>; losses: Record<string, any> }>()
  const add = (rows: any[], to: 'values' | 'losses') => {
    ;(Array.isArray(rows) ? rows : []).forEach(point => {
      const ts = toMillis(point?.ts, 0)
      if (!ts) return
      const record = values.get(ts) || { time: new Date(ts).toISOString(), values: {}, losses: {} }
      keys.forEach(key => {
        if (point[key] !== undefined) record[to][key] = point[key]
      })
      values.set(ts, record)
    })
  }
  add(server.ping, 'values')
  add(server.loss, 'losses')
  const taskId: Record<string, number> = { ct: 1, cu: 2, cm: 3, bd: 4 }
  const records: any[] = []
  for (const point of [...values.values()].sort((a, b) => +new Date(a.time) - +new Date(b.time))) {
    keys.forEach(key => {
      const value = point.values[key]
      const loss = point.losses[key]
      if (value === undefined && loss === undefined) return
      const lossValue = numberOrNull(loss)
      const latency = value === false || value === null || value === undefined
        ? -1
        : numberOrNull(value)
      records.push({
        task_id: taskId[key],
        time: point.time,
        value: latency === null ? -1 : (lossValue !== null && lossValue >= 1 && latency >= 0 ? -1 : latency)
      })
    })
  }
  return { tasks, records }
}
function normalizeHours(hours: any): string {
  const value = String(hours || '1')
  if (HISTORY_HOURS.has(value)) return value
  const n = Number(value)
  if (Number.isFinite(n)) {
    const candidate = ['0.167', '0.5', '1', '6', '12', '24', '48', '96', '168']
      .find(v => Number(v) >= n)
    return candidate || '168'
  }
  return '1'
}
function historyRows(uuid: string, hours: any): Promise<any[]> {
  const h = normalizeHours(hours)
  const key = String(uuid) + '|' + h
  if (!historyCache.has(key)) {
    const pending = requestJson('/api/history/all?id=' + encodeURIComponent(uuid) + '&hours=' + h)
      .then(rows => Array.isArray(rows) ? rows : [])
      .catch(error => { historyCache.delete(key); throw error })
    historyCache.set(key, pending)
  }
  return historyCache.get(key) as Promise<any[]>
}
function historyRecords(uuid: string, rows: any[]): any[] {
  const node = S.nodes.find(n => n.uuid === uuid)
  return rows.map(row => {
    const time = toISO(row.timestamp || row.ts)
    return {
      time,
      cpu: numberOrNull(row.cpu),
      ram: bytesOrZero(row.ram_used),
      ram_total: bytesOrZero(row.ram_total) || node?.mem_total || 0,
      disk: bytesOrZero(row.disk_used),
      disk_total: bytesOrZero(row.disk_total) || node?.disk_total || 0,
      net_in: numberOrNull(row.net_in_speed),
      net_out: numberOrNull(row.net_out_speed),
      connections: numberOrNull(row.tcp_conn),
      connections_udp: numberOrNull(row.udp_conn),
      gpu_info: row.gpu_info,
      disk_io: row.disk,
      processes: numberOrNull(row.processes)
    }
  }).filter(row => !!row.time)
}
export async function saveCfsmThemeOptions(options: Record<string, any>): Promise<any> {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('theme_options 必须为对象')
  const result = await requestJson('/api/theme_options', {
    method: 'POST',
    body: JSON.stringify({ theme_options: options })
  })
  configValue = { ...configValue, theme_options: result.theme_options || options }
  return result.theme_options || options
}

async function getJson(path: string): Promise<any> {
  const url = new URL(path, API_BASE)
  const pathname = url.pathname
  if (pathname === '/api/public') {
    const config = await apiConfig()
    return {
      sitename: config.site_title || 'NanoMuse',
      theme_settings: config.theme_options || {},
      record_preserve_time: 168,
      ping_record_preserve_time: config.latency_window?.hours || 2
    }
  }
  if (pathname === '/api/nodes') {
    const data = await apiServers()
    return data.servers.map(mapServerToNode)
  }
  if (pathname === '/api/me') {
    const config = await apiConfig()
    return { logged_in: config.authorization === true }
  }
  if (pathname === '/api/records/load') {
    const uuid = url.searchParams.get('uuid') || ''
    const rows = await historyRows(uuid, url.searchParams.get('hours'))
    return { records: historyRecords(uuid, rows) }
  }
  if (pathname === '/api/records/ping') {
    return snapshotPingRecords(url.searchParams.get('uuid') || '')
  }
  throw new Error('NanoMuse 已阻止访问非 CFSM API：' + pathname)
}
async function loadPublic(): Promise<void> {
  try {
    const config = await apiConfig()
    configValue = config
    ;(window as any).__CFSM_CONFIG__ = config
    const opts = config.theme_options && typeof config.theme_options === 'object' && !Array.isArray(config.theme_options)
      ? config.theme_options : {}
    S.site = String(config.site_title || 'NanoMuse')
    S.ts = opts as ThemeSettings
    S.recordHours = 168
    S.pingHours = Number(config.latency_window?.hours || 2)
    const powered = document.querySelector<HTMLAnchorElement>('footer a[href*="CF-Server-Monitor"]')
    if (powered) powered.title = 'CF-Server-Monitor ' + String(config.version || '')
  } catch (error) {
    console.warn('[NanoMuse] CFSM config', error)
    throw error
  }
}
async function loadNodes(): Promise<void> {
  const data = await apiServers()
  S.nodes = data.servers.map(mapServerToNode).sort((a: any, b: any) => (a.weight || 0) - (b.weight || 0))
  S.online = new Set()
  for (const server of data.servers) {
    const id = String(server.id)
    S.live[id] = mapServerToLive(server)
    if (isOnline(server)) S.online.add(id)
  }
  S.lastSync = new Date()
  sysConfig = data.sysConfig || {}
  taskCache = null
}
async function loadMe(): Promise<void> {
  try {
    const config = await apiConfig()
    S.loggedIn = config.authorization === true
  } catch {
    S.loggedIn = false
  }
}
async function hasMetricStore(): Promise<boolean> {
  // CFSM does not expose Komari metric-store RPC. Avoid fan-out history reads;
  // node detail uses its one-node /api/history/all route instead.
  return false
}
async function queryMetrics(_keys: string[], _options: any): Promise<any[]> {
  return []
}
async function rpc2(method: string, _params: any): Promise<any> {
  if (method === 'public:listMetricDefinitions') return []
  if (method === 'public:getPublicPingTasks') return getTasks()
  if (method === 'public:getPingMetricStats') return { stats: [] }
  if (method === 'common:getNodesLatestStatus') {
    const result: Record<string, any> = {}
    S.nodes.forEach(node => {
      const server = rawServer(node.uuid)
      if (server) result[node.uuid] = { online: isOnline(server) }
    })
    return result
  }
  throw new Error('当前 CFSM API 不支持 NanoMuse 的操作：' + method)
}
async function pingTasks(): Promise<PingTaskDef[]> {
  return getTasks()
}
function probesFor(defs: PingTaskDef[], uuid: string): boolean {
  return defs.some(def => !Array.isArray(def.clients) || def.clients.includes(uuid))
}
async function pmap<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>, limit: number): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let index = 0
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (index < items.length) {
      const current = index++
      try { out[current] = await fn(items[current], current) } catch { out[current] = null as R }
    }
  }))
  return out
}
function resetMetricStore(): void {}
function resetPingTasks(): void { taskCache = null }
function unbiasPing<T>(series: T[]): T[] { return series }

export {
  getJson,
  hasMetricStore,
  loadMe,
  loadNodes,
  loadPublic,
  pingTasks,
  pmap,
  probesFor,
  queryMetrics,
  resetMetricStore,
  resetPingTasks,
  rpc2,
  unbiasPing
}
