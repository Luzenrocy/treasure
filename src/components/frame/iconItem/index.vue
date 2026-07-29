<script lang="ts">
import {defineComponent} from "vue";
import PluginIcon from "@/components/common/PluginIcon.vue";
import Plugin from "@/assets/plugin.svg?component";

export default defineComponent({
  name: 'iconItem',
  components: {PluginIcon, Plugin},
  props: {
    icon: {
      type: String,
      required: true
    },
    /** 插件编码，用于构建自定义图标的 plugin:// URL */
    pluginCode: {
      type: String,
      default: ''
    }
  }
})
</script>

<template>
  <!-- 宿主内置图标：plugin.svg 是 Treasure 平台自身图标，不属于 Element Plus 预设 -->
  <!-- 用 el-icon 包裹以保证尺寸/颜色与其他图标一致 -->
  <el-icon v-if="icon === 'plugin'" :size="16">
    <Plugin />
  </el-icon>
  <!-- 其他图标走统一解析 -->
  <PluginIcon v-else :iconRef="icon" :pluginCode="pluginCode" :size="16" />
</template>

<style scoped>

</style>
