<script setup>
import { computed, onBeforeUnmount, onMounted, nextTick, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { state, handleVisibilityChange, reconnectRealtime, stopRealtime, saveOptions } from './composables/useMonitor.js'
import { setTurnstileHandler } from './utils/http.js'
import { getBuildRuntime } from './utils/config.js'
import ThemeOptionsPanel from './components/ThemeOptionsPanel.vue'
import HistoryTelemetry from './components/HistoryTelemetry.vue'
import brandMark from './assets/nanomuse-mark.svg'

const router = useRouter()
const route = useRoute()
const buildRuntime = getBuildRuntime()
const settingsOpen = ref(false)
const challengeOpen = ref(false)
const challengeContainer = ref(null)
const viewportWidth = ref(window.innerWidth)
let challengeResolver = null
let widgetId = null
let injectedHeadNodes = []
let injectedScriptNode = null
let injectedFavicon = null

const config = computed(() => state.configs[0]?.config || {})
const canSave = computed(() => {
  try { return !!localStorage.getItem('jwt_token') } catch { return false }
})
const siteTitle = computed(() => config.value.site_title || buildRuntime.title || 'CF Server Monitor')
const background = computed(() => {
  const desktop = config.value.custom_bg || buildRuntime.backgroundImage
  const mobile = config.value.custom_bg_mobile
  const selected = viewportWidth.value <= 720 && mobile ? mobile : desktop
  return selected ? { backgroundImage: 'linear-gradient(110deg, rgba(13,16,31,.82), rgba(13,16,31,.48)), url("' + selected.replace(/"/g, '%22') + '")' } : {}
})
const themeMode = computed(() => {
  const mode = config.value.preferred_theme || 'auto'
  if (mode === 'light' || mode === 'dark') return mode
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
})
const language = computed(() => {
  const value = config.value.default_language || 'auto'
  if (value === 'zh' || value === 'en') return value
  return /^zh/i.test(navigator.language || '') ? 'zh' : 'en'
})

watch([themeMode, language, siteTitle], ([theme, lang, title]) => {
  document.documentElement.dataset.theme = theme
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  document.title = title
}, { immediate: true })

watch(() => config.value.custom_head, raw => {
  for (const node of injectedHeadNodes) node.remove()
  injectedHeadNodes = []
  if (!raw) return
  const template = document.createElement('template')
  template.innerHTML = String(raw)
  for (const child of [...template.content.childNodes]) {
    const node = child.cloneNode(true)
    document.head.appendChild(node)
    injectedHeadNodes.push(node)
  }
})

watch(() => config.value.custom_script, raw => {
  injectedScriptNode?.remove()
  injectedScriptNode = null
  if (!raw) return
  const script = document.createElement('script')
  script.textContent = String(raw)
  script.dataset.cfsmCustomScript = 'true'
  document.body.appendChild(script)
  injectedScriptNode = script
})

watch(() => config.value.favicon, value => {
  injectedFavicon?.remove()
  injectedFavicon = null
  if (!value) return
  const link = document.createElement('link')
  link.rel = 'icon'
  link.href = value
  document.head.appendChild(link)
  injectedFavicon = link
})

function onResize() { viewportWidth.value = window.innerWidth }

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve()
  if (window.__cfsmTurnstilePromise) return window.__cfsmTurnstilePromise
  window.__cfsmTurnstilePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = resolve
    script.onerror = () => reject(new Error('Turnstile 脚本加载失败，请检查 CSP_STATIC / 网络连接'))
    document.head.appendChild(script)
  })
  return window.__cfsmTurnstilePromise
}

function finishChallenge(token, error) {
  const complete = challengeResolver
  challengeResolver = null
  challengeOpen.value = false
  if (widgetId && window.turnstile) {
    try { window.turnstile.remove(widgetId) } catch { /* already removed */ }
  }
  widgetId = null
  if (complete) complete(token, error)
}

function challenge(_base, siteKey) {
  return new Promise((resolve, reject) => {
    challengeResolver = (token, error) => error ? reject(error) : resolve(token)
    challengeOpen.value = true
    nextTick(async () => {
      try {
        await loadTurnstileScript()
        if (!challengeContainer.value || !window.turnstile) throw new Error('Turnstile 容器未就绪')
        widgetId = window.turnstile.render(challengeContainer.value, {
          sitekey: siteKey,
          theme: themeMode.value,
          callback: token => finishChallenge(token),
          'error-callback': () => finishChallenge(null, new Error('Turnstile 验证失败')),
          'expired-callback': () => finishChallenge(null, new Error('Turnstile 验证已过期'))
        })
      } catch (error) {
        finishChallenge(null, error)
      }
    })
  })
}

async function saveTheme(values) {
  try {
    await saveOptions(values)
    settingsOpen.value = false
  } catch (error) {
    state.themeMessage = error?.message || String(error)
  }
}
function cancelChallenge() { finishChallenge(null, new Error('Turnstile 验证已取消')) }

// Register before RouterView child onMounted hooks can start API requests.
setTurnstileHandler(challenge)

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('resize', onResize, { passive: true })
})
onBeforeUnmount(() => {
  setTurnstileHandler(null)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('resize', onResize)
  if (challengeResolver) cancelChallenge()
  injectedHeadNodes.forEach(node => node.remove())
  injectedScriptNode?.remove()
  injectedFavicon?.remove()
})
</script>

<template>
  <div class="app-shell" :style="{ ...background, '--accent': state.themeOptions.accent || '#8b7cf6' }" :data-page="route.name || 'home'">
    <header class="topbar">
      <a class="brand" href="#/" @click.prevent="router.push({ name: 'home' })">
        <img class="brand-mark-image" :src="brandMark" alt="NanoMuse" />
        <span><strong>{{ siteTitle }}</strong><small>静默观测站 / NANO MUSE</small></span>
      </a>
      <nav class="main-nav">
        <a href="#/" :class="{ active: route.name === 'home' }" @click.prevent="router.push({ name: 'home' })">总览</a>
        <a href="/admin#/admin">管理后台 ↗</a>
      </nav>
      <div class="top-actions">
        <span class="connection-pill" :class="state.wsState"><i></i>{{ state.wsState === 'live' ? 'LIVE' : state.wsState === 'reconnecting' ? 'RECONNECTING' : state.wsState === 'paused' ? 'PAUSED' : state.wsState === 'timeout' ? 'TIMEOUT' : state.wsState === 'error' ? 'OFFLINE' : 'CONNECTING' }}</span>
        <button class="icon-button" title="主题设置" @click="settingsOpen = true">⚙</button>
      </div>
    </header>
    <main class="main-content">
      <RouterView />
      <HistoryTelemetry v-if="route.name === 'server' && state.detail" />
    </main>
    <footer class="site-footer">
      <span>© {{ new Date().getFullYear() }} {{ siteTitle }}</span>
      <a href="https://github.com/huilang-me/CF-Server-Monitor/" target="_blank" rel="noopener" :title="'CF Server Monitor ' + (config.version || '')">Powered by CF Server Monitor</a>
    </footer>

    <div v-if="state.timeoutPrompt" class="modal-backdrop">
      <section class="settings-panel timeout-panel">
        <span class="eyebrow">WEBSOCKET SESSION</span><h2>实时连接已达到时限</h2>
        <p>站点设置的实时订阅时长已到。是否继续接收实时更新？</p>
        <div class="button-row"><button class="outline-button" @click="stopRealtime">停止连接</button><button class="primary-button" @click="reconnectRealtime">继续连接</button></div>
      </section>
    </div>

    <div v-if="challengeOpen" class="modal-backdrop challenge-backdrop">
      <section class="settings-panel challenge-panel">
        <span class="eyebrow">CLOUDFLARE SECURITY CHECK</span><h2>完成安全验证</h2>
        <p>此站点启用了 Turnstile，请完成验证后继续访问监控数据。</p>
        <div ref="challengeContainer" class="turnstile-container"></div>
        <button class="outline-button full-width" @click="cancelChallenge">取消</button>
      </section>
    </div>

    <ThemeOptionsPanel v-if="settingsOpen" :model-value="state.themeOptions" :saving="state.themeSaving" :can-save="canSave" @update:model-value="state.themeOptions = $event" @save="saveTheme" @close="settingsOpen = false" />
    <div v-if="state.themeMessage" class="toast" role="status">{{ state.themeMessage }} <button @click="state.themeMessage = ''">×</button></div>
  </div>
</template>
