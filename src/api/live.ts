import { uChar } from '../hero/settings'
import { rSummary } from '../hero/summary'
import { rNodes, uNodes } from '../nodes/list'
import { rBilling } from '../pages/billing'
import { uDuty } from '../pages/duty'
import { observe } from '../cast/events'
import { rTraffic } from '../pages/traffic'
import { uDetail } from '../pages/detail'
import { rStab } from '../pages/stability'
import { rMap } from '../pages/worldmap'
import { S } from '../state'
import { $ } from '../utils/format'
import { applyCfsmSample } from './client'

const MAX_RETRIES = 8
let retryTimer: ReturnType<typeof setTimeout> | null = null
let timeoutTimer: ReturnType<typeof setTimeout> | null = null
let manualClose = false
let hiddenClose = false

function setLive(ok: boolean): void {
  S.connected = ok
  document.documentElement.dataset.connection = ok ? 'live' : 'stale'
  const live = $('live')
  live.classList.toggle('ok', ok)
  live.classList.toggle('bad', !ok)
  $('liveTxt').textContent = ok ? '实时连接' : '正在重连'
  live.title = ok ? '已连接 CF-Server-Monitor 实时数据通道' : '实时连接中断，正在按退避策略重试'
  rSummary()
}
function onLive(statusChanged: boolean): void {
  observe()
  rSummary()
  if (S.page === 'dashboard') statusChanged ? rNodes() : uNodes()
  if (S.page === 'duty') uDuty()
  if (S.page === 'detail') uDetail()
  if (S.page === 'worldmap' && statusChanged) rMap()
  if (S.page === 'stability' && statusChanged) rStab()
  if (S.page === 'billing' && statusChanged) rBilling()
  if (S.page === 'traffic') rTraffic()
  uChar(false)
}
function scheduleRetry(): void {
  if (manualClose || hiddenClose || retryTimer || document.visibilityState === 'hidden') return
  if (S.wsTries >= MAX_RETRIES) {
    setLive(false)
    $('live').title = '已达到最大重连次数，请刷新页面重试'
    return
  }
  const delay = Math.min(2000 * Math.pow(1.5, S.wsTries), 30000)
  S.wsTries++
  retryTimer = setTimeout(() => {
    retryTimer = null
    connect()
  }, delay)
}
function stopTimers(): void {
  if (retryTimer) clearTimeout(retryTimer)
  if (timeoutTimer) clearTimeout(timeoutTimer)
  retryTimer = null
  timeoutTimer = null
}
function closeSocket(code = 1000, reason = 'page hidden'): void {
  stopTimers()
  const ws = S.ws
  S.ws = null
  if (ws) {
    ws.onclose = null
    try { ws.close(code, reason) } catch { /* already closed */ }
  }
}
function handleTimeout(): void {
  timeoutTimer = null
  closeSocket(1000, 'frontend websocket timeout')
  setLive(false)
  const keep = window.confirm('实时连接已达到后台设定的时限。是否继续接收实时数据？')
  if (keep) {
    S.wsTries = 0
    connect()
  } else {
    manualClose = true
    $('liveTxt').textContent = '已暂停'
    $('live').title = '实时更新已暂停；刷新页面可重新连接'
  }
}
function acceptUpdate(update: any): boolean {
  const id = String(update?.serverId || update?.server_id || '')
  if (!id || !Array.isArray(update.samples)) return false
  let changed = false
  for (const sample of update.samples) {
    const data = sample?.data || sample?.payload || sample?.metrics
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue
    const before = S.online.has(id)
    applyCfsmSample(id, data, sample.ts || sample.timestamp)
    if (before !== S.online.has(id)) changed = true
  }
  return changed
}
function handleMessage(raw: string): void {
  let message: any
  try { message = JSON.parse(raw) } catch { return }
  if (message?.type === 'pong' || message?.type === 'ping' || message?.type === 'subscribed') return
  const updates = Array.isArray(message?.updates)
    ? message.updates
    : message?.serverId && Array.isArray(message.samples)
      ? [message]
      : []
  if (!updates.length) return
  let statusChanged = false
  updates.forEach((update: any) => { statusChanged = acceptUpdate(update) || statusChanged })
  S.lastSync = new Date()
  onLive(statusChanged)
}
function socketUrl(): string {
  const url = new URL('/api/ws', window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('subscribe', 'all')
  const config = (window as any).__CFSM_CONFIG__ || {}
  let jwt: string | null = null
  try { jwt = localStorage.getItem('jwt_token') } catch { /* storage disabled */ }
  if (config.authorization !== true && config.is_public !== true && jwt) url.searchParams.set('token', jwt)
  return url.toString()
}
function connect(): void {
  if (manualClose || hiddenClose || document.visibilityState === 'hidden') return
  if (S.ws && (S.ws.readyState === WebSocket.CONNECTING || S.ws.readyState === WebSocket.OPEN)) return
  stopTimers()
  let ws: WebSocket
  try {
    ws = new WebSocket(socketUrl())
  } catch {
    setLive(false)
    scheduleRetry()
    return
  }
  S.ws = ws
  ws.onopen = () => {
    if (S.ws !== ws || manualClose) { ws.close(); return }
    S.wsTries = 0
    setLive(true)
    const ids = S.nodes.map(node => node.uuid).filter(Boolean)
    if (!ids.length) return
    ws.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids }))
    const minutes = Number(((window as any).__CFSM_CONFIG__ || {}).frontend_ws_timeout_minutes || 0)
    if (minutes > 0) timeoutTimer = setTimeout(handleTimeout, minutes * 60000)
  }
  ws.onmessage = event => {
    if (S.ws !== ws) return
    handleMessage(String(event.data || ''))
  }
  ws.onerror = () => {
    try { ws.close() } catch { /* already closed */ }
  }
  ws.onclose = () => {
    if (S.ws === ws) S.ws = null
    if (timeoutTimer) clearTimeout(timeoutTimer)
    timeoutTimer = null
    if (manualClose || hiddenClose) return
    setLive(false)
    scheduleRetry()
  }
}
function visibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    hiddenClose = true
    closeSocket()
    S.liveVia = null
    return
  }
  if (hiddenClose) {
    hiddenClose = false
    S.wsTries = 0
    connect()
  }
}
function connectOnPage(): void {
  if (!document.documentElement.dataset.cfsmLiveBound) {
    document.documentElement.dataset.cfsmLiveBound = '1'
    document.addEventListener('visibilitychange', visibilityChange)
    window.addEventListener('pagehide', () => {
      manualClose = true
      closeSocket()
    }, { once: true })
  }
  connect()
}

export { connectOnPage as connect, setLive }
