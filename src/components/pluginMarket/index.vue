<template>
  <div class="plugin-market-page">
    <header class="market-header">
      <div class="market-title">
        <h2>插件市场</h2>
        <p>发现并安装扩展 Treasure 能力的插件</p>
      </div>
      <div class="market-toolbar">
        <el-input
          v-model="keyword"
          class="market-search-input"
          placeholder="搜索插件编码、名称或简介"
          clearable
          :prefix-icon="Search"
          @keyup.enter="loadPlugins"
        />
        <el-button type="primary" :loading="loading" @click="loadPlugins">查询</el-button>
      </div>
    </header>

    <el-alert
      v-if="!marketApiBaseUrl"
      title="请先在系统设置中配置插件市场 API 地址"
      type="warning"
      show-icon
      :closable="false"
      class="market-alert"
    />

    <template v-else>
      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        show-icon
        :closable="false"
        class="market-alert"
      />

      <div class="market-body" v-loading="loading">
        <el-empty v-if="!loading && plugins.length === 0" description="暂无匹配插件" />

        <div v-else class="market-grid">
          <article
            v-for="plugin in plugins"
            :key="plugin.pluginCode"
            class="plugin-card"
            @click="openDetail(plugin)"
          >
            <div class="plugin-card-top">
              <el-avatar class="plugin-avatar" :size="46" :src="plugin.iconUrl">
                <span class="avatar-fallback">{{ initialOf(plugin) }}</span>
              </el-avatar>
              <span class="plugin-status" :class="statusClass(plugin)">{{ installLabel(plugin) }}</span>
            </div>
            <h3 class="plugin-name" :title="plugin.alias">{{ plugin.alias }}</h3>
            <p class="plugin-code">{{ plugin.pluginCode }}</p>
            <p class="plugin-desc">{{ plugin.description || '暂无简介' }}</p>
            <footer class="plugin-card-footer">
              <span class="meta">v{{ plugin.latestVersion }}</span>
              <span class="meta-dot">·</span>
              <span class="meta meta-author">{{ plugin.author || '未知作者' }}</span>
              <el-icon class="plugin-arrow"><ArrowRight /></el-icon>
            </footer>
          </article>
        </div>
      </div>
    </template>

    <el-drawer
      v-model="drawerVisible"
      class="market-drawer"
      direction="rtl"
      :size="440"
      :with-header="false"
      :close-on-click-modal="true"
    >
      <div v-if="selectedPlugin" class="drawer-body">
        <header class="drawer-hero">
          <el-avatar class="plugin-avatar drawer-avatar" :size="56" :src="selectedPlugin.iconUrl">
            <span class="avatar-fallback">{{ initialOf(selectedPlugin) }}</span>
          </el-avatar>
          <div class="drawer-hero-info">
            <h2>{{ selectedPlugin.alias }}</h2>
            <p class="plugin-code">{{ selectedPlugin.pluginCode }}</p>
            <span class="plugin-status" :class="statusClass(selectedPlugin)">{{ installLabel(selectedPlugin) }}</span>
          </div>
          <el-button class="drawer-close" link @click="drawerVisible = false">
            <el-icon :size="18"><Close /></el-icon>
          </el-button>
        </header>

        <div class="drawer-actions">
          <el-button
            type="primary"
            class="install-button"
            :disabled="!canInstallSelected"
            :loading="installProgress.active"
            @click="confirmInstall"
          >
            {{ installActionLabel }}
          </el-button>
        </div>

        <el-alert
          v-if="installProgress.phase === 'success'"
          title="安装完成，可在插件中心打开该插件。"
          type="success"
          show-icon
          :closable="false"
          class="market-alert"
        />
        <div v-else-if="installProgress.active" class="install-progress">
          <el-progress :percentage="installProgress.progress" :text-inside="true" :stroke-width="14" class="install-progress-bar" />
          <el-button link type="primary" @click="cancelInstall">取消</el-button>
        </div>

        <p class="drawer-desc">{{ selectedPlugin.description || '暂无简介' }}</p>

        <section class="drawer-section">
          <h4>基本信息</h4>
          <div class="info-grid">
            <div class="info-row">
              <span class="info-label">版本</span>
              <div class="info-value">
                <el-select
                  v-if="releases.length > 1"
                  v-model="selectedVersion"
                  class="version-select"
                  size="small"
                >
                  <el-option
                    v-for="release in releases"
                    :key="release.version"
                    :label="release.version"
                    :value="release.version"
                    :disabled="isVersionOptionDisabled(release.version)"
                  />
                </el-select>
                <span v-else>v{{ selectedPlugin.latestVersion }}</span>
              </div>
            </div>
            <div class="info-row">
              <span class="info-label">作者</span>
              <span class="info-value">{{ selectedPlugin.author || '-' }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">最低平台版本</span>
              <span class="info-value">{{ selectedPlugin.minPlatformVersion || '-' }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">分类</span>
              <span class="info-value">{{ selectedPlugin.categories?.join('、') || '-' }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">发布日期</span>
              <span class="info-value">{{ formatDate(selectedPlugin.latestPublishedAt) }}</span>
            </div>
          </div>
        </section>

        <section class="drawer-section">
          <h4>权限声明</h4>
          <div v-if="selectedPlugin.permissions?.length" class="permission-list">
            <span
              v-for="permission in selectedPlugin.permissions"
              :key="permission.code || permission.name"
              class="permission-tag"
              :class="riskClass(permission)"
              :title="permission.description || ''"
            >
              {{ permission.name }}
            </span>
          </div>
          <p v-else class="empty-hint">无额外权限声明</p>
        </section>
      </div>
    </el-drawer>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, ArrowRight, Close } from '@element-plus/icons-vue';
import { getSettings, getPlugins } from '@/sql/service';
import {
  fetchMarketPlugins,
  fetchMarketPlugin,
  fetchMarketReleases,
  type MarketPluginSummary,
  type MarketPluginPermission,
  type MarketRelease,
} from '@/services/pluginMarketClient';
import {
  installPluginFromMarket,
  DEFAULT_ALLOWED_DOWNLOAD_HOSTS,
} from '@/services/pluginMarketInstaller';

export default defineComponent({
  name: 'PluginMarket',
  components: { ArrowRight, Close },
  data() {
    return {
      Search,
      marketApiBaseUrl: '',
      keyword: '',
      loading: false,
      errorMessage: '',
      plugins: [] as MarketPluginSummary[],
      selectedPlugin: null as MarketPluginSummary | null,
      drawerVisible: false,
      installedVersions: {} as Record<string, string>,
      releases: [] as MarketRelease[],
      selectedVersion: '',
      installProgress: { active: false, progress: 0, phase: '' } as { active: boolean; progress: number; phase: string },
      installError: '',
      installAbort: null as AbortController | null,
    };
  },
  computed: {
    targetRelease(): MarketRelease | null {
      if (this.selectedVersion && this.releases.length) {
        const found = this.releases.find((r) => r.version === this.selectedVersion);
        if (found) return found;
      }
      const p = this.selectedPlugin;
      if (!p?.downloadUrl) return null;
      return {
        pluginCode: p.pluginCode,
        version: p.latestVersion,
        status: 'published',
        downloadUrl: p.downloadUrl,
        sha256: p.sha256 ?? '',
        size: p.size ?? 0,
        manifest: p.manifest ?? {},
        minPlatformVersion: p.minPlatformVersion,
        permissions: p.permissions ?? [],
        changelog: p.changelog,
        publishedAt: p.latestPublishedAt,
      };
    },
    canInstallSelected(): boolean {
      const release = this.targetRelease;
      if (!release || !this.selectedPlugin) return false;
      const currentVersion = this.installedVersions[this.selectedPlugin.pluginCode];
      if (!currentVersion) return true;
      return this.compareVersions(release.version, currentVersion) > 0;
    },
    installActionLabel(): string {
      if (!this.selectedPlugin) return '安装';
      const currentVersion = this.installedVersions[this.selectedPlugin.pluginCode];
      const release = this.targetRelease;
      if (!release) return '安装';
      if (!currentVersion) return '安装';
      return currentVersion === release.version ? '已安装' : '更新';
    },
  },
  async activated() {
    await this.loadMarketConfig();
    await this.loadInstalledVersions();
    if (this.marketApiBaseUrl) {
      await this.loadPlugins();
    }
  },
  methods: {
    async loadMarketConfig() {
      const res = await getSettings();
      if (res.code !== 1) {
        this.errorMessage = res.msg || '读取系统设置失败';
        return;
      }
      const setting = res.data.find((item: any) => item.param_code === 'treasure::plugin_market_api_base_url');
      this.marketApiBaseUrl = String(setting?.param_value || '').trim();
    },
    async loadInstalledVersions() {
      const res = await getPlugins();
      if (res.code !== 1) return;
      const versions: Record<string, string> = {};
      res.data.forEach((plugin: any) => {
        versions[plugin.pluginCode] = plugin.pluginVersion;
      });
      this.installedVersions = versions;
    },
    async loadPlugins() {
      this.loading = true;
      this.errorMessage = '';
      try {
        const result = await fetchMarketPlugins(this.marketApiBaseUrl, { keyword: this.keyword });
        this.plugins = result.items;
      } catch (error: any) {
        this.errorMessage = error.message || '加载插件市场失败';
      } finally {
        this.loading = false;
      }
    },
    async openDetail(plugin: MarketPluginSummary) {
      this.selectedPlugin = plugin;              // 先用列表数据兜底，立即开抽屉
      this.installError = '';
      this.installProgress = { active: false, progress: 0, phase: '' };
      this.drawerVisible = true;
      try {
        const detail = await fetchMarketPlugin(this.marketApiBaseUrl, plugin.pluginCode);
        this.selectedPlugin = { ...plugin, ...detail };
      } catch (error: any) {
        ElMessage.warning('详情加载失败，已展示列表信息');
      }
      try {
        this.releases = await fetchMarketReleases(this.marketApiBaseUrl, plugin.pluginCode);
        this.selectedVersion = this.releases[0]?.version ?? this.selectedPlugin.latestVersion ?? '';
      } catch {
        // 版本列表失败不阻塞：默认仅用详情携带的最新版安装数据
        this.releases = [];
        this.selectedVersion = this.selectedPlugin.latestVersion ?? '';
      }
    },
    initialOf(plugin: MarketPluginSummary): string {
      const source = (plugin.alias || plugin.pluginCode || '?').trim();
      return source.charAt(0).toUpperCase();
    },
    installLabel(plugin: MarketPluginSummary) {
      const version = this.installedVersions[plugin.pluginCode];
      if (!version) return '未安装';
      return version === plugin.latestVersion ? '已安装' : '可更新';
    },
    statusClass(plugin: MarketPluginSummary) {
      const label = this.installLabel(plugin);
      if (label === '已安装') return 'is-installed';
      if (label === '可更新') return 'is-update';
      return 'is-new';
    },
    riskClass(permission: MarketPluginPermission) {
      if (permission.risk === 'high') return 'risk-high';
      if (permission.risk === 'medium') return 'risk-medium';
      return 'risk-low';
    },
    compareVersions(a: string, b: string): number {
      const pa = String(a || '0').split('.').map(Number);
      const pb = String(b || '0').split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x > y) return 1;
        if (x < y) return -1;
      }
      return 0;
    },
    isVersionOptionDisabled(version: string): boolean {
      const current = this.installedVersions[this.selectedPlugin?.pluginCode ?? ''];
      if (!current) return false;
      return this.compareVersions(version, current) <= 0;
    },
    formatDate(value?: string) {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleDateString();
    },
    async confirmInstall() {
      const release = this.targetRelease;
      if (!release || !this.selectedPlugin) {
        ElMessage.error('未获取到可安装的版本信息');
        return;
      }
      const plugin = this.selectedPlugin;
      // confirm dialog lists source/version/permissions
      try {
        await ElMessageBox.confirm(
          `确认安装 ${plugin.alias} v${release.version}？\n来源：${plugin.author}\n最低平台：${release.minPlatformVersion}`,
          '安装确认',
          { confirmButtonText: '开始安装', cancelButtonText: '取消', type: 'info' },
        );
      } catch {
        return; // user cancelled
      }
      this.installError = '';
      const abort = new AbortController();
      this.installAbort = abort;
      this.installProgress = { active: true, progress: 0, phase: 'downloading' };
      try {
        await installPluginFromMarket(release, {
          signal: abort.signal,
          allowedHosts: DEFAULT_ALLOWED_DOWNLOAD_HOSTS,
          onProgress: (p) => {
            const phases: Record<string, number> = { downloading: 10, hashing: 30, extracting: 55, validating: 70, importing: 85, succeeded: 100 };
            this.installProgress = { active: ['downloading', 'hashing', 'extracting', 'validating', 'importing'].includes(p.phase), progress: phases[p.phase] ?? p.progress, phase: p.phase };
          },
        });
        if (abort.signal.aborted) {
          // 安装过程中已取消：不报成功
          this.installProgress = { active: false, progress: 0, phase: '' };
          ElMessage.info('已取消安装');
          return;
        }
        this.installProgress = { active: false, progress: 100, phase: 'success' };
        await this.loadInstalledVersions();
        ElMessage.success(`插件 ${plugin.alias} 安装成功`);
      } catch (e: any) {
        const cancelled = abort.signal.aborted || /cancelled/i.test(String(e?.message || ''));
        this.installProgress = { active: false, progress: 0, phase: cancelled ? '' : 'failed' };
        this.installError = cancelled ? '' : (e?.message || '安装失败');
        if (cancelled) ElMessage.info('已取消安装');
        else ElMessage.error(this.installError);
      } finally {
        this.installAbort = null;
      }
    },
    cancelInstall() {
      this.installAbort?.abort();
    },
  },
});
</script>

<style scoped>
.plugin-market-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 20px 0;
  box-sizing: border-box;
  background-color: var(--treasure-background-color);
}

/* ── 顶部标题与工具栏 ────────────────────────────────── */
.market-header {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 16px;
}
.market-title {
  position: relative;
  padding-bottom: 8px;
}
.market-title h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #4f463b;
}
.market-title p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #8b7e9a;
}
.market-title::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  width: 34px;
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(90deg, #ffb978, #b69cff);
}
.market-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.market-search-input {
  width: 240px;
}

.market-alert {
  flex-shrink: 0;
  margin-bottom: 14px;
}

/* ── 插件网格 ─────────────────────────────────────── */
.market-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 20px;
}
.market-body::-webkit-scrollbar { width: 6px; }
.market-body::-webkit-scrollbar-track { background: transparent; }
.market-body::-webkit-scrollbar-thumb { background: #d3cbbd; border-radius: 3px; }

.market-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

/* ── 插件卡片 ─────────────────────────────────────── */
.plugin-card {
  display: flex;
  flex-direction: column;
  min-height: 178px;
  padding: 16px;
  border-radius: 12px;
  cursor: pointer;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.62) 0%, rgba(243, 236, 223, 0.72) 100%);
  border: 1px solid var(--treasure-border-color);
  box-shadow: 0 2px 8px rgba(122, 96, 77, 0.08);
  transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
}
.plugin-card:hover {
  transform: translateY(-3px);
  border-color: rgba(154, 132, 189, 0.42);
  box-shadow: 0 8px 22px rgba(122, 96, 77, 0.16);
}

.plugin-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.plugin-avatar {
  flex-shrink: 0;
  background: linear-gradient(135deg, #b69cff 0%, #8b6cc1 100%);
  color: #fff;
  font-weight: 600;
}
.avatar-fallback {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.plugin-status {
  flex-shrink: 0;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
}
.plugin-status.is-installed {
  color: #3f8f5f;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.28);
}
.plugin-status.is-update {
  color: #b8862f;
  background: rgba(214, 167, 88, 0.14);
  border: 1px solid rgba(214, 167, 88, 0.32);
}
.plugin-status.is-new {
  color: #7a5cb2;
  background: rgba(154, 132, 189, 0.14);
  border: 1px solid rgba(154, 132, 189, 0.32);
}

.plugin-name {
  margin: 12px 0 2px;
  font-size: 15px;
  font-weight: 600;
  color: #4b4257;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.plugin-code {
  margin: 0;
  font-size: 12px;
  color: #9a8fa7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.plugin-desc {
  flex: 1;
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: #756982;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.plugin-card-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(126, 108, 87, 0.08);
}
.plugin-card-footer .meta {
  font-size: 12px;
  color: #9a8fa7;
}
.plugin-card-footer .meta-author {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plugin-card-footer .meta-dot {
  color: #c9b8d9;
}
.plugin-arrow {
  margin-left: auto;
  color: #b190d5;
  transition: transform 0.22s ease, color 0.22s ease;
}
.plugin-card:hover .plugin-arrow {
  color: #8b6cc1;
  transform: translateX(3px);
}

/* ── 安装错误 / 进度 ──────────────────────────────── */
.install-progress {
  margin: 12px 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.install-progress-bar {
  flex: 1;
  min-width: 0;
}

/* ── 按钮 ―― 墨紫渐变（Treasure 主操作） ────────────── */
:deep(.el-button--primary) {
  background: linear-gradient(135deg, #b095e2 0%, #8b6cc1 100%);
  border-color: transparent;
  color: #fff;
  font-weight: 500;
  border-radius: 8px;
  transition: all 0.25s ease;
}
:deep(.el-button--primary:hover) {
  background: linear-gradient(135deg, #c0a8ec 0%, #9b7cd0 100%);
  border-color: transparent;
  transform: translateY(-1px);
}
:deep(.el-button--primary:active) {
  background: linear-gradient(135deg, #a085d6 0%, #7a5cb2 100%);
  transform: translateY(0);
}
:deep(.el-button--primary.is-disabled),
:deep(.el-button--primary.is-disabled:hover) {
  background: rgba(154, 132, 189, 0.35);
  border-color: transparent;
  transform: none;
}
:deep(.el-button:not(.el-button--primary):not(.el-button--danger):not(.el-button--warning)) {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(126, 108, 87, 0.15);
  color: #655b4f;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.22s ease;
}
:deep(.el-button:not(.el-button--primary):not(.el-button--danger):not(.el-button--warning):hover) {
  background: rgba(255, 255, 255, 0.9);
  border-color: #8b6cc1;
  color: #8b6cc1;
}

/* ── 输入框 / 下拉框配色适配 ───────────────────────── */
:deep(.el-input__wrapper),
:deep(.el-select .el-select__wrapper) {
  background-color: rgba(255, 255, 255, 0.6);
  box-shadow: 0 0 0 1px var(--treasure-border-color) inset;
  border-radius: 8px;
}
:deep(.el-input__wrapper:hover),
:deep(.el-select .el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--treasure-side-accent) inset;
}
:deep(.el-input__wrapper.is-focus),
:deep(.el-select.is-focus .el-select__wrapper) {
  box-shadow: 0 0 0 1px var(--treasure-side-accent) inset;
}
:deep(.el-input__inner) {
  color: #4b4257;
}
:global(.el-select-dropdown),
:global(.el-popper) {
  background-color: var(--treasure-background-color) !important;
  border-color: var(--treasure-border-color) !important;
}
:global(.el-select-dropdown__item.is-selected) {
  color: var(--treasure-side-accent) !important;
}
</style>

<style>
/* el-drawer 通过 teleport 渲染，需使用全局样式 + 前缀限定 */
.market-drawer.el-drawer {
  background: linear-gradient(160deg, #fbf6ec 0%, #f3ecdf 100%);
  box-shadow: -8px 0 28px rgba(122, 96, 77, 0.16);
}
.market-drawer .el-drawer__body {
  padding: 0;
  overflow: hidden;
}

.market-drawer .drawer-body {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 22px 24px 28px;
  box-sizing: border-box;
}
.market-drawer .drawer-body::-webkit-scrollbar { width: 6px; }
.market-drawer .drawer-body::-webkit-scrollbar-track { background: transparent; }
.market-drawer .drawer-body::-webkit-scrollbar-thumb { background: #d3cbbd; border-radius: 3px; }

.market-drawer .drawer-hero {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding-bottom: 18px;
  border-bottom: 1px solid rgba(126, 108, 87, 0.1);
}
.market-drawer .drawer-avatar {
  flex-shrink: 0;
  background: linear-gradient(135deg, #b69cff 0%, #8b6cc1 100%);
}
.market-drawer .avatar-fallback {
  font-size: 22px;
  font-weight: 600;
  color: #fff;
}
.market-drawer .drawer-hero-info {
  flex: 1;
  min-width: 0;
}
.market-drawer .drawer-hero-info h2 {
  margin: 0 0 2px;
  font-size: 18px;
  font-weight: 600;
  color: #4b4257;
}
.market-drawer .plugin-code {
  margin: 0 0 8px;
  font-size: 12px;
  color: #9a8fa7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.market-drawer .drawer-close {
  flex-shrink: 0;
  color: #9a8fa7;
}
.market-drawer .drawer-close:hover {
  color: #8b6cc1;
}

.market-drawer .plugin-status {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
}
.market-drawer .plugin-status.is-installed {
  color: #3f8f5f;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.28);
}
.market-drawer .plugin-status.is-update {
  color: #b8862f;
  background: rgba(214, 167, 88, 0.14);
  border: 1px solid rgba(214, 167, 88, 0.32);
}
.market-drawer .plugin-status.is-new {
  color: #7a5cb2;
  background: rgba(154, 132, 189, 0.14);
  border: 1px solid rgba(154, 132, 189, 0.32);
}

.market-drawer .drawer-actions {
  margin: 18px 0 4px;
}
.market-drawer .install-button.el-button {
  width: 100%;
  height: 38px;
  background: linear-gradient(135deg, #b095e2 0%, #8b6cc1 100%);
  border-color: transparent;
  color: #fff;
  font-weight: 500;
  border-radius: 9px;
  transition: all 0.25s ease;
}
.market-drawer .install-button.el-button:hover {
  background: linear-gradient(135deg, #c0a8ec 0%, #9b7cd0 100%);
  transform: translateY(-1px);
}
.market-drawer .install-button.el-button.is-disabled,
.market-drawer .install-button.el-button.is-disabled:hover {
  background: rgba(154, 132, 189, 0.35);
  border-color: transparent;
  transform: none;
}

.market-drawer .market-alert {
  margin: 12px 0;
}

.market-drawer .drawer-desc {
  margin: 18px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: #5c5347;
}

.market-drawer .drawer-section {
  margin-top: 22px;
}
.market-drawer .drawer-section h4 {
  position: relative;
  margin: 0 0 12px;
  padding-left: 10px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #6d5b7f;
}
.market-drawer .drawer-section h4::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 13px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffb978, #b69cff);
}

.market-drawer .info-grid {
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(126, 108, 87, 0.1);
  background: rgba(255, 255, 255, 0.45);
}
.market-drawer .info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  font-size: 13px;
}
.market-drawer .info-row + .info-row {
  border-top: 1px solid rgba(126, 108, 87, 0.08);
}
.market-drawer .info-label {
  color: #9a8fa7;
}
.market-drawer .info-value {
  color: #4b4257;
  text-align: right;
  word-break: break-all;
}
.market-drawer .version-select {
  width: 130px;
  text-align: left;
}

.market-drawer .permission-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.market-drawer .permission-tag {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  border: 1px solid transparent;
}
.market-drawer .permission-tag.risk-low {
  color: #7a5cb2;
  background: rgba(154, 132, 189, 0.14);
  border-color: rgba(154, 132, 189, 0.28);
}
.market-drawer .permission-tag.risk-medium {
  color: #b8862f;
  background: rgba(214, 167, 88, 0.14);
  border-color: rgba(214, 167, 88, 0.30);
}
.market-drawer .permission-tag.risk-high {
  color: #c95e5e;
  background: rgba(201, 94, 94, 0.12);
  border-color: rgba(201, 94, 94, 0.28);
}
.market-drawer .empty-hint {
  margin: 0;
  font-size: 12px;
  color: #9a8fa7;
}
</style>
