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
    }
  }
})
</script>

<template>
  <el-menu-item v-if="noChildren" :index="item.menuId" @click="handLink(item)" >
    <icon-item :icon="item.menuIcon" :pluginCode="pluginCode"/>
    <template #title>{{ item.menuName }}</template>
  </el-menu-item>
  <el-sub-menu v-else :index="item.menuId">
    <template #title>
      <icon-item :icon="item.menuIcon" :pluginCode="pluginCode"/>
      <span>{{ item.menuName}}</span>
    </template>
    <menu-item v-for="child in item.children" :item="child" />
  </el-sub-menu>
</template>

<style scoped>

</style>
