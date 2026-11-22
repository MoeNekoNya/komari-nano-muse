<script setup>
import { computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { state, loadServerDetail, changeHistoryRange, deactivatePage } from '../composables/useMonitor.js'
import { ALLOWED_HISTORY_HOURS } from '../utils/api.js'
import { formatBytes, formatSpeed, formatPercent, formatUptime, formatDate, getGpuList, metricState, displayMetric } from '../utils/format.js'
import Sparkline from '../components/Sparkline.vue'

const props = defineProps({ id: { type: String, required: true } })
const router = useRouter()
const config = computed(() => state.configs.find(entry => entry.base === state.detail?._apiBase)?.config || {})
const detailSys = computed(() => state.detail?._sysConfig || {})
const gpuList = computed(() => getGpuList(state.detail?.gpu_info))
const historyCpu = computed(() => state.history.map(row => ({ value: row.cpu, ts: row.timestamp })))
const historyMemory = computed(() => state.history.map(row => ({ value: row.ram_used, ts: row.timestamp })))
const hasDiskIo = computed(() => !!state.detail?.disk && Object.values(state.detail.disk).some(value => Number.isFinite(Number(value)) && Number(value) !== 0))
const historyDisk = computed(() => state.history.filter(row => row.disk && typeof row.disk === 'object'))
const pingLines = computed(() => [
  ['ct', config.value.custom_ct_name || 'CT', 'ping_ct', 'loss_ct'],
  ['cu', config.value.custom_cu_name || 'CU', 'ping_cu', 'loss_cu'],
  ['cm', config.value.custom_cm_name || 'CM', 'ping_cm', 'loss_cm'],
  ['bd', config.value.custom_bd_name || 'BGP', 'ping_bd', 'loss_bd'],
  ...[1,2,3,4].map(n => ['node_' + n, config.value['node_' + n + '_name'] || ('Node ' + n), 'ping_node_' + n, 'loss_node_' + n])
])
function showMetric(key) { return metricState(state.detail?.[key]) !== 'missing' }
function goBack() { router.push({ name: 'home' }) }
function onHoursChange(event) { changeHistoryRange(event.target.value) }
onMounted(() => loadServerDetail(props.id))
watch(() => props.id, id => loadServerDetail(id))
onBeforeUnmount(() => deactivatePage('detail'))
</script>

<template>
  <section class="detail-page">
    <button class="back-link" @click="goBack">← 返回服务器列表</button>
    <div v-if="state.detailError && !state.detail" class="error-panel"><strong>详情加载失败</strong><p>{{ state.detailError }}</p><button class="outline-button" @click="loadServerDetail(props.id)">重试</button></div>
    <div v-else-if="state.detailLoading && !state.detail" class="loading-panel"><span class="loader"></span>正在读取节点详情…</div>
    <template v-else-if="state.detail">
      <div v-if="state.detailError" class="error-panel"><strong>部分数据加载失败</strong><p>{{ state.detailError }}</p></div>
      <div class="detail-hero">
        <div><span class="eyebrow">NODE DETAIL / {{ state.detail.region || 'UNKNOWN REGION' }}</span><h1>{{ state.detail.name }}</h1><p>{{ state.detail.server_group || '未分组' }} · {{ state.detail.os || '未知系统' }} · {{ state.detail.arch || '--' }}</p></div>
        <div class="detail-status" :class="Number(state.detail.last_updated) > 0 && Date.now() - Number(state.detail.last_updated) < 300000 ? 'positive' : 'negative'">
          <i class="status-dot" :class="Number(state.detail.last_updated) > 0 && Date.now() - Number(state.detail.last_updated) < 300000 ? 'online' : 'offline'"></i>
          {{ Number(state.detail.last_updated) > 0 && Date.now() - Number(state.detail.last_updated) < 300000 ? 'ONLINE' : 'OFFLINE' }}
        </div>
      </div>

      <div class="detail-metric-grid">
        <article class="detail-metric"><span>CPU LOAD</span><strong>{{ Number(state.detail.cpu || 0).toFixed(1) }}<small>%</small></strong><div class="meter"><i :style="{ width: Math.min(100, Number(state.detail.cpu || 0)) + '%' }"></i></div><small>{{ state.detail.cpu_cores || '--' }} cores · {{ state.detail.cpu_info || 'CPU' }}</small></article>
        <article class="detail-metric"><span>MEMORY</span><strong>{{ formatPercent(state.detail.ram_used, state.detail.ram_total) }}</strong><small>{{ formatBytes(Number(state.detail.ram_used || 0) * 1024 * 1024) }} / {{ formatBytes(Number(state.detail.ram_total || 0) * 1024 * 1024) }}</small></article>
        <article class="detail-metric"><span>SWAP</span><strong>{{ formatPercent(state.detail.swap_used, state.detail.swap_total) }}</strong><small>{{ state.detail.swap_used || 0 }} / {{ state.detail.swap_total || 0 }} MB</small></article>
        <article class="detail-metric"><span>DISK</span><strong>{{ formatPercent(state.detail.disk_used, state.detail.disk_total) }}</strong><small>{{ state.detail.disk_used || 0 }} / {{ state.detail.disk_total || 0 }} MB</small></article>
      </div>

      <div class="detail-columns">
        <article class="content-panel">
          <div class="section-heading compact"><div><span class="eyebrow">PERFORMANCE</span><h2>历史指标</h2></div><select class="filter-select" :value="state.historyHours" @change="onHoursChange"><option v-for="hours in ALLOWED_HISTORY_HOURS" :key="hours" :value="hours">{{ hours === '0.167' ? '最近 10 分钟' : hours + ' 小时' }}</option></select></div>
          <div class="history-chart"><div><span>CPU 使用率</span><strong>{{ Number(state.detail.cpu || 0).toFixed(1) }}%</strong></div><Sparkline :points="historyCpu" field="value" /><div class="chart-foot"><span>{{ state.history.length }} 个历史采样点</span><span>来源：/api/history/all</span></div></div>
          <div class="history-chart"><div><span>内存使用量</span><strong>{{ formatBytes(Number(state.detail.ram_used || 0) * 1024 * 1024) }}</strong></div><Sparkline :points="historyMemory" field="value" /><div class="chart-foot"><span>RAM</span><span>{{ state.historyHours }} h</span></div></div>
          <div v-if="hasDiskIo" class="disk-io">
            <h3>磁盘 IO</h3>
            <div class="mini-stat-grid"><div><span>读取</span><strong>{{ formatSpeed(state.detail.disk.read_bps) }}</strong></div><div><span>写入</span><strong>{{ formatSpeed(state.detail.disk.write_bps) }}</strong></div><div><span>读 IOPS</span><strong>{{ state.detail.disk.read_iops }}</strong></div><div><span>写 IOPS</span><strong>{{ state.detail.disk.write_iops }}</strong></div><div><span>等待</span><strong>{{ state.detail.disk.await_ms }} ms</strong></div><div><span>利用率</span><strong>{{ state.detail.disk.util }}%</strong></div></div>
            <small>{{ historyDisk.length }} 条历史行包含 disk 对象</small>
          </div>
        </article>

        <article class="content-panel">
          <span class="eyebrow">NETWORK / TRAFFIC</span><h2>网络与流量</h2>
          <div class="network-stats">
            <div><span>入站速率</span><strong>{{ formatSpeed(state.detail.net_in_speed) }}</strong></div>
            <div><span>出站速率</span><strong>{{ formatSpeed(state.detail.net_out_speed) }}</strong></div>
            <div><span>累计下载</span><strong>{{ formatBytes(state.detail.net_rx) }}</strong></div>
            <div><span>累计上传</span><strong>{{ formatBytes(state.detail.net_tx) }}</strong></div>
            <div><span>月度下载</span><strong>{{ formatBytes(state.detail.net_rx_monthly) }}</strong></div>
            <div><span>月度上传</span><strong>{{ formatBytes(state.detail.net_tx_monthly) }}</strong></div>
          </div>
          <h3 class="subheading">延迟 / 丢包</h3>
          <div class="ping-grid">
            <template v-for="line in pingLines" :key="line[0]">
              <div v-if="showMetric(line[2]) || showMetric(line[3])" class="ping-line">
                <span>{{ line[1] }}</span>
                <strong v-if="metricState(state.detail[line[2]]) === 'value'">{{ displayMetric(state.detail[line[2]]) }}</strong>
                <strong v-else-if="metricState(state.detail[line[2]]) === 'timeout'" class="timeout">超时</strong>
                <strong v-else>—</strong>
                <small v-if="metricState(state.detail[line[3]]) === 'value'">丢包 {{ displayMetric(state.detail[line[3]], '%') }}</small>
                <small v-else-if="metricState(state.detail[line[3]]) === 'timeout'" class="timeout">丢包超时</small>
              </div>
            </template>
          </div>
          <div class="network-stats secondary">
            <div><span>TCP / UDP</span><strong>{{ state.detail.tcp_conn ?? '--' }} / {{ state.detail.udp_conn ?? '--' }}</strong></div>
            <div><span>进程数</span><strong>{{ state.detail.processes ?? '--' }}</strong></div>
            <div><span>运行时间</span><strong>{{ formatUptime(state.detail.boot_time) }}</strong></div>
            <div><span>最后上报</span><strong>{{ state.detail.last_updated ? new Date(Number(state.detail.last_updated)).toLocaleString() : '--' }}</strong></div>
          </div>
        </article>
      </div>

      <article v-if="gpuList.length" class="content-panel gpu-panel">
        <span class="eyebrow">GRAPHICS PROCESSING</span><h2>GPU 信息</h2>
        <div class="gpu-grid"><div v-for="gpu in gpuList" :key="gpu.id"><span>{{ gpu.name || ('GPU ' + gpu.id) }}</span><strong>{{ gpu.info == null ? '--' : gpu.info + '%' }}</strong></div></div>
      </article>

      <article class="content-panel system-panel">
        <span class="eyebrow">SYSTEM INFORMATION</span><h2>系统信息</h2>
        <div class="system-grid">
          <div><span>操作系统</span><strong>{{ state.detail.os || '--' }}</strong></div>
          <div><span>内核</span><strong>{{ state.detail.kernel_version || '--' }}</strong></div>
          <div><span>架构</span><strong>{{ state.detail.arch || '--' }}</strong></div>
          <div><span>CPU</span><strong>{{ state.detail.cpu_info || '--' }}</strong></div>
          <div><span>IPv4</span><strong>{{ state.detail.ip_v4 === '1' ? '可用' : state.detail.ip_v4 === '0' ? '不可用' : '--' }}</strong></div>
          <div><span>IPv6</span><strong>{{ state.detail.ip_v6 === '1' ? '可用' : state.detail.ip_v6 === '0' ? '不可用' : '--' }}</strong></div>
          <div v-if="detailSys.show_price !== false"><span>价格</span><strong>{{ state.detail.price === '0' || state.detail.price === '-1' ? '免费' : state.detail.price || '未设置' }}</strong></div>
          <div v-if="detailSys.show_expire !== false"><span>到期日期</span><strong>{{ formatDate(state.detail.expire_date) }}</strong></div>
          <div v-if="detailSys.show_expire !== false"><span>自动续费</span><strong>{{ state.detail.auto_renewal === '1' ? '开启' : state.detail.auto_renewal === '0' ? '关闭' : '--' }}</strong></div>
          <div v-if="detailSys.show_tf !== false"><span>流量额度</span><strong>{{ state.detail.traffic_limit || '未设置' }}</strong></div>
        </div>
      </article>
    </template>
  </section>
</template>
