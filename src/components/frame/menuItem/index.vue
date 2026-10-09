<script lang="ts">
import {defineComponent, PropType} from "vue";
import IconItem from "@/components/frame/iconItem/index.vue";
import {MenuItem} from "@/class/index.ts";

export default defineComponent({
  name: 'menuItem',
  components: {IconItem},
  props: {
    item: {
      type: Object as PropType<MenuItem>,
      required: true
    }
  },
  computed: {
    noChildren() {
      const children = this.item.children || []
      return children.length === 0
    },
    /** 从 menuPath 提取 pluginCode（插件菜单格式：/plugin/{pluginCode}） */
    pluginCode(): string {
      const path = this.item.menuPath || '';
      if (path.startsWith('/plugin/')) {
        return path.replace('/plugin/', '');
      }
      return '';
    }
  },
  methods: {
    handLink(item:MenuItem) {
      this.$emit('handLink', item)
    },
    setTitleEl(el: any) {
      this.titleEl = el instanceof HTMLElement ? el : null;
    },
    /**
     * 悬浮：仅文字就地展开完整名称。
     * 侧边栏宽度固定（128px）且外层滚动容器 overflow:auto 会裁剪溢出的文字，
     * 因此把原 title 元素临时定位到原位（left/top 不变），文字完整显示后离开即恢复。
     * 透明背景、无新增元素、无卡片感——视觉上就是这段文字在原位置"变长"了。
     */
    showExpand() {
      const el = this.titleEl;
      if (!el) return;
      // 未被省略（文字完整可见）时不做任何变化
      if (el.scrollWidth <= el.clientWidth) return;
      const rect = el.getBoundingClientRect();
      const s = el.style;
      s.position = 'fixed';
      s.left = `${rect.left}px`;
      s.top = `${rect.top}px`;
      s.width = 'auto';
      s.minWidth = '0';
      s.maxWidth = 'none';
      s.overflow = 'visible';
      s.textOverflow = 'clip';
      s.background = 'transparent';
      s.zIndex = '999';
    },
    hideExpand() {
      const el = this.titleEl;
      if (!el) return;
      const s = el.style;
      s.position = '';
      s.left = '';
      s.top = '';
      s.width = '';
      s.minWidth = '';
      s.maxWidth = '';
      s.overflow = '';
      s.textOverflow = '';
      s.background = '';
      s.zIndex = '';
    }
  },
  data() {
    return {
      titleEl: null as HTMLElement | null,
    }
  }
})
</script>

<template>
  <el-menu-item v-if="noChildren" :index="item.menuId" @click="handLink(item)" >
    <icon-item :icon="item.menuIcon" :pluginCode="pluginCode"/>
    <template #title>
      <span class="menu-item-title" :ref="setTitleEl"
            @mouseenter="showExpand" @mouseleave="hideExpand">{{ item.menuName }}</span>
    </template>
  </el-menu-item>
  <el-sub-menu v-else :index="item.menuId">
    <template #title>
      <icon-item :icon="item.menuIcon" :pluginCode="pluginCode"/>
      <span class="menu-item-title" :ref="setTitleEl"
            @mouseenter="showExpand" @mouseleave="hideExpand">{{ item.menuName }}</span>
    </template>
    <menu-item v-for="child in item.children" :item="child" />
  </el-sub-menu>
</template>

<style scoped>
/* 菜单项标题：占满剩余宽度，超长省略（悬浮时由 JS 就地展开完整文字） */
.menu-item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
</style>