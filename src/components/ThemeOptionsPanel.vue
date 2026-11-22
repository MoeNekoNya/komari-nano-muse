<script setup>
import { reactive, watch } from 'vue'
const props = defineProps({ modelValue: { type: Object, required: true }, saving: Boolean, canSave: Boolean })
const emit = defineEmits(['update:modelValue', 'save', 'close'])
const draft = reactive({ ...props.modelValue })
watch(() => props.modelValue, value => Object.assign(draft, value), { deep: true })
function update() { emit('update:modelValue', { ...draft }) }
</script>

<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <section class="settings-panel">
      <div class="panel-heading"><div><span class="eyebrow">PERSONALIZATION</span><h2>主题设置</h2></div><button class="icon-button" @click="$emit('close')" aria-label="关闭">×</button></div>
      <label class="field-label">卡片布局
        <select v-model="draft.layout" @change="update"><option value="grid">网格</option><option value="list">列表</option></select>
      </label>
      <label class="field-label">卡片密度
        <select v-model="draft.density" @change="update"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select>
      </label>
      <label class="field-label">主题强调色
        <input type="color" v-model="draft.accent" @input="update" />
      </label>
      <label class="switch-line"><span>显示三网延迟小图</span><input type="checkbox" v-model="draft.showMiniCharts" @change="update" /></label>
      <p class="hint">设置保存在 CFSM 服务端的 theme_options 中，不写入浏览器本地存储。保存需要已登录的 JWT。</p>
      <button class="primary-button full-width" :disabled="saving || !canSave" @click="$emit('save', { ...draft })">{{ saving ? '正在保存…' : '保存到服务端' }}</button>
      <a class="admin-link" href="/admin#/admin">前往管理后台登录</a>
    </section>
  </div>
</template>
