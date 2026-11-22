import { requestJson, setSiteConfig } from './http.js'

const configPromises = new Map()
const serverListPromises = new Map()
const HISTORY_HOURS = new Set(['0.167', '0.5', '1', '6', '12', '24', '48', '96', '168'])

export function getConfig(base) {
  if (!configPromises.has(base)) {
    const pending = requestJson(base, '/api/config')
      .then(config => {
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('/api/config 返回格式无效')
        setSiteConfig(base, config)
        return config
      })
      .catch(error => {
        configPromises.delete(base)
        throw error
      })
    configPromises.set(base, pending)
  }
  return configPromises.get(base)
}

export function getServers(base) {
  if (!serverListPromises.has(base)) {
    const pending = requestJson(base, '/api/servers')
      .then(result => {
        if (!result || !Array.isArray(result.servers)) throw new Error('/api/servers 缺少 servers 数组')
        return result
      })
      .catch(error => {
        serverListPromises.delete(base)
        throw error
      })
    serverListPromises.set(base, pending)
  }
  return serverListPromises.get(base)
}

export function getServer(base, id) {
  return requestJson(base, '/api/server?id=' + encodeURIComponent(id))
}

export function getHistory(base, id, hours) {
  const value = String(hours)
  if (!HISTORY_HOURS.has(value)) throw new Error('不支持的历史时间范围：' + value)
  return requestJson(base, '/api/history/all?id=' + encodeURIComponent(id) + '&hours=' + value)
}

export function saveThemeOptions(base, themeOptions) {
  if (!themeOptions || typeof themeOptions !== 'object' || Array.isArray(themeOptions)) throw new TypeError('theme_options 必须是非数组对象')
  return requestJson(base, '/api/theme_options', {
    method: 'POST',
    body: JSON.stringify({ theme_options: themeOptions })
  })
}

export const ALLOWED_HISTORY_HOURS = ['0.167', '0.5', '1', '6', '12', '24', '48', '96', '168']
