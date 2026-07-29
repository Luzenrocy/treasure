<template>
  <div class="card-view">
    <el-row :gutter="20">
      <el-col v-for="plugin in plugins" :key="plugin.pluginId" :span="6" style="padding: 0 5px 10px">
        <el-card class="plugin-card" :ref="'plugin-'+plugin.pluginId" @click="toggleSelection(plugin.pluginId)">
          <div class="card-content" >
            <div class="image-container">
              <PluginIcon :iconRef="plugin.pluginIcon" :pluginCode="plugin.pluginCode" :size="64" :fallback="plugin.menuIcon || 'Document'" />
            </div>
            <div class="info">
              <h3 @click.stop="openPlugin(plugin)">{{ plugin.pluginAlias }}({{ plugin.pluginCode }}) </h3>
              <p>版本号: {{ plugin.pluginVersion }}</p>
              <p>更新时间: {{ formatDate(plugin.updatedAt) }}</p>
            </div>
            <div class="actions">
              <el-button size="small" @click.stop="editPlugin(plugin)">编辑</el-button>
              <el-button v-if="plugin.pluginType === 1" size="small" type="warning" @click.stop="syncManifest(plugin)">更新</el-button>
              <el-button size="small" :disabled="plugin.pluginCode === 'treasure'"  type="danger" @click.stop="showDeleteDialog(plugin); deleteDialogVisible = true">删除</el-button>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script lang="ts">
import {defineComponent} from "vue";
import PluginIcon from "@/components/common/PluginIcon.vue";

export default defineComponent({
  name: "pluginManager",
  components: {PluginIcon},
  props:['plugins','selectedPlugins'],
  data(){
    return {
      filteredPlugins: [],
      deleteDialogVisible : false
    }
  },
  mounted() {
    console.warn('[CardView] mounted', this.plugins.map((p: any) => ({ code: p.pluginCode, icon: p.pluginIcon, type: p.pluginType, menuHidden: p.menuHidden })));
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
    openPlugin (plugin: any) {
      this.$emit('openPlugin', plugin)
    },
    // 切换选中状态
    toggleSelection (pluginId: number)  {
      const el = (this.$refs['plugin-'+pluginId] as any)[0].$el;
      if(el.classList.contains("plugin-selected")){
        el.classList.remove("plugin-selected")
        this.selectedPlugins.splice(this.selectedPlugins.indexOf(pluginId),1)
      }else{
        el.classList.add("plugin-selected")
        this.selectedPlugins.push(pluginId)
      }
    },
    // 判断是否已选中
    isSelected () {

    },
    // 编辑插件
    editPlugin (plugin: any) {
      this.$emit('editPlugin', plugin)

    },
    showDeleteDialog(plugin: any){
      // 设置当前插件并显示对话框
      this.$emit('showDeleteDialog',plugin)
    },
    syncManifest(plugin: any) {
      this.$emit('syncManifest', plugin)
    }
  }
})

</script>

<style scoped>
.card-view {
  height: 100%;
  background-color: var(--treasure-background-color);
  padding: 10px;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  box-sizing: border-box;
}

.plugin-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--treasure-bg-tabs);
  border: 1px solid var(--treasure-border-color);
  transition: all 0.3s ease;
}
.plugin-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.card-content {
  position: relative;
  cursor: pointer;
  padding: 15px;
  transition: all 0.3s ease;
}


.checkbox {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
}

.image-container {
  text-align: center;
  margin-bottom: 15px;
}

.placeholder-image {
  width: 100%;
  height: 150px;
  background-color: #f0f0f0;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 8px;
  overflow: hidden;
}

.placeholder-image .el-icon {
  font-size: 60px;
  color: #999;
}

.info h3 {
  font-size: 16px;
  margin: 10px 0;
  height: 44px;
  overflow: hidden;
  color: var(--treasure-tab-text-active);
}

.info p {
  font-size: 14px;
  color: var(--treasure-tab-text);
  margin: 5px 0;
}

.actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  margin-top: 15px;
}
.actions .el-button {
  flex: 1 1 0;
  min-width: 0;
  padding: 4px 8px;
  font-size: 12px;
  white-space: nowrap;
}

/* ── 卡片操作按钮（轻量化） ────────────────────────────── */

/* 素缟 (Default) —— 编辑 */
.actions .el-button:not(.el-button--warning):not(.el-button--danger) {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(126, 108, 87, 0.15);
  color: #655b4f;
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.2s ease;
}
.actions .el-button:not(.el-button--warning):not(.el-button--danger):hover {
  background: rgba(255, 255, 255, 0.90);
  border-color: #8b6cc1;
  color: #8b6cc1;
}

/* 秋香轻量 (Warning light) —— 更新 */
.actions .el-button--warning {
  background: rgba(214, 167, 88, 0.12);
  border-color: rgba(214, 167, 88, 0.30);
  color: #d6a758;
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.2s ease;
}
.actions .el-button--warning:hover {
  background: linear-gradient(135deg, #eecb8e 0%, #d6a758 100%);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 3px 10px rgba(214, 167, 88, 0.25);
}

/* 丹砂轻量 (Danger light) —— 删除 */
.actions .el-button--danger {
  background: rgba(201, 94, 94, 0.10);
  border-color: rgba(201, 94, 94, 0.25);
  color: #c95e5e;
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.2s ease;
}
.actions .el-button--danger:hover {
  background: linear-gradient(135deg, #df7d7d 0%, #c95e5e 100%);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 3px 10px rgba(201, 94, 94, 0.25);
}
</style>
<style>
.el-card__body {
  padding: 0 !important;
}
.card-content{
  padding: 8px;
}
.info h3{
  height: 22px !important;
}
.info p{
  color: gray;
  font-size: 12px !important;
}
.plugin-selected {
  border: 2px solid var(--treasure-side-accent) !important;
}
</style>