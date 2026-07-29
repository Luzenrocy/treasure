<template>
    <div class="plugin-manager-page">
      <el-header height="40px" class="search-header">
        <el-input v-model="searchKeyword" placeholder="请输入插件名称或中文名称" style="width: 194px; margin-right: 20px" />
        <el-button type="primary" @click="handleQuery">查询</el-button>
        <el-button type="primary" @click="handleImport">导入</el-button>
        <el-button v-if="selectedPlugins.length > 0" type="danger" @click="batchDeleteDialogVisible = true">
          删除({{ selectedPlugins.length }})
        </el-button>
        <el-button v-if="debugEnabled" type="warning" @click="debugDialogVisible = true">注册调试插件</el-button>
        <el-button-group style="margin-left: auto">
          <el-button :type="viewType === 'list' ? 'primary' : 'default'" @click="viewType = 'list'">列表视图</el-button>
          <el-button :type="viewType === 'card' ? 'primary' : 'default'" @click="viewType = 'card'">卡片视图</el-button>
        </el-button-group>
      </el-header>

      <el-main class="plugin-manager-container">
        <component :is="currentView"  :plugins="plugins" :selectedPlugins="selectedPlugins"
                  @showDeleteDialog="showDeleteDialog" @editPlugin="editPlugin" @openPlugin="openPlugin"
                  @syncManifest="syncManifest" />
      </el-main>
    </div>

    <el-dialog v-model="editDialogVisible" title="编辑插件">
      <el-form :model="currentPlugin" label-width="auto">
        <el-form-item label="插件id" v-show="false">
          <el-input v-model="currentPlugin.pluginId" />
        </el-form-item>
        <el-form-item label="插件名称">
        <el-input v-model="currentPlugin.pluginCode" placeholder="请输入插件名称" disabled/>
        </el-form-item>
        <el-form-item label="中文名称">
        <el-input v-model="currentPlugin.pluginAlias" placeholder="请输入插件中文名称" />
        </el-form-item>
        <el-form-item label="版本号">
        <el-input v-model="currentPlugin.pluginVersion" placeholder="请输入插件版本号" disabled/>
        </el-form-item>
        <el-form-item label="隐藏菜单">
          <el-radio-group v-model="currentPlugin.menuHidden"  >
            <el-radio-button label="是" :value=1 datatype="number"/>
            <el-radio-button label="否" :value=0 />
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="updatePlugin(currentPlugin); editDialogVisible = false">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="deleteDialogVisible" title="确认删除">
      <p>确定要删除插件 "{{ currentPlugin.pluginAlias}}({{ currentPlugin.pluginCode }})" 吗？</p>
      <template #footer>
        <el-button @click="deleteDialogVisible = false">取消</el-button>
        <el-button type="danger" @click="deletePlugin(currentPlugin.pluginId); deleteDialogVisible = false">删除</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="batchDeleteDialogVisible" title="确认批量删除">
      <p>确定要删除选中的 {{ selectedPlugins.length }} 个插件吗？</p>
      <template #footer>
        <el-button @click="batchDeleteDialogVisible = false">取消</el-button>
        <el-button type="danger" @click="batchDeletePlugins(); batchDeleteDialogVisible = false">删除</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="debugDialogVisible" title="注册调试插件" @open="debugForm.debugUrl = ''">
      <el-form :model="debugForm" label-width="auto">
        <el-form-item label="调试地址">
          <el-input v-model="debugForm.debugUrl" placeholder="http://localhost:5173" />
        </el-form-item>
        <p class="debug-hint">注册后将自动从调试地址拉取 manifest.json 解析插件信息</p>
      </el-form>
      <template #footer>
        <el-button @click="debugDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="debugLoading" @click="registerDebugPlugin(); debugDialogVisible = false">注册</el-button>
      </template>
    </el-dialog>
</template>
<script lang="ts">
import {defineComponent} from "vue";
import ListView from "@/components/pluginManager/ListView.vue";
import CardView from "@/components/pluginManager/CardView.vue";
import {deletePluginById, getPlugins, createDebugPlugin, updatePluginMenuHidden, isDebugSwitchEnabled} from "@/sql/service.ts";
import {ElMessage} from "element-plus";
import {Plugin} from '@/class'
import { open } from '@tauri-apps/plugin-dialog';
import {readTextFile, exists, mkdir, readDir} from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { validateManifest, isPluginCodeExists, getPluginByUid, getPluginByCode, upgradePlugin, upgradePluginSettings, runPluginInitScripts, provisionPluginResources } from '@/sql/platformService';
import { validateDebugUrl } from '@/utils/debugValidator';
import { useMenuStore } from '@/store/menu';
import { useTabsStore } from '@/store/tabs';
import { logEvent } from '@/utils/logger';

export default defineComponent({
  name: "pluginManager",
  components: {},
  data(){
    return {
      plugins: [] as any[],
      selectedPlugins: [],
      viewType: 'list' as 'list' | 'card',
      currentPlugin:  {} as Plugin,
      searchKeyword : '',
      editDialogVisible : false,
      deleteDialogVisible : false,
      importDialogVisible : false,
      batchDeleteDialogVisible : false,
      debugDialogVisible: false,
      debugEnabled: false,
      debugForm: { debugUrl: '' },
      debugLoading: false,
      tabsStore: useTabsStore(),
    }
  },
  mounted() {
    this.loadDebugSwitch()
    this.handleQuery()
  },
  computed:{
    currentView(){
      return this.viewType === 'list' ? ListView : CardView
    }
  },
  methods: {
    async openPlugin(plugin: Plugin) {
      const path = `/plugin/${plugin.pluginCode}`;
      const menu = useMenuStore().menus.find((m: any) => m.menuPath === path);
      const title = menu ? menu.menuName : `${plugin.pluginAlias}(${plugin.pluginCode})`;
      await logEvent('info', 'sys', 'open_plugin', { pluginCode: plugin.pluginCode, pluginAlias: plugin.pluginAlias, path, pluginType: plugin.pluginType });
      await this.tabsStore.addTabByPath(path, title, { pluginType: (plugin as any).pluginType, debugUrl: (plugin as any).debugUrl });
      this.$router.push(path);
    },
    editPlugin(plugin: Plugin) {
      this.currentPlugin = plugin
      this.editDialogVisible = true
    },
    async updatePlugin(plugin: Plugin) {
      const res = await updatePluginMenuHidden(plugin.pluginId, plugin.pluginAlias, Number(plugin.menuHidden) === 1 ? 1 : 0);
      if (res.code !== 1) {
        ElMessage.error('保存失败: ' + res.msg);
        return;
      }
      useMenuStore().fetchMenus();
      await this.handleQuery();
      ElMessage.success('保存成功');
    },
    async loadDebugSwitch() {
      this.debugEnabled = await isDebugSwitchEnabled();
    },
    async registerDebugPlugin() {
      const { debugUrl } = this.debugForm;
      if (!debugUrl) {
        ElMessage.warning('请输入调试地址');
        return;
      }
      const v = validateDebugUrl(debugUrl);
      if (!v.valid) {
        ElMessage.error(v.error || '调试地址不合法');
        return;
      }

      this.debugLoading = true;
      try {
        const pluginCode = (await (await fetch(debugUrl.replace(/\/+$/, '') + '/treasure-manifest.json')).json()).name;
        await logEvent('info', 'sys', 'register_debug_plugin', { pluginCode, debugUrl });

        // 从调试服务器拉取 manifest.json 获取插件信息
        const manifestUrl = debugUrl.replace(/\/+$/, '') + '/treasure-manifest.json';
        const manifestResp = await fetch(manifestUrl);
        if (!manifestResp.ok) {
          ElMessage.error('无法从调试地址获取 /treasure-manifest.json，请确认 dev server 已启动');
          return;
        }
        const raw = await manifestResp.text();
        let manifest: any;
        try {
          manifest = JSON.parse(raw);
        } catch {
          ElMessage.error('调试服务器返回的 /treasure-manifest.json 不是有效 JSON');
          return;
        }

        // 从 manifest 提取插件信息
        const pluginCodeFromManifest = manifest.name;
        const pluginAlias = manifest.alias || pluginCodeFromManifest;
        if (!pluginCodeFromManifest) {
          ElMessage.error('manifest.json 缺少 name 字段');
          return;
        }
        if (!/^[a-z][a-z0-9-]*$/.test(pluginCodeFromManifest)) {
          ElMessage.error(`manifest.name "${pluginCodeFromManifest}" 必须为 kebab-case 格式`);
          return;
        }

        // 校验 manifest 完整性
        const validation = validateManifest(manifest);
        if (!validation.valid) {
          ElMessage.error(`manifest 校验失败: ${validation.errors.join('; ')}`);
          return;
        }

        // 拉取所有版本化 init 脚本（可选）
        const initScripts: Record<string, string> = {};
        try {
          const baseUrl = debugUrl.replace(/\/+$/, '');
          const listResp = await fetch(`${baseUrl}/scripts/init/`);
          if (listResp.ok) {
            const files: string[] = await listResp.json();
            for (const file of files) {
              if (!file.endsWith('.sql')) continue;
              const version = file.replace(/\.sql$/, '');
              if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
              const resp = await fetch(`${baseUrl}/scripts/init/${file}`);
              if (resp.ok) initScripts[version] = await resp.text();
            }
          }
          if (Object.keys(initScripts).length > 0) {
            console.log(`[plugin-init] 已拉取 ${Object.keys(initScripts).length} 个 init 脚本:`, Object.keys(initScripts));
          } else {
            console.log('[plugin-init] 未从 dev server 获取到 init 脚本');
          }
        } catch (e) {
          console.warn('[plugin-init] 拉取 init 脚本失败:', e);
        }

        // 注册调试插件
        const res = await createDebugPlugin({ pluginCode: pluginCodeFromManifest, pluginAlias, debugUrl, manifest, initScripts });
        if (res.code !== 1) {
          ElMessage.error('注册失败: ' + res.msg);
          return;
        }

        this.debugForm = { debugUrl: '' };
        useMenuStore().fetchMenus();
        ElMessage.success(`调试插件 "${pluginAlias}" 注册成功（已按 manifest 创建参数与数据表）`);
        await this.handleQuery();
      } finally {
        this.debugLoading = false;
      }
    },
    async syncManifest(plugin: any) {
      if (plugin.pluginType !== 1 || !plugin.debugUrl) {
        ElMessage.warning('仅调试插件支持同步 manifest');
        return;
      }
      const pluginCode = plugin.pluginCode;
      const debugUrl = plugin.debugUrl;

      try {
        const manifestUrl = debugUrl.replace(/\/+$/, '') + '/treasure-manifest.json';
        const manifestResp = await fetch(manifestUrl);
        if (!manifestResp.ok) {
          ElMessage.error('无法获取 manifest.json，请确认调试服务器已启动');
          return;
        }
        const raw = await manifestResp.text();
        let manifest: any;
        try {
          manifest = JSON.parse(raw);
        } catch {
          ElMessage.error('调试服务器返回的 /treasure-manifest.json 不是有效 JSON');
          return;
        }
        if (manifest.name !== pluginCode) {
          ElMessage.error(`manifest.name "${manifest.name}" 与插件编码 "${pluginCode}" 不一致`);
          return;
        }
        const validation = validateManifest(manifest);
        if (!validation.valid) {
          ElMessage.error(`manifest 校验失败: ${validation.errors.join('; ')}`);
          return;
        }

        // 三向 diff 升级参数（保留用户配置值）
        const now = Date.now();
        const pluginId = plugin.pluginId;
        const results = await upgradePluginSettings(pluginId, pluginCode, manifest.settings || [], now);

        useMenuStore().fetchMenus();

        ElMessage.success(`插件 "${plugin.pluginAlias}" manifest 同步成功（删除 ${results.deleted}，新增 ${results.inserted}，更新 ${results.updated} 个参数）`);
        await this.handleQuery();
      } catch (e: any) {
        ElMessage.error(`同步失败: ${e.message || e}`);
      }
    },
    showDeleteDialog(plugin: any){
      this.currentPlugin = plugin
      this.deleteDialogVisible =true
    },
    async handleImport() {
      try {
        const selected = await open({
          multiple: false,
          title: '选择插件 .zip 文件',
          filters: [
            { name: '插件包', extensions: ['zip'] },
          ],
        });
        if (!selected || typeof selected !== 'string') return;

        const isZip = selected.toLowerCase().endsWith('.zip');
        if (!isZip) {
          ElMessage.error('仅支持导入 .zip 插件包');
          return;
        }
        let pluginDir = '';
        let tmpExtractDir = '';

        const appDataPath = await appDataDir();
        const zipBase = selected.split('/').pop()!.replace(/\.zip$/i, '');
        const tmpRoot = `${appDataPath}/tmp`;
        await mkdir(tmpRoot, { recursive: true });
        tmpExtractDir = `${tmpRoot}/${Date.now()}_${zipBase}`;
        await invoke('extract_zip', { zipPath: selected, targetDir: tmpExtractDir });
        const entries = await readDir(tmpExtractDir);
        const manifestCandidate = entries.find(e => e.name === 'manifest.json');
        if (manifestCandidate) {
          pluginDir = tmpExtractDir;
        } else {
          let found = false;
          for (const entry of entries) {
            if (entry.isDirectory) {
              const subManifest = `${tmpExtractDir}/${entry.name}/manifest.json`;
              if (await exists(subManifest)) {
                pluginDir = `${tmpExtractDir}/${entry.name}`;
                found = true;
                break;
              }
            }
          }
          if (!found) {
            ElMessage.error('zip 包内未找到 manifest.json');
            if (tmpExtractDir) {
              await invoke('delete_directory', { path: tmpExtractDir });
            }
            return;
          }
        }

        const manifestPath = `${pluginDir}/manifest.json`;
        if (!(await exists(manifestPath))) {
          ElMessage.error('未找到 manifest.json');
          if (tmpExtractDir) await invoke('delete_directory', { path: tmpExtractDir });
          return;
        }

        const manifestRaw = await readTextFile(manifestPath);
        let manifest: any;
        try {
          manifest = JSON.parse(manifestRaw);
        } catch {
          ElMessage.error('manifest.json 格式无效');
          if (tmpExtractDir) await invoke('delete_directory', { path: tmpExtractDir });
          return;
        }

        const validation = validateManifest(manifest);
        if (!validation.valid) {
          ElMessage.error(`manifest 校验失败: ${validation.errors.join('; ')}`);
          if (tmpExtractDir) await invoke('delete_directory', { path: tmpExtractDir });
          return;
        }

        const manifestUid = manifest.plugin_uid;

        // ── 判断是否需要升级已存在插件 ──────────────────────────
        // ① 有 plugin_uid 且数据库中找到 → 正式插件升级
        // ② 无 plugin_uid 或 uid 未命中 → 按 plugin_code 检查
        let existingPlugin: any = null;

        if (manifestUid) {
          const uidRes = await getPluginByUid(manifestUid);
          if (uidRes.code === 1) {
            existingPlugin = uidRes.data;
            if (existingPlugin.plugin_code !== manifest.name) {
              ElMessage.error('插件指纹与已存在插件编码冲突，拒绝导入');
              if (tmpExtractDir) await invoke('delete_directory', { path: tmpExtractDir });
              return;
            }
            // 正式插件升级（已有 plugin_uid 匹配）
            const upRes = await upgradePlugin(manifest.name, manifest);
            if (upRes.code !== 1) {
              ElMessage.error('升级失败: ' + upRes.msg);
              if (tmpExtractDir) await invoke('delete_directory', { path: tmpExtractDir });
              return;
            }
            // 三向 diff 升级参数（保留用户配置值）
            const existingPluginId = existingPlugin.id;
            await upgradePluginSettings(existingPluginId, manifest.name, manifest.settings || [], Date.now());
            // 执行版本化 init 脚本（增量幂等）
            const upAppDataDirPath = await appDataDir();
            const upTargetDir = `${upAppDataDirPath}/plugin/${manifest.name}`;
            await mkdir(upTargetDir, { recursive: true });
            await invoke('copy_directory', { from: pluginDir, to: upTargetDir });
            await runPluginInitScripts(existingPluginId, manifest.name, upTargetDir);
            useMenuStore().fetchMenus();
            ElMessage.success(`插件 ${manifest.alias} 升级成功`);
            await this.handleQuery();
            if (tmpExtractDir) await invoke('delete_directory', { path: tmpExtractDir });
            return;
          }
        }

        // ② plugin_uid 未命中或不存在 → 按 plugin_code 检查是否存在
        const existsRes = await isPluginCodeExists(manifest.name);
        if (existsRes.code === 1 && existsRes.data === true) {
          const existingRes = await getPluginByCode(manifest.name);
          if (existingRes.code === 1 && existingRes.data.plugin_type === 1) {
            // ── 调试→正式升级路径（调试插件 uid 与 zip 的 uid 不同，按 code 匹配） ──
            const existing = existingRes.data;
            const appDataDirPath = await appDataDir();
            const targetDir = `${appDataDirPath}/plugin/${manifest.name}`;
            const now = Date.now();
            const finalUid = manifest.plugin_uid || existing.plugin_uid;

            // 1. 复制文件到 AppData
            await mkdir(targetDir, { recursive: true });
            await invoke('copy_directory', { from: pluginDir, to: targetDir });

            // 2. 更新 tp_plugin：转为正式插件
            const { execute } = await import('@/sql/common');
            await execute(
              `UPDATE tp_plugin SET plugin_type=0, plugin_version=?, plugin_desc=?, plugin_author=?, plugin_icon=?, plugin_entry=?, plugin_location=?, plugin_uid=?, debug_url=NULL, has_init_script=0, updated_at=? WHERE plugin_code=?`,
              [manifest.version, manifest.description || '', manifest.author || '', manifest.icon || '', manifest.entry, manifest.name, finalUid, now, manifest.name]
            );

            // 3. 更新菜单
            if (manifest.menu) {
              await execute(
                `UPDATE tp_menu SET menu_name=?, show_order=?, updated_at=? WHERE plugin_id=?`,
                [manifest.menu.name, manifest.menu.order || 0, now, existing.id]
              );
            }

            // 4. 三向 diff 升级参数（保留旧值）
            await upgradePluginSettings(existing.id, manifest.name, manifest.settings || [], now);

            // 5. 执行版本化 init 脚本
            await runPluginInitScripts(existing.id, manifest.name, targetDir);

            // 6. 关闭调试插件标签页
            useTabsStore().removeTabsByPluginCode(manifest.name);

            useMenuStore().fetchMenus();
            ElMessage.success(`调试插件 "${manifest.alias}" 已升级为正式插件`);
            await this.handleQuery();
            if (tmpExtractDir) await invoke('delete_directory', { path: tmpExtractDir });
            return;
          } else {
            ElMessage.error(`插件编码 ${manifest.name} 已存在`);
            if (tmpExtractDir) await invoke('delete_directory', { path: tmpExtractDir });
            return;
          }
        }

        const appDataDirPath = await appDataDir();
        const targetDir = `${appDataDirPath}/plugin/${manifest.name}`;

        await mkdir(targetDir, { recursive: true });
        await invoke('copy_directory', { from: pluginDir, to: targetDir });

        const now = Date.now();
        const { execute } = await import('@/sql/common');

        const pluginRes = await execute(
          `INSERT INTO tp_plugin (plugin_code, plugin_alias, plugin_version, plugin_desc, plugin_author, plugin_icon, plugin_entry, plugin_location, has_init_script, has_destroy_script, plugin_type, plugin_uid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [manifest.name, manifest.alias, manifest.version, manifest.description || '', manifest.author || '', manifest.icon || '', manifest.entry, manifest.name, 0, 0, 0, manifestUid || null, now, now]
        );
        if (pluginRes.code !== 1) {
          ElMessage.error('插件注册失败');
          if (tmpExtractDir) await invoke('delete_directory', { path: tmpExtractDir });
          return;
        }
        const pluginId = pluginRes.data.lastInsertId;

        if (manifest.menu) {
          await execute(
            `INSERT INTO tp_menu (menu_id, menu_name, menu_type, menu_level, parent_id, menu_path, menu_icon, show_type, show_order, hidden, plugin_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [manifest.menu.id || `plugin_${manifest.name}`, manifest.menu.name, 2, 1, null, `/plugin/${manifest.name}`, manifest.menu.icon || '', 2, manifest.menu.order || 0, 0, pluginId, now, now]
          );
        }

        // 创建参数声明（manifest.settings）
        await provisionPluginResources(pluginId, manifest.name, manifest, now);

        // 执行所有版本化 init 脚本
        await runPluginInitScripts(pluginId, manifest.name, targetDir);

        useMenuStore().fetchMenus();
        ElMessage.success(`插件 ${manifest.alias} 导入成功`);
        await this.handleQuery();

        if (tmpExtractDir) {
          await invoke('delete_directory', { path: tmpExtractDir });
        }
      } catch (e: any) {
        ElMessage.error(`导入失败: ${e.message || e}`);
      }
    },
    async deletePlugin(pluginId: number) {
      if (!pluginId){
        ElMessage.warning("请选择要删除的插件");
        return
      }
      try {
        const plugin: any = this.plugins.find((p: any) => p.pluginId === pluginId);

        // 先执行数据库清理（execDestroyScript 需要读取 destroy.sql）
        const res = await deletePluginById(pluginId)
        if (res.code !== 1) {
          ElMessage.error('删除失败: ' + res.msg);
          return;
        }

        // 再删除插件文件目录
        if (plugin) {
          const appDataDirPath = await appDataDir();
          await invoke('delete_directory', { path: `${appDataDirPath}/plugin/${plugin.pluginCode}` });
        }

        if (plugin?.pluginCode) {
          const newPath = useTabsStore().removeTabsByPluginCode(plugin.pluginCode);
          if (newPath) {
            this.$router.push(newPath);
          }
        }
        useMenuStore().fetchMenus();
        ElMessage.success("删除成功");
        await this.handleQuery();
        this.currentPlugin = {} as Plugin;
      } catch (e: any) {
        ElMessage.error(`删除失败: ${e.message || e}`);
      }
    },
    async batchDeletePlugins() {
      if (this.selectedPlugins.length === 0) {
        ElMessage.warning("请至少选择一个插件进行删除");
        return;
      }
      try {
        for (const pluginId of this.selectedPlugins) {
          await this.deletePlugin(pluginId);
        }
        ElMessage.success("批量删除成功");
        await this.handleQuery();
        this.selectedPlugins = [];
      } catch (e: any) {
        ElMessage.error(`批量删除失败: ${e.message || e}`);
      }
    },
    async handleQuery(){
      let res = await getPlugins();
      if(res.code != 1){
        ElMessage.error('菜单获取失败！原因：'+res.msg)
      }
      this.plugins = res.data;
    }
  }
})
</script>

<style scoped>
.plugin-manager-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.search-header {
  display: flex;
  align-items: center;
  background-color: var(--treasure-background-color);
  padding: 0 5px !important;
  flex-shrink: 0;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #f5f7fa;
  margin-bottom: 20px;
}
.plugin-manager-container{
  flex: 1;
  min-height: 0;
  padding: 0 !important;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.plugin-manager-container::-webkit-scrollbar { width: 6px; }
.plugin-manager-container::-webkit-scrollbar-track { background: transparent; }
.plugin-manager-container::-webkit-scrollbar-thumb { background: #d3d7da; border-radius: 3px; }
.debug-hint {
  font-size: 12px;
  color: #909399;
  margin: 0;
  line-height: 1.5;
}

/* ── 按钮进阶配色体系 ────────────────────────────────── */

/* 墨紫 (Primary) —— 查询、导入 */
:deep(.search-header .el-button--primary:not(.el-button--danger):not(.el-button--warning)) {
  background: linear-gradient(135deg, #b095e2 0%, #8b6cc1 100%);
  border-color: transparent;
  color: #fff;
  font-weight: 500;
  border-radius: 8px;
  box-shadow: 0 3px 10px rgba(139, 108, 193, 0.22);
  transition: all 0.25s ease;
}
:deep(.search-header .el-button--primary:not(.el-button--danger):not(.el-button--warning):hover) {
  background: linear-gradient(135deg, #c0a8ec 0%, #9b7cd0 100%);
  box-shadow: 0 5px 14px rgba(139, 108, 193, 0.32);
  transform: translateY(-1px);
}
:deep(.search-header .el-button--primary:not(.el-button--danger):not(.el-button--warning):active) {
  background: linear-gradient(135deg, #a085d6 0%, #7a5cb2 100%);
  box-shadow: 0 2px 6px rgba(139, 108, 193, 0.28);
  transform: translateY(0);
}

/* 秋香 (Warning) —— 注册调试插件 */
:deep(.search-header .el-button--warning) {
  background: linear-gradient(135deg, #eecb8e 0%, #d6a758 100%);
  border-color: transparent;
  color: #fff;
  font-weight: 500;
  border-radius: 8px;
  box-shadow: 0 3px 10px rgba(214, 167, 88, 0.22);
  transition: all 0.25s ease;
}
:deep(.search-header .el-button--warning:hover) {
  background: linear-gradient(135deg, #f5d9a2 0%, #e0b568 100%);
  box-shadow: 0 5px 14px rgba(214, 167, 88, 0.32);
  transform: translateY(-1px);
}
:deep(.search-header .el-button--warning:active) {
  background: linear-gradient(135deg, #e0be7e 0%, #c89a4a 100%);
  box-shadow: 0 2px 6px rgba(214, 167, 88, 0.28);
  transform: translateY(0);
}

/* 丹砂 (Danger) —— 删除 */
:deep(.search-header .el-button--danger) {
  background: linear-gradient(135deg, #df7d7d 0%, #c95e5e 100%);
  border-color: transparent;
  color: #fff;
  font-weight: 500;
  border-radius: 8px;
  box-shadow: 0 3px 10px rgba(201, 94, 94, 0.22);
  transition: all 0.25s ease;
}
:deep(.search-header .el-button--danger:hover) {
  background: linear-gradient(135deg, #e99292 0%, #d36c6c 100%);
  box-shadow: 0 5px 14px rgba(201, 94, 94, 0.32);
  transform: translateY(-1px);
}
:deep(.search-header .el-button--danger:active) {
  background: linear-gradient(135deg, #d06a6a 0%, #b84e4e 100%);
  box-shadow: 0 2px 6px rgba(201, 94, 94, 0.28);
  transform: translateY(0);
}

/* 视图切换按钮组 */
:deep(.search-header .el-button-group .el-button) {
  border-radius: 0;
  font-weight: 500;
  transition: all 0.2s ease;
}
:deep(.search-header .el-button-group .el-button:first-child) {
  border-radius: 8px 0 0 8px;
}
:deep(.search-header .el-button-group .el-button:last-child) {
  border-radius: 0 8px 8px 0;
}
/* 视图切换 —— 选中（墨紫扁平） */
:deep(.search-header .el-button-group .el-button--primary) {
  background: linear-gradient(135deg, #b095e2 0%, #8b6cc1 100%);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 2px 8px rgba(139, 108, 193, 0.20);
}
:deep(.search-header .el-button-group .el-button--primary:hover) {
  background: linear-gradient(135deg, #c0a8ec 0%, #9b7cd0 100%);
}
/* 视图切换 —— 未选中（素缟） */
:deep(.search-header .el-button-group .el-button:not(.el-button--primary)) {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(126, 108, 87, 0.15);
  color: #655b4f;
}
:deep(.search-header .el-button-group .el-button:not(.el-button--primary):hover) {
  background: rgba(255, 255, 255, 0.85);
  border-color: #8b6cc1;
  color: #8b6cc1;
}

/* ── 弹窗按钮 ──────────────────────────────────── */
/* 墨紫 (Primary) —— 保存 */
:global(.el-dialog .el-button--primary) {
  background: linear-gradient(135deg, #b095e2 0%, #8b6cc1 100%);
  border-color: transparent;
  color: #fff;
  font-weight: 500;
  border-radius: 8px;
  box-shadow: 0 3px 10px rgba(139, 108, 193, 0.22);
  transition: all 0.25s ease;
}
:global(.el-dialog .el-button--primary:hover) {
  background: linear-gradient(135deg, #c0a8ec 0%, #9b7cd0 100%);
  box-shadow: 0 5px 14px rgba(139, 108, 193, 0.32);
}
:global(.el-dialog .el-button--primary:active) {
  background: linear-gradient(135deg, #a085d6 0%, #7a5cb2 100%);
  box-shadow: 0 2px 6px rgba(139, 108, 193, 0.28);
}
/* 弹窗 —— 取消（素缟） */
:global(.el-dialog .el-button:not(.el-button--primary):not(.el-button--danger)) {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(126, 108, 87, 0.15);
  color: #655b4f;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.2s ease;
}
:global(.el-dialog .el-button:not(.el-button--primary):not(.el-button--danger):hover) {
  background: rgba(255, 255, 255, 0.90);
  border-color: #8b6cc1;
  color: #8b6cc1;
}
</style>
