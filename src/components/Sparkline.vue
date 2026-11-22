<script setup>
import { computed } from 'vue'
const props = defineProps({
  points: { type: Array, default: () => [] },
  field: { type: String, default: 'ct' },
  color: { type: String, default: 'var(--accent)' }
})
const path = computed(() => {
  const values = props.points.map(point => point?.[props.field]).filter(value => typeof value === 'number' && Number.isFinite(value))
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const coords = values.map((value, index) => {
    const x = 2 + index / (values.length - 1) * 96
    const y = 26 - (value - min) / range * 22
    return [x, y]
  })
  return coords.map((point, index) => (index ? 'L' : 'M') + point[0].toFixed(1) + ',' + point[1].toFixed(1)).join(' ')
})
</script>

<template>
  <svg class="sparkline" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
    <path v-if="path" :d="path" fill="none" :stroke="color" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <path v-else d="M2 25 L98 25" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="1.5" />
  </svg>
</template>
