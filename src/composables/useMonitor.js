import { reactive } from 'vue'
import { getApiBases } from '../utils/config.js'
import { getConfig, getServers, getServer, getHistory, saveThemeOptions } from '../utils/api.js'
import { HttpError } from '../utils/http.js'

const bases = getApiBases()
const records = new Map()
const pending = new Map()
let flushTimer = null
let currentDetailId = null

export const state = reactive({
  page: null, configs: [], configLoaded: false, servers: [],
  stats: { total: 0, online: 0, offline: 0, globalSpeedIn: 0, globalSpeedOut: 0, globalNetRx: 0, globalNetTx: 0 },
  sysConfigs: {}, serverBaseById: {}, dashboardLoaded: false, loading: false,
  detailLoading: false, detail: null, history: [], historyHours: '0.167',
  error: '', detailError: '', wsState: 'idle', wsTimedOut: false, wsStopped: false,
  timeoutPrompt: false,
  themeOptions: { layout: 'grid', density: 'comfortable', accent: '#8b7cf6', showMiniCharts: true },
  themeSaving: false, themeMessage: ''
})

function isServerOnline(server) {
  const updated = Number(server?.last_updated)
  return Number.isFinite(updated) && updated > 0 && Date.now() - updated < 5 * 60 * 1000
}

function mergeObjects(previous, patch) {
  const next = { ...(previous || {}), ...(patch || {}) }
  if (patch?.disk && typeof patch.disk === 'object') next.disk = { ...(previous?.disk || {}), ...patch.disk }
  else if (previous?.disk && patch?.disk === undefined) next.disk = previous.disk
  return next
}

function queueSample(base, serverId, patch, sampleTs) {
  if (!serverId || !patch || typeof patch !== 'object') return
  const key = base + '::' + serverId
  const before = pending.get(key) || {}
  const next = mergeObjects(before, patch)
  if (patch.last_updated == null) next.last_updated = Date.now()
  pending.set(key, next)
  if (!flushTimer) flushTimer = window.setTimeout(flushSamples, 1000)
}

function flushSamples() {
  flushTimer = null
  if (!pending.size) return
  const updates = new Map(pending)
  pending.clear()
  let onlineDelta = 0
  let offlineDelta = 0
  state.servers = state.servers.map(server => {
    const patch = updates.get(server._apiBase + '::' + server.id)
    if (!patch) return server
    const wasOnline = isServerOnline(server)
    // Card latency windows are immutable snapshots from /api/servers only.
    const listPatch = { ...patch }
    delete listPatch.ping
    delete listPatch.loss
    const next = mergeObjects(server, listPatch)
    const nowOnline = isServerOnline(next)
    if (wasOnline !== nowOnline) {
      if (nowOnline) { onlineDelta += 1; offlineDelta -= 1 }
      else { onlineDelta -= 1; offlineDelta += 1 }
    }
    return next
  })
  // Keep API aggregate values as baseline; only update servers crossing the documented five-minute threshold.
  state.stats.online = Math.max(0, state.stats.online + onlineDelta)
  state.stats.offline = Math.max(0, state.stats.offline + offlineDelta)
  if (state.detail) {
    const patch = updates.get(state.detail._apiBase + '::' + state.detail.id)
    if (patch) state.detail = mergeObjects(state.detail, patch)
  }
}

function acceptWsMessage(message, base) {
  if (!message || message.type !== 'batchUpdate' || !Array.isArray(message.updates)) return
  for (const update of message.updates) {
    if (!Array.isArray(update.samples)) continue
    for (const sample of update.samples) {
      const metrics = sample?.data || sample?.payload || sample?.metrics
      if (metrics && typeof metrics === 'object') queueSample(base, update.serverId, metrics, sample.ts)
    }
  }
}

function closeSockets() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
    flushSamples()
  }
  for (const record of records.values()) {
    record.manual = true
    if (record.retryTimer) clearTimeout(record.retryTimer)
    if (record.timeoutTimer) clearTimeout(record.timeoutTimer)
    try { record.socket?.close(1000, 'page lifecycle') } catch { /* already closed */ }
  }
  records.clear()
}

function makeWsUrl(record) {
  const url = new URL('/api/ws', record.base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('subscribe', record.subscribe)
  const sameOrigin = new URL(record.base).origin === window.location.origin
  let jwt = null
  try { jwt = localStorage.getItem('jwt_token') } catch { /* storage disabled */ }
  if (record.config?.is_public !== true && !sameOrigin && jwt) url.searchParams.set('token', jwt)
  return url.toString()
}

const MAX_RETRIES = 8
function scheduleRetry(record) {
  if (record.manual || document.visibilityState === 'hidden' || state.wsTimedOut || state.wsStopped) return
  if (record.attempt >= MAX_RETRIES) {
    state.wsState = 'error'
    return
  }
  const delay = Math.min(1000 * (2 ** record.attempt), 30000)
  record.attempt += 1
  state.wsState = 'reconnecting'
  record.retryTimer = window.setTimeout(() => {
    record.retryTimer = null
    openSocket(record)
  }, delay)
}

function onWsTimeout() {
  state.timeoutPrompt = true
  state.wsTimedOut = true
  state.wsState = 'timeout'
  closeSockets()
}

function openSocket(record) {
  if (record.manual || document.visibilityState === 'hidden') return
  let socket
  try {
    socket = new WebSocket(makeWsUrl(record))
    record.socket = socket
  } catch {
    scheduleRetry(record)
    return
  }
  socket.onopen = () => {
    if (record.manual) { socket.close(); return }
    state.wsState = 'live'
    if (record.subscribe === 'all') socket.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids: record.ids }))
    const timeoutMinutes = Number(record.config?.frontend_ws_timeout_minutes || 0)
    if (timeoutMinutes > 0) record.timeoutTimer = window.setTimeout(onWsTimeout, timeoutMinutes * 60 * 1000)
  }
  socket.onmessage = event => {
    try { acceptWsMessage(JSON.parse(event.data), record.base) } catch { /* malformed frame */ }
  }
  socket.onerror = () => {
    try { socket.close() } catch { /* already closed */ }
  }
  socket.onclose = () => {
    if (record.manual) return
    if (record.timeoutTimer) clearTimeout(record.timeoutTimer)
    scheduleRetry(record)
  }
}

function connectForPage() {
  closeSockets()
  if (state.wsTimedOut || state.wsStopped || document.visibilityState === 'hidden') return
  if (state.page === 'dashboard') {
    for (const entry of state.configs) {
      const ids = state.servers.filter(server => server._apiBase === entry.base).map(server => server.id)
      if (!ids.length) continue
      const record = { base: entry.base, config: entry.config, subscribe: 'all', ids, attempt: 0, manual: false }
      records.set(entry.base, record)
      openSocket(record)
    }
  } else if (state.page === 'detail' && state.detail?._apiBase) {
    const entry = state.configs.find(item => item.base === state.detail._apiBase)
    if (!entry) return
    const record = { base: entry.base, config: entry.config, subscribe: state.detail.id, ids: [], attempt: 0, manual: false }
    records.set(entry.base, record)
    openSocket(record)
  }
  if (records.size) state.wsState = 'connecting'
}

async function loadSiteConfigs() {
  if (state.configLoaded) return
  const loaded = await Promise.all(bases.map(async base => ({ base, config: await getConfig(base) })))
  state.configs = loaded
  const first = loaded[0]?.config || {}
  const saved = first.theme_options && typeof first.theme_options === 'object' && !Array.isArray(first.theme_options) ? first.theme_options : {}
  state.themeOptions = { layout: 'grid', density: 'comfortable', accent: '#8b7cf6', showMiniCharts: true, ...saved }
  state.configLoaded = true
}

export async function loadDashboard() {
  state.page = 'dashboard'
  state.error = ''
  state.loading = !state.dashboardLoaded
  try {
    await loadSiteConfigs()
    if (!state.dashboardLoaded) {
      const responses = await Promise.all(state.configs.map(async entry => ({ base: entry.base, response: await getServers(entry.base) })))
      const list = []
      const stats = { total: 0, online: 0, offline: 0, globalSpeedIn: 0, globalSpeedOut: 0, globalNetRx: 0, globalNetTx: 0 }
      for (const { base, response } of responses) {
        const sysConfig = response.sysConfig || {}
        state.sysConfigs[base] = sysConfig
        for (const server of response.servers) {
          const item = { ...server, _apiBase: base, _sysConfig: sysConfig }
          list.push(item)
          state.serverBaseById[item.id] = base
        }
        for (const key of Object.keys(stats)) stats[key] += Number(response.stats?.[key] || 0)
      }
      list.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      state.servers = list
      state.stats = stats
      state.dashboardLoaded = true
    }
    connectForPage()
  } catch (error) {
    state.error = error?.message || String(error)
  } finally {
    state.loading = false
  }
}

async function locateServer(id) {
  // A detail request must target one known Worker. For a direct deep link whose
  // backend is unknown, use the first configured base rather than querying each Worker.
  const base = state.serverBaseById[id] || bases[0]
  const server = await getServer(base, id)
  return { ...server, _apiBase: base, _sysConfig: server.sysConfig || state.sysConfigs[base] || {} }
}

export async function loadServerDetail(id, { refresh = false } = {}) {
  state.page = 'detail'
  state.detailError = ''
  if (!refresh) state.detailLoading = true
  currentDetailId = id
  closeSockets()
  try {
    await loadSiteConfigs()
    const server = await locateServer(id)
    if (currentDetailId !== id) return
    state.detail = server
    state.serverBaseById[id] = server._apiBase
    if (!refresh) {
      state.historyHours = '0.167'
      try {
        const rows = await getHistory(server._apiBase, id, '0.167')
        if (currentDetailId !== id) return
        state.history = Array.isArray(rows) ? rows : []
      } catch (historyError) {
        state.history = []
        state.detailError = '历史指标加载失败：' + (historyError?.message || historyError)
      }
    }
    connectForPage()
  } catch (error) {
    state.detailError = error?.message || String(error)
  } finally {
    state.detailLoading = false
  }
}

export async function changeHistoryRange(hours) {
  if (!state.detail || state.historyHours === String(hours)) return
  const detailId = state.detail.id
  const base = state.detail._apiBase
  state.historyHours = String(hours)
  state.detailError = ''
  try {
    const rows = await getHistory(base, detailId, state.historyHours)
    if (state.detail?.id === detailId) state.history = Array.isArray(rows) ? rows : []
  } catch (error) {
    state.detailError = '历史指标加载失败：' + (error?.message || error)
  }
}

export function deactivatePage(page) {
  if (state.page !== page) return
  currentDetailId = null
  closeSockets()
  state.page = null
  if (!state.wsTimedOut && !state.wsStopped) state.wsState = 'idle'
}

export async function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    closeSockets()
    state.wsState = 'paused'
    return
  }
  if (state.wsTimedOut || state.wsStopped) return
  if (state.page === 'dashboard') {
    // Do not repeat /api/servers: reuse the cached IDs and restore with WS updates.
    connectForPage()
  } else if (state.page === 'detail' && state.detail) {
    await loadServerDetail(state.detail.id, { refresh: true })
  }
}

export function reconnectRealtime() {
  state.timeoutPrompt = false
  state.wsTimedOut = false
  state.wsStopped = false
  state.wsState = 'connecting'
  connectForPage()
}

export function stopRealtime() {
  state.timeoutPrompt = false
  state.wsTimedOut = false
  state.wsStopped = true
  closeSockets()
  state.wsState = 'stopped'
}

export async function saveOptions(options) {
  let jwt = null
  try { jwt = localStorage.getItem('jwt_token') } catch { /* storage disabled */ }
  if (!jwt) throw new Error('保存主题配置需要登录，请先前往管理后台登录')
  state.themeSaving = true
  state.themeMessage = ''
  try {
    for (const entry of state.configs) {
      const existing = entry.config.theme_options && typeof entry.config.theme_options === 'object' && !Array.isArray(entry.config.theme_options) ? entry.config.theme_options : {}
      const next = { ...existing, ...options }
      const result = await saveThemeOptions(entry.base, next)
      entry.config.theme_options = result.theme_options || next
    }
    state.themeOptions = { ...options }
    state.themeMessage = '主题配置已保存到服务端'
  } finally {
    state.themeSaving = false
  }
}
