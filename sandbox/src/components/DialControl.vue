<script setup lang="ts">
defineProps<{
  modelValue: number
  label: string
  min: number
  max: number
  step: number
  display: string
  hint: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

function onInput(event: Event): void {
  emit('update:modelValue', Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <label class="dial">
    <span class="dial-head">
      <span class="dial-label">{{ label }}</span>
      <span class="dial-value">{{ display }}</span>
    </span>
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :disabled="disabled"
      @input="onInput"
    />
    <span class="dial-hint">{{ hint }}</span>
  </label>
</template>
