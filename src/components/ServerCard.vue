<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Sparkline from './Sparkline.vue'
import { formatSpeed, formatPercent, isOnline, metricState, displayMetric } from '../utils/format.js'
const props = defineProps({ server: { type: Object, required: true }, config: { type: Object, default: () => ({}) }, options: { type: Object, default: () => ({}) } })
const router = useRouter()
const online = computed(() => isOnline(props.server))
const memory = computed(() => formatPercent(props.server.ram_used, props.server.ram_total))
const disk = computed(() => formatPercent(props.server.disk_used, props.server.disk_total))
const showNetworkMini = computed(() =>
  props.server._sysConfig?.show_three_net_details === true &&
  props.options.showMiniCharts !== false &&
  Array.isArray(props.server.ping) && props.server.ping.length > 0
)
const showLossMini = computed(() =>
  props.server._sysConfig?.show_three_net_details === true &&
  props.options.showMiniCharts !== false &&
  Array.isArray(props.server.loss) && props.server.loss.length > 0
)
const pingFields = computed(() => [
  ['ct', props.config.custom_ct_name || 'CT'],
  ['cu', props.config.custom_cu_name || 'CU'],
  ['cm', props.config.custom_cm_name || 'CM'],
  ['bd', props.config.custom_bd_name || 'BGP']
])
const metrics = [
  ['ping_ct', 'loss_ct'], ['ping_cu', 'loss_cu'], ['ping_cm', 'loss_cm'], ['ping_bd', 'loss_bd']
]
const flagSrc = computed(() => {
  const code = String(props.server.region || '').trim().toLowerCase()
  return /^[a-z]{2}$/.test(code) ? new URL('/flags/' + code + '.svg', props.server._apiBase || window.location.origin).toString() : ''
})
const osIconConfigs = [
  ['os-alma.svg', ['alma', 'almalinux']],
  ['os-alpine.webp', ['alpine']],
  ['os-centos.svg', ['centos', 'cent os']],
  ['os-debian.svg', ['debian']],
  ['os-ubuntu.svg', ['ubuntu', 'elementary']],
  ['os-macos.svg', ['macos', 'mac os', 'darwin', 'os x']],
  ['os-windows.svg', ['windows', 'win32', 'win64', 'win10', 'win11', 'win server', 'microsoft']],
  ['os-arch.svg', ['arch']],
  ['os-kail.svg', ['kali']],
  ['os-openwrt.svg', ['openwrt', 'immortalwrt', 'qwrt', 'kwrt']],
  ['os-rocky.svg', ['rocky']],
  ['os-fedora.svg', ['fedora']],
  ['os-openSUSE.svg', ['opensuse', 'open suse', 'suse']],
  ['os-redhat.svg', ['redhat', 'rhel', 'red hat']],
  ['os-mint.svg', ['mint']],
  ['os-manjaro-.svg', ['manjaro']],
  ['os-armbian.png', ['armbian']],
  ['os-synology.ico', ['synology', 'dsm']],
  ['os-proxmox.ico', ['proxmox', 'pve']],
  ['os-alibaba.svg', ['alibaba', 'aliyun', 'alinux', 'anolis', '龙蜥']],
  ['os-opencloud.svg', ['opencloud']]
]
const osIconSrc = computed(() => {
  const os = String(props.server.os || '').toLowerCase()
  const config = osIconConfigs.find(([, keywords]) => keywords.some(keyword => os.includes(keyword)))
  return new URL('/os-icons/' + (config?.[0] || 'os-unknown.svg'), props.server._apiBase || window.location.origin).toString()
})
function open() {
  router.push({ name: 'server', params: { id: props.server.id } })
}
</script>

<template>
  <article class="server-card" :class="{ offline: !online }" tabindex="0" @click="open" @keydown.enter="open">
    <div class="card-topline">
      <div class="server-identity">
        <span class="status-dot" :class="online ? 'online' : 'offline'"></span>
        <div class="server-title-wrap">
          <h3>{{ server.name || 'Unnamed server' }}</h3>
          <p><img v-if="flagSrc" class="region-flag" :src="flagSrc" :alt="server.region" />{{ server.server_group || server.region || '未分组' }} <span v-if="server.os">· <img class="os-icon" :src="osIconSrc" :alt="server.os" />{{ server.os }}</span></p>
        </div>
      </div>
      <span class="status-label" :class="online ? 'online' : 'offline'">{{ online ? 'ONLINE' : 'OFFLINE' }}</span>
    </div>

    <div class="resource-grid">
      <div class="resource">
        <span>CPU</span><strong>{{ Number(server.cpu || 0).toFixed(1) }}<small>%</small></strong>
        <div class="meter"><i :style="{ width: Math.max(0, Math.min(100, Number(server.cpu || 0))) + '%' }"></i></div>
      </div>
      <div class="resource">
        <span>MEMORY</span><strong>{{ memory }}</strong>
        <div class="meter"><i :style="{ width: (memory === '--' ? 0 : parseFloat(memory)) + '%' }"></i></div>
      </div>
      <div class="resource">
        <span>DISK</span><strong>{{ disk }}</strong>
        <div class="meter"><i :style="{ width: (disk === '--' ? 0 : parseFloat(disk)) + '%' }"></i></div>
      </div>
      <div class="resource">
        <span>NETWORK</span><strong class="speed">{{ formatSpeed(server.net_in_speed) }}</strong>
        <small>↑ {{ formatSpeed(server.net_out_speed) }}</small>
      </div>
    </div>

    <div v-if="showNetworkMini || showLossMini" class="latency-strip">
      <div v-for="(item, index) in pingFields" :key="item[0]" class="latency-cell">
        <span>{{ item[1] }}</span>
        <strong v-if="metricState(server[metrics[index][0]]) === 'value'">{{ displayMetric(server[metrics[index][0]]) }}</strong>
        <strong v-else-if="metricState(server[metrics[index][0]]) === 'timeout'" class="timeout">超时</strong>
        <strong v-else>—</strong>
        <Sparkline v-if="showNetworkMini" :points="server.ping" :field="item[0]" />
        <Sparkline v-if="showLossMini" :points="server.loss" :field="item[0]" color="var(--bad)" />
        <small v-if="showLossMini && metricState(server[metrics[index][1]]) !== 'missing'">
          丢包 {{ displayMetric(server[metrics[index][1]], '%') }}
        </small>
      </div>
    </div>

    <div class="card-bottom">
      <span v-if="server.tags" class="tag-list">{{ server.tags }}</span>
      <span class="card-arrow">查看详情 <b>↗</b></span>
    </div>
  </article>
</template>
