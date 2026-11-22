export function formatBytes(value, digits = 1) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '--'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let v = Math.abs(n), i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return (i === 0 ? Math.round(v) : v.toFixed(digits)) + ' ' + units[i]
}

export function formatSpeed(value) {
  return formatBytes(value) + '/s'
}

export function formatPercent(value, total) {
  const n = Number(value), t = Number(total)
  if (!Number.isFinite(n) || !Number.isFinite(t) || t <= 0) return '--'
  return Math.min(100, Math.max(0, n / t * 100)).toFixed(1) + '%'
}

export function formatUptime(bootTime) {
  const start = Number(bootTime)
  if (!Number.isFinite(start) || start <= 0) return '--'
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor(seconds % 86400 / 3600)
  return days ? days + ' 天 ' + hours + ' 小时' : hours + ' 小时'
}

export function formatDate(value) {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString()
}

export function isOnline(server) {
  const last = Number(server?.last_updated)
  return Number.isFinite(last) && last > 0 && Date.now() - last < 5 * 60 * 1000
}

export function metricState(value) {
  if (value === false || value === undefined) return 'missing'
  if (value === null) return 'timeout'
  if (typeof value === 'number' && Number.isFinite(value)) return 'value'
  return 'missing'
}

export function displayMetric(value, suffix = 'ms') {
  const status = metricState(value)
  if (status === 'missing') return null
  if (status === 'timeout') return '超时'
  return (Number(value) === 0 ? '0' : Number(value).toFixed(1)) + (suffix ? ' ' + suffix : '')
}

export function getGpuList(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export function humanizeError(error) {
  if (error?.message === 'Failed to fetch') return '无法连接 API，请检查 Worker 地址、CORS_ALLOWED_ORIGINS 和网络连接'
  return error?.message || String(error || '未知错误')
}
