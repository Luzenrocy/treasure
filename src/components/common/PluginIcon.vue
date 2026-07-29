<script lang="ts">
import { defineComponent, computed, ref, watch } from 'vue';
import { resolveIconRef, type ResolvedIcon } from '@/utils/iconResolver';
import { isPresetIcon, PRESET_ICON_SET } from '@/constants/presetIcons';
import { appDataDir } from '@tauri-apps/api/path';

export default defineComponent({
  name: 'PluginIcon',
  props: {
    /** 图标引用字符串（预设名 / 相对路径 / URL） */
    iconRef: {
      type: String,
      default: '',
    },
    /** 插件编码（用于构建本地绝对路径） */
    pluginCode: {
      type: String,
      default: '',
    },
    /** 图标尺寸（px），默认 16 */
    size: {
      type: [Number, String],
      default: 16,
    },
    /** 降级图标引用（当 iconRef 无效时使用） */
    fallback: {
      type: String,
      default: 'Document',
    },
    /** 是否允许外部 URL 图标，默认 false */
    allowExternalUrl: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    /** 解析后的图标信息 */
    const resolved = computed<ResolvedIcon | null>(() => {
      if (!props.iconRef) return null;

      const raw = props.iconRef.trim();
      if (!props.allowExternalUrl && /^https?:\/\//i.test(raw)) {
        return null;
      }

      return resolveIconRef(raw);
    });

    /** 实际使用的图标引用（解析失败时使用 fallback） */
    const effectiveIconRef = computed(() => {
      return resolved.value?.src || props.fallback;
    });

    /** 图标加载失败标记 */
    const imageError = ref(false);

    /** 重置图片错误状态（当 iconRef 变化时） */
    watch(
      () => props.iconRef,
      () => {
        imageError.value = false;
      }
    );

    /** 图片加载失败处理 */
    function handleImageError() {
      imageError.value = true;
    }

    /** 判断是否为预设图标 */
    const isPreset = computed(() => {
      return isPresetIcon(effectiveIconRef.value);
    });

    /** 自定义路径图标的 SVG 原始内容（内联渲染，支持 currentColor 继承） */
    const svgContent = ref('');

    async function resolvePathIcon() {
      if (!props.pluginCode || !props.iconRef) return;
      const trimmed = props.iconRef.trim();
      if (!trimmed) return;

      const normalized = trimmed.replace(/\\/g, '/').trim().replace(/^\.\//, '').replace(/^\//, '');
      if (!normalized) return;

      try {
        const appDataPath = await appDataDir();
        const absolutePath = `${appDataPath}/plugin/${props.pluginCode}/${normalized}`;
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const text = await readTextFile(absolutePath);
        svgContent.value = text;
        imageError.value = false;
      } catch (e) {
        console.warn('[PluginIcon] resolve path icon failed:', e);
        svgContent.value = '';
      }
    }

    watch(
      () => [props.iconRef, props.pluginCode],
      () => {
        imageError.value = false;
        svgContent.value = '';
        if (props.iconRef && props.pluginCode) {
          const trimmed = props.iconRef.trim();
          if (trimmed && !PRESET_ICON_SET.has(trimmed) && !/^https?:\/\//i.test(trimmed)) {
            resolvePathIcon();
          }
        }
      },
      { immediate: true }
    );

    return {
      resolved,
      effectiveIconRef,
      imageError,
      handleImageError,
      isPreset,
      svgContent,
    };
  },
});
</script>

<template>
  <!-- 预设图标：通过 Element Plus 动态组件渲染 -->
  <el-icon v-if="isPreset" :size="size">
    <component :is="effectiveIconRef" />
  </el-icon>

  <!-- 自定义路径图标：内联 SVG，支持 currentColor 随菜单选中状态变化 -->
  <span
    v-else-if="svgContent && !imageError"
    class="plugin-icon-inline"
    :style="{ fontSize: size + 'px' }"
    v-html="svgContent"
  />

  <!-- 降级：加载失败时显示 fallback -->
  <el-icon v-else-if="imageError" :size="size">
    <component :is="fallback" />
  </el-icon>
</template>

<style scoped>
.plugin-icon-inline {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  vertical-align: -0.15em;
  margin-right: 10px;
  margin-left: 4px;
  color: inherit;
}

.plugin-icon-inline :deep(svg) {
  width: 100%;
  height: 100%;
}
</style>
