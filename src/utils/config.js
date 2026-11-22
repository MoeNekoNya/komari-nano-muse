function readMeta(name) {
  return document.querySelector('meta[name="' + name + '"]')?.getAttribute('content')?.trim() || ''
}

export function getApiBases() {
  const configured = readMeta('apiBase')
  const raw = configured ? configured.split(',') : [window.location.origin]
  const bases = []
  for (const item of raw) {
    const value = item.trim()
    if (!value) continue
    const url = new URL(value, window.location.origin)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('API Base 只允许 HTTP 或 HTTPS：' + value)
    }
    const origin = url.origin.replace(/\/$/, '')
    if (!bases.includes(origin)) bases.push(origin)
  }
  if (!bases.length) bases.push(window.location.origin)
  return bases
}

export function getBuildRuntime() {
  return {
    title: readMeta('build-title'),
    backgroundImage: readMeta('background-image'),
    cspApi: readMeta('csp-api'),
    cspStatic: readMeta('csp-static')
  }
}
