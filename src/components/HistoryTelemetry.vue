<script setup>
import { computed } from 'vue'
import { state } from '../composables/useMonitor.js'
import { getGpuList, metricState } from '../utils/format.js'
import Sparkline from './Sparkline.vue'

const config = computed(() => state.configs.find(entry => entry.base === state.detail?._apiBase)?.config || {})
const lines = computed(() => [
  { label: config.value.custom_ct_name || 'CT', ping: 'ping_ct', loss: 'loss_ct' },
  { label: config.value.custom_cu_name || 'CU', ping: 'ping_cu', loss: 'loss_cu' },
  { label: config.value.custom_cm_name || 'CM', ping: 'ping_cm', loss: 'loss_cm' },
  { label: config.value.custom_bd_name || 'BGP', ping: 'ping_bd', loss: 'loss_bd' },
  ...[1,2,3,4].map(n => ({ label: config.value['node_' + n + '_name'] || ('Node ' + n), ping: 'ping_node_' + n, loss: 'loss_node_' + n }))
])
const visibleLines = computed(() => lines.value.filter(line =>
  state.history.some(row => metricState(row[line.ping]) !== 'missing' || metricState(row[line.loss]) !== 'missing')
))
const timeoutCount = key => state.history.filter(row => row[key] === null).length
const gpuSamples = computed(() => state.history.map(row => getGpuList(row.gpu_info)).filter(items => items.length))
const gpuDevices = computed(() => {
  const map = new Map()
  for (const items of gpuSamples.value) for (const gpu of items) map.set(String(gpu.id), gpu.name || ('GPU ' + gpu.id))
  return [...map.entries()].map(([id, name]) => ({ id, name }))
})
const gpuRows = computed(() => state.history.map(row => {
  const items = getGpuList(row.gpu_info)
  return { timestamp: row.timestamp, ...Object.fromEntries(items.map(gpu => [String(gpu.id), gpu.info])) }
}))
const hasDiskHistory = computed(() => state.history.some(row => row.disk && typeof row.disk === 'object' && Object.values(row.disk).some(value => Number.isFinite(Number(value)) && Number(value) !== 0)))
</script>

<template>
  <section v-if="visibleLines.length || gpuDevices.length || hasDiskHistory" class="content-panel history-extra">
    <span class="eyebrow">HISTORY / NETWORK TELEMETRY</span>
    <h2>历史网络与设备指标</h2>
    <div v-if="visibleLines.length" class="history-lines">
      <div v-for="line in visibleLines" :key="line.ping" class="history-line">
        <div class="history-line-head"><strong>{{ line.label }}</strong><span>{{ timeoutCount(line.ping) }} 个延迟超时 · {{ timeoutCount(line.loss) }} 个丢包超时</span></div>
        <div class="history-line-charts">
          <div><small>延迟 (ms)</small><Sparkline :points="state.history" :field="line.ping" /></div>
          <div><small>丢包 (%)</small><Sparkline :points="state.history" :field="line.loss" color="var(--bad)" /></div>
        </div>
      </div>
    </div>
    <div v-if="gpuDevices.length" class="history-gpu">
      <h3>GPU 历史采样</h3>
      <div v-for="gpu in gpuDevices" :key="gpu.id" class="history-line">
        <div class="history-line-head"><strong>{{ gpu.name }}</strong><span>{{ gpuRows.filter(row => typeof row[gpu.id] === 'number').length }} 个有效采样</span></div>
        <Sparkline :points="gpuRows" :field="gpu.id" />
      </div>
    </div>
    <div v-if="hasDiskHistory" class="history-gpu">
      <h3>磁盘 IO 历史</h3>
      <div class="history-line">
        <div class="history-line-head"><strong>读取 / 写入</strong><span>仅展示历史行内存在的 disk 对象</span></div>
        <div class="history-line-charts">
          <div><small>读取 B/s</small><Sparkline :points="state.history.filter(row => row.disk).map(row => ({ value: row.disk.read_bps }))" field="value" /></div>
          <div><small>写入 B/s</small><Sparkline :points="state.history.filter(row => row.disk).map(row => ({ value: row.disk.write_bps }))" field="value" color="var(--accent-2)" /></div>
        </div>
      </div>
    </div>
  </section>
</template>
