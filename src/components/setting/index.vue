<template>
  <div class="setting-container">
    <div class="setting-form-wrap">
      <el-form label-width="120px" label-suffix=":">
        <el-card
          v-for="(group, index) in groupedSettings"
          :key="index"
          class="setting-group"
        >
          <div class="group-title">
            <span class="title-spacer" :style="getSpacerStyle(group)"></span>
            <template v-for="(char, i) in getPluginNameChars(group.pluginName)" :key="i">
              <span class="char">{{ char }}</span>
              <span
                v-if="i < getPluginNameChars(group.pluginName).length - 1"
                class="title-spacer"
                :style="getSpacerStyle(group)"
              ></span>
            </template>
            <span
              v-if="getPluginNameChars(group.pluginName).length > 0"
              class="title-spacer"
              :style="getSpacerStyle(group)"
            ></span>
          </div>
          <el-form-item class="setting-item"
            size="large"
            v-for="item in group.settings" 
            :key="item.id" 
            :label="item.param_name"
          >
            <el-input 
              v-if="item.param_type === 'input'" 
              v-model="item.param_value" clearable
              v-bind="safeJsonParse(item.param_properties, {})"
              :placeholder="item.param_placeholder"
            />
            <el-input-number
              v-else-if="item.param_type === 'number'"
              :model-value="Number(item.param_value)"
              @update:model-value="item.param_value = String($event)"
              v-bind="safeJsonParse(item.param_properties, {})"
              :placeholder="item.param_placeholder"
            />
            <el-input
              v-else-if="item.param_type === 'dir'"
              v-model="item.param_value"
              clearable
              readonly
              v-bind="safeJsonParse(item.param_properties, {})"
              :placeholder="item.param_placeholder"
              @click="loadLocalDir(item)"
            >
              <template #append>
                <el-button @click="loadLocalDir(item)" icon="Folder">选择</el-button>
              </template>
            </el-input>
            <el-select 
              v-else-if="item.param_type === 'select'" 
              v-model="item.param_value"
              v-bind="safeJsonParse(item.param_properties, {})"
            >
              <el-option 
                v-for="opt in safeJsonParse(item.param_options, [])" 
                :key="opt.value" 
                :label="opt.label" 
                :value="opt.value"
              />
            </el-select>
            <el-checkbox-group 
            v-else-if="item.param_type === 'checkbox'" 
            v-model="item.param_value" :label="item.param_name" size="large"
            v-bind="safeJsonParse(item.param_properties, {})"
              >
              <el-checkbox 
                v-for="opt in safeJsonParse(item.param_options, [])" 
                :key="opt.value" 
                :label="opt.label" 
                :value="opt.value"  
              />
            </el-checkbox-group>
            <el-radio-group v-else-if="item.param_type === 'radio'" 
            v-model="item.param_value" :label="item.param_name" size="large"
            v-bind="safeJsonParse(item.param_properties, {})"
            >
              <el-radio
                v-for="opt in safeJsonParse(item.param_options, [])"
                :key="opt.value"
                :label="opt.label"
              />
            </el-radio-group>
            <el-select
              v-else-if="item.param_type === 'time'"
              v-model="item.param_value"
              v-bind="safeJsonParse(item.param_properties, {
                start: '00:00',
                end: '23:30',
                step: '00:30'
              })"
              :multiple="safeJsonParse(item.param_properties, {}).multiple || false"
              :placeholder="item.param_placeholder"
            >
              <el-option
                v-for="opt in generateTimeOptions(safeJsonParse(item.param_properties, {}))"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
            <el-switch v-else-if="item.param_type === 'switch'" 
              v-model="item.param_value" :label="item.param_name"
              class="mb-2"
              :active-text="safeJsonParse(item.param_options, {})['activeText']"
              :inactive-text="safeJsonParse(item.param_options, {})['inActiveText']"
              :active-value="safeJsonParse(item.param_options, {})['activeValue']"
              :inactive-value="safeJsonParse(item.param_options, {})['inactiveValue']"
            />
          </el-form-item>
        </el-card> 
      </el-form>
    </div>
    <div class="setting-actions">
      <el-button type="primary" :loading="saving" @click="saveAllSettings">更新</el-button>
      <el-button type="primary" @click="loadSettings">还原</el-button>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { getSettings, saveSetting } from '@/sql/service';
import { ElMessage } from 'element-plus';
import {useMenuStore} from "@/store/menu";
import { open } from '@tauri-apps/plugin-dialog';
import { logEvent, setLogLevel } from '@/utils/logger';

export default defineComponent({
  name: 'Setting',
  data() {
    return {
      settings: [] as any[],
      menuStore: useMenuStore(),
      saving: false,
    };
  },
  computed: {
    groupedSettings(): any[] {
      const groups: any = {};
      this.settings.forEach(setting => {
        if (setting.menu_id && !String(setting.param_code).startsWith('treasure::')) return;
        if (!groups[setting.plugin_id]) {
          groups[setting.plugin_id] = {
            pluginId: setting.plugin_id,
            pluginName: setting.plugin_alias,
            settings: []
          };
        }
        groups[setting.plugin_id].settings.push(setting);
      });
      return Object.values(groups);
    }
  },
  async created() {
    await logEvent('info', 'sys', 'open_setting', { action: 'open' });
    await this.loadSettings();
  },
  methods: {
    /** 安全解析 JSON，失败时记录错误日志并返回空对象/空数组 */
    safeJsonParse(json: string | null | undefined, fallback: any = {}): any {
      if (!json || typeof json !== 'string') {
        return fallback;
      }
      try {
        return JSON.parse(json);
      } catch (e) {
        logEvent('error', 'db', 'setting_json_parse_failed', {
          json: json.substring(0, 200),
          error: e instanceof Error ? e.message : String(e),
        }).catch(() => {});
        return fallback;
      }
    },
    getPluginNameChars(pluginName: string | null | undefined): string[] {
      return Array.from(pluginName || '');
    },
    getSpacerStyle(group: { pluginName?: string; settings: any[] }): Record<string, string> {
      const characterCount = this.getPluginNameChars(group.pluginName).length;
      const settingHeight = group.settings.length * 62 + 20;
      const characterHeight = characterCount * 26;
      const spacerHeight = Math.max(0, settingHeight - characterHeight) / (characterCount + 1);

      return { height: `${spacerHeight}px` };
    },
    /** 根据 start/end/step 生成时间选项列表 */
    generateTimeOptions(props: Record<string, any>): Array<{ label: string; value: string }> {
      const start = props.start || '00:00';
      const end = props.end || '23:30';
      const step = props.step || '00:30';

      const [startH, startM] = start.split(':').map(Number);
      const [endH, endM] = end.split(':').map(Number);
      const [stepH, stepM] = step.split(':').map(Number);
      const stepMinutes = stepH * 60 + stepM;

      const options: Array<{ label: string; value: string }> = [];
      let current = startH * 60 + startM;
      const endTotal = endH * 60 + endM;

      while (current <= endTotal) {
        const h = Math.floor(current / 60);
        const m = current % 60;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        options.push({ label: timeStr, value: timeStr });
        current += stepMinutes;
      }

      return options;
    },
    async loadSettings() {
      const res = await getSettings();
      if (res.code === 1) {
        this.settings = res.data.map((item: any) => {
          if (item.param_type === 'switch') {
            try {
              const options = JSON.parse(item.param_options || '{}');
              if (!options.activeValue && !options.inactiveValue) {
                return {
                  ...item,
                  param_options: JSON.stringify({
                    ...options,
                    activeText: options.activeText || '开',
                    inActiveText: options.inActiveText || '关',
                    activeValue: '1',
                    inactiveValue: '0',
                  }),
                };
              }
            } catch {
              return {
                ...item,
                param_options: JSON.stringify({
                  activeText: '开',
                  inActiveText: '关',
                  activeValue: '1',
                  inactiveValue: '0',
                }),
              };
            }
          }
          if (item.param_type === 'time') {
            const props = this.safeJsonParse(item.param_properties, {});
            const raw = item.param_value ?? '';
            if (props.multiple && typeof raw === 'string' && raw.includes(',')) {
              return {
                ...item,
                param_value: raw.split(',').map((t: string) => t.trim()).filter(Boolean),
              };
            }
          }
          return item;
        });
      } else {
        ElMessage.error('设置加载失败！原因：' + (res.msg || '未知错误'));
      }
    },
    async loadLocalDir(item: any) {
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title: '选择目录'
        });

        if (selected && typeof selected === 'string') {
          item.param_value = selected;
        }
      } catch (error) {
        console.error('选择目录失败:', error);
        ElMessage.error('选择目录失败');
      }
    },
    async saveAllSettings() {
      this.saving = true;
      try {
        const normalizedSettings = this.settings.map((s: any) => {
          if (s.param_type === 'time') {
            const props = this.safeJsonParse(s.param_properties, {});
            if (props.multiple && Array.isArray(s.param_value)) {
              return { ...s, param_value: s.param_value.join(',') };
            }
            return { ...s, param_value: String(s.param_value ?? '') };
          }
          return s;
        });
        let res = await saveSetting(normalizedSettings)
        if (res.code == 1){
          await logEvent('info', 'sys', 'save_setting', { action: 'save', count: this.settings.length });
          const logLevelSetting = this.settings.find((s: any) => s.param_code === 'treasure::log_level');
          if (logLevelSetting) {
            await setLogLevel(logLevelSetting.param_value);
          }
          await this.menuStore.fetchMenus();
          await this.loadSettings();
          ElMessage.success('设置保存成功');
        } else {
          ElMessage.error(res.msg || '设置保存失败');
        }
      } catch (error) {
        ElMessage.error('设置保存失败');
      } finally {
        this.saving = false;
      }
    }
  }
});
</script>

<style scoped>
.setting-container {
  height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}
.setting-form-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-left: 20px;
  padding-right: 20px;
  padding-top: 20px;
}
.setting-form-wrap::-webkit-scrollbar { width: 6px; }
.setting-form-wrap::-webkit-scrollbar-track { background: transparent; }
.setting-form-wrap::-webkit-scrollbar-thumb { background: #d3d7da; border-radius: 3px; }
.setting-actions {
  flex-shrink: 0;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.setting-group {
  margin-bottom: 20px;
  position: relative;
  overflow: visible !important;
  --el-card-bg-color: transparent;
  background: linear-gradient(135deg, rgba(182, 156, 255, 0.10) 0%, rgba(232, 201, 138, 0.12) 100%);
  border: 1px solid var(--treasure-border-color);
  border-left: 3px solid var(--treasure-side-accent);
  border-radius: 8px;
  box-shadow: 0 2px 8px 0 rgba(126, 108, 87, 0.08);
}

.setting-group :deep(.el-card__header) {
  display: none;
}

.group-title {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateX(-50%) translateY(-50%);
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  font-family: "Ruhua Simeng", "Kaiti", "STKaiti", "楷体", "Xingkai", "STXingkai", "行楷", cursive;
  font-weight: 400;
  font-size: 20px;
  color: #8b7ba8;
  z-index: 10;
  padding: 0;
  background: transparent;
  white-space: nowrap;
}

.group-title .char {
  display: block;
  height: 26px;
  line-height: 26px;
  flex-shrink: 0;
}

.group-title .title-spacer {
  display: block;
  flex-shrink: 0;
}
.setting-item{
  margin-top: 20px;
  width: 80%;
}

/* 适配 Treasure 配色：输入组件背景色与主题一致 */
:deep(.el-input__wrapper),
:deep(.el-select .el-input__wrapper),
:deep(.el-input-number .el-input__wrapper) {
  background-color: var(--treasure-background-color);
  box-shadow: 0 0 0 1px var(--treasure-border-color) inset;
}

:deep(.el-input__inner),
:deep(.el-select .el-input__inner),
:deep(.el-input-number .el-input__inner) {
  background-color: transparent;
}

:deep(.el-select:hover .el-input__wrapper),
:deep(.el-input:hover .el-input__wrapper),
:deep(.el-input-number:hover .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--treasure-side-accent) inset;
}

:deep(.el-select .el-input.is-focus .el-input__wrapper),
:deep(.el-input.is-focus .el-input__wrapper),
:deep(.el-input-number.is-focus .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--treasure-side-accent) inset;
}

/* el-select 下拉框背景色适配 */
:deep(.el-select .el-select__wrapper) {
  background-color: var(--treasure-background-color);
  box-shadow: 0 0 0 1px var(--treasure-border-color) inset;
}

:deep(.el-select .el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--treasure-side-accent) inset;
}

/* el-input-number 加减按钮背景色适配 */
:deep(.el-input-number__decrease),
:deep(.el-input-number__increase) {
  background-color: var(--treasure-background-color);
  border-color: var(--treasure-border-color);
}

:deep(.el-input-number__decrease:hover),
:deep(.el-input-number__increase:hover) {
  background-color: var(--treasure-background-color);
  color: var(--treasure-side-accent);
}

/* el-select 下拉弹窗背景色适配 - 全局生效，因为 dropdown 是 portal 渲染 */
:global(.el-select-dropdown),
:global(.el-popper) {
  background-color: var(--treasure-background-color) !important;
  border-color: var(--treasure-border-color) !important;
}

:global(.el-select-dropdown__item) {
  color: var(--el-text-color-regular) !important;
}

:global(.el-select-dropdown__item:hover),
:global(.el-select-dropdown__item.is-hovering) {
  background-color: var(--treasure-border-color) !important;
}

:global(.el-select-dropdown__item.is-selected) {
  background-color: var(--treasure-background-color) !important;
  color: var(--treasure-side-accent) !important;
  font-weight: 700 !important;
}

:global(.el-select-dropdown__wrap),
:global(.el-select-dropdown__list) {
  background-color: var(--treasure-background-color) !important;
}

/* dir 类型输入框中的 el-button 背景色适配 */
:deep(.el-input-group__append) {
  background-color: var(--treasure-background-color);
  border-color: var(--treasure-border-color);
}

:deep(.el-input-group__append .el-button) {
  background-color: transparent;
  border-color: transparent;
  color: var(--el-text-color-regular);
}

:deep(.el-input-group__append .el-button:hover) {
  background-color: var(--treasure-border-color);
  border-color: var(--treasure-border-color);
  color: var(--treasure-side-accent);
}

/* ── 按钮进阶配色体系 ────────────────────────────────── */
/* 对应 DESIGN-SYSTEM.md 四级按钮方案 */

/* 1. 墨紫 (Primary) —— 更新 */
:deep(.setting-actions .el-button--primary:first-child) {
  background: linear-gradient(135deg, #b095e2 0%, #8b6cc1 100%);
  border-color: transparent;
  color: #fff;
  font-weight: 500;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(139, 108, 193, 0.25);
  transition: all 0.25s ease;
}
:deep(.setting-actions .el-button--primary:first-child:hover) {
  background: linear-gradient(135deg, #c0a8ec 0%, #9b7cd0 100%);
  border-color: transparent;
  box-shadow: 0 6px 18px rgba(139, 108, 193, 0.35);
  transform: translateY(-1px);
}
:deep(.setting-actions .el-button--primary:first-child:active) {
  background: linear-gradient(135deg, #a085d6 0%, #7a5cb2 100%);
  box-shadow: 0 2px 6px rgba(139, 108, 193, 0.30);
  transform: translateY(0);
}

/* 2. 秋香 (Warning / 特权操作) —— 还原 */
:deep(.setting-actions .el-button--primary:last-child) {
  background: linear-gradient(135deg, #eecb8e 0%, #d6a758 100%);
  border-color: transparent;
  color: #fff;
  font-weight: 500;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(214, 167, 88, 0.25);
  transition: all 0.25s ease;
}
:deep(.setting-actions .el-button--primary:last-child:hover) {
  background: linear-gradient(135deg, #f5d9a2 0%, #e0b568 100%);
  border-color: transparent;
  box-shadow: 0 6px 18px rgba(214, 167, 88, 0.35);
  transform: translateY(-1px);
}
:deep(.setting-actions .el-button--primary:last-child:active) {
  background: linear-gradient(135deg, #e0be7e 0%, #c89a4a 100%);
  box-shadow: 0 2px 6px rgba(214, 167, 88, 0.30);
  transform: translateY(0);
}

:deep(.setting-actions .el-button) {
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.25s ease;
}

/* ── time 类型配色适配 ────────────────────────────────── */
/* el-time-select 输入框区域 */
:deep(.el-time-select) {
  .el-input__wrapper {
    background-color: var(--treasure-background-color);
    box-shadow: 0 0 0 1px var(--treasure-border-color) inset;
  }
  .el-input__inner {
    background-color: transparent;
  }
  .el-input__wrapper:hover {
    box-shadow: 0 0 0 1px var(--treasure-side-accent) inset;
  }
  .el-input__wrapper.is-focus {
    box-shadow: 0 0 0 1px var(--treasure-side-accent) inset;
  }
}

/* el-time-select 选中项展示区域背景色适配 */
:deep(.setting-container .el-time-select) {
  --el-tag-bg-color: var(--treasure-border-color) !important;
  --el-tag-border-color: var(--treasure-border-color) !important;
}
:deep(.setting-container .el-time-select .el-select__selected-item) {
  background-color: transparent !important;
  background: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  border-radius: 4px;
  padding: 0;
}
:deep(.setting-container .el-time-select .el-select__selected-item .el-tag),
:deep(.setting-container .el-time-select .el-select__selected-item .el-tag.el-tag--info) {
  background-color: var(--treasure-border-color) !important;
  border-color: var(--treasure-border-color) !important;
  color: var(--el-text-color-regular) !important;
  padding: 0 6px !important;
  border-radius: 4px !important;
  display: inline-flex !important;
  align-items: center !important;
  line-height: 1.5 !important;
}
:deep(.setting-container .el-time-select .el-select__selected-item .el-tag__close) {
  background-color: var(--treasure-background-color) !important;
  color: var(--el-text-color-regular) !important;
  padding: 2px !important;
  margin-left: 4px !important;
  cursor: pointer !important;
  border-radius: 50% !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
}
:deep(.setting-container .el-time-select .el-select__selected-item .el-tag__close:hover) {
  background-color: var(--treasure-side-accent) !important;
  color: #fff !important;
}

/* el-time-select 下拉面板（portal 渲染，需 :global） */
:global(.el-time-select__panel) {
  background-color: var(--treasure-background-color) !important;
  border-color: var(--treasure-border-color) !important;
}
:global(.el-time-select__panel .el-picker-panel__content) {
  background-color: var(--treasure-background-color) !important;
}
:global(.el-time-select__item:hover) {
  background-color: var(--treasure-border-color) !important;
}
:global(.el-time-select__item.is-selected) {
  background-color: var(--treasure-background-color) !important;
  color: var(--treasure-side-accent) !important;
  font-weight: 700 !important;
}

/* 多选 el-select 的 tag 背景色适配 */
:deep(.el-select .el-select__tags .el-tag) {
  background-color: var(--treasure-border-color);
  border-color: var(--treasure-border-color);
  color: var(--el-text-color-regular);
}
:deep(.el-select .el-select__tags .el-tag__close) {
  background-color: var(--treasure-background-color);
  color: var(--el-text-color-regular);
}
:deep(.el-select .el-select__tags .el-tag__close:hover) {
  background-color: var(--treasure-side-accent);
  color: #fff;
}
</style>
