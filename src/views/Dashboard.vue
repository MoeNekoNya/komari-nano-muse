<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { state, loadDashboard, deactivatePage, reconnectRealtime } from '../composables/useMonitor.js'
import ServerCard from '../components/ServerCard.vue'
import { formatSpeed, isOnline } from '../utils/format.js'
import awakeCharacter from '../assets/char-awake-cutout.webp'

const query = ref('')
const filter = ref('all')
const servers = computed(() => state.servers.filter(server => {
  const matchesText = !query.value || [server.name, server.region, server.server_group, server.tags].join(' ').toLowerCase().includes(query.value.toLowerCase())
  const matchesFilter = filter.value === 'all' || (filter.value === 'online' ? isOnline(server) : !isOnline(server))
  return matchesText && matchesFilter
}))
const firstConfig = computed(() => state.configs[0]?.config || {})
onMounted(loadDashboard)
onBeforeUnmount(() => deactivatePage('dashboard'))
</script>

<template>
  <section class="dashboard-page">
    <div class="hero-panel">
      <div class="hero-copy">
        <span class="eyebrow">NANOMUSE / SERVER OBSERVATORY</span>
        <h1>静默观测，<em>持续在线。</em></h1>
        <p>每一次心跳，都在这里留下清晰的轨迹。</p>
      </div>
      <img class="hero-character" :src="awakeCharacter" alt="NanoMuse 值班员" />
      <div class="hero-orbit" aria-hidden="true"><span></span><i></i><b></b></div>
      <div class="hero-foot"><span><i class="live-indicator"></i> {{ state.wsState === 'live' ? '实时数据已连接' : state.wsState === 'paused' ? '页面隐藏，连接已暂停' : '等待实时连接' }}</span><span>{{ state.configs[0]?.config?.version || 'CFSM' }}</span></div>
    </div>

    <div v-if="state.error" class="error-panel"><strong>数据加载失败</strong><p>{{ state.error }}</p><button class="outline-button" @click="loadDashboard">重试</button></div>
    <div v-else-if="state.loading" class="loading-panel"><span class="loader"></span>正在读取服务器列表…</div>

    <template v-else>
      <div class="overview-grid">
        <article class="overview-tile"><span>SERVER NODES</span><strong>{{ state.stats.total }}</strong><small>服务器总数</small></article>
        <article class="overview-tile"><span>ONLINE</span><strong class="positive">{{ state.stats.online }}</strong><small>在线节点</small></article>
        <article class="overview-tile"><span>OFFLINE</span><strong class="negative">{{ state.stats.offline }}</strong><small>离线节点</small></article>
        <article class="overview-tile"><span>GLOBAL TRAFFIC</span><strong class="overview-speed">{{ formatSpeed(state.stats.globalSpeedIn) }}</strong><small>↓ 入站 · ↑ {{ formatSpeed(state.stats.globalSpeedOut) }}</small></article>
      </div>

      <div class="section-heading">
        <div><span class="eyebrow">NODE ARRAY</span><h2>服务器阵列 <small>{{ servers.length }} / {{ state.stats.total }}</small></h2></div>
        <div class="toolbar">
          <input v-model="query" class="search-input" placeholder="搜索名称、区域或标签…" />
          <select v-model="filter" class="filter-select"><option value="all">全部状态</option><option value="online">在线</option><option value="offline">离线</option></select>
          <button class="outline-button" v-if="state.wsState === 'error' || state.wsState === 'stopped'" @click="reconnectRealtime">重新连接</button>
        </div>
      </div>

      <div v-if="!servers.length" class="empty-panel">没有匹配的服务器。</div>
      <div class="server-grid" :class="[{ 'list-layout': state.themeOptions.layout === 'list' }, 'density-' + state.themeOptions.density]">
        <ServerCard v-for="server in servers" :key="server._apiBase + ':' + server.id" :server="server"
          :config="state.configs.find(entry => entry.base === server._apiBase)?.config || firstConfig"
          :options="state.themeOptions" />
      </div>
    </template>
  </section>
</template>
