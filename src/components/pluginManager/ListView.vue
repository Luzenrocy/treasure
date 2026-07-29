<template>
  <div class="list-view">
    <el-table
      :data="plugins"
      style="width: 100%"
      @selection-change="handleSelectionChange"
    >
      <el-table-column type="selection"  prop="pluginId" />
      <el-table-column prop="pluginCode" label="插件名称">
        <template #default="{ row }">
          <el-link type="primary" @click="openPlugin(row)">{{ row.pluginCode }}</el-link>
        </template>
      </el-table-column>
      <el-table-column prop="pluginAlias" label="中文名称" />
      <el-table-column prop="pluginVersion" label="版本号" width="80" />
      <el-table-column label="更新时间" width="100">
        <template #default="{ row }">
          {{ formatDate(row.updatedAt) }}
        </template>
      </el-table-column>
      <el-table-column label="操作">
        <template #default="{ row }">
          <el-button size="small" @click="editPlugin(row)">编辑</el-button>
          <el-button v-if="row.pluginType === 1" size="small" type="warning" @click="syncManifest(row)">更新</el-button>
          <el-button size="small" :disabled="row.pluginCode === 'treasure'" type="danger" @click="showDeleteDialog(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script lang="ts">
import {defineComponent} from "vue";
import {Plugin} from "@/class";

export  default defineComponent({
  name: "pluginManager",
  props:['plugins','selectedPlugins',''],
  components: {},
  data(){
    return {
    }
  },
  mounted() {
  },
  computed:{
    currentView(){
    }
  },
  watch:{

  },
  methods: {
    // 格式化日期
    formatDate (date: any): string {
      if (!date) return '-'
      return new Date(Number(date)).toLocaleDateString()
    },
    // 打开插件
    openPlugin (plugin:Plugin)  {
      this.$emit('openPlugin', plugin)
    },
    // 编辑插件
    editPlugin (plugin:Plugin)  {
      // 触发父组件事件或处理逻辑
      this.$emit('editPlugin', plugin)
    },
    // 删除确认对话框
    showDeleteDialog (plugin:Plugin)  {
      this.$emit('showDeleteDialog', plugin)
    },
    // 处理选中项变化
    handleSelectionChange (val:Plugin[]) {
      let pluginIds = [] as number[]
      val.forEach(item => {
        pluginIds.push(item.pluginId)
      })
      this.selectedPlugins.splice(0)
      this.selectedPlugins.push(...pluginIds)
    },
    syncManifest(plugin: any) {
      this.$emit('syncManifest', plugin)
    }
  }
})
</script>

<style scoped>
.list-view {
  height: 100%;
  background-color: var(--treasure-background-color);
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}
.el-table{
  --el-table-header-bg-color: var(--treasure-background-color);
  --el-table-tr-bg-color: var(--treasure-background-color);
  --el-table-bg-color: var(--treasure-background-color);
}

/* ── 列表操作按钮（轻量化） ────────────────────────────── */

/* 素缟 (Default) —— 编辑 */
:deep(.el-button:not(.el-button--warning):not(.el-button--danger)) {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(126, 108, 87, 0.15);
  color: #655b4f;
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.2s ease;
}
:deep(.el-button:not(.el-button--warning):not(.el-button--danger):hover) {
  background: rgba(255, 255, 255, 0.90);
  border-color: #8b6cc1;
  color: #8b6cc1;
}

/* 秋香轻量 (Warning light) —— 更新 */
:deep(.el-button--warning) {
  background: rgba(214, 167, 88, 0.12);
  border-color: rgba(214, 167, 88, 0.30);
  color: #d6a758;
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.2s ease;
}
:deep(.el-button--warning:hover) {
  background: linear-gradient(135deg, #eecb8e 0%, #d6a758 100%);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 3px 10px rgba(214, 167, 88, 0.25);
}

/* 丹砂轻量 (Danger light) —— 删除 */
:deep(.el-button--danger) {
  background: rgba(201, 94, 94, 0.10);
  border-color: rgba(201, 94, 94, 0.25);
  color: #c95e5e;
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.2s ease;
}
:deep(.el-button--danger:hover) {
  background: linear-gradient(135deg, #df7d7d 0%, #c95e5e 100%);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 3px 10px rgba(201, 94, 94, 0.25);
}
</style>