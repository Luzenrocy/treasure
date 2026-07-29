<template>
  <div class="plugin-container">
    <div v-if="loading" class="loading-container">
      <el-icon class="is-loading">
        <Loading />
      </el-icon>
      <span>正在加载插件...</span>
    </div>
    <div v-else-if="error" class="error-container">
      <el-alert
        title="加载失败"
        :description="error"
        type="error"
        show-icon
        closable
      />
    </div>
    <iframe 
      v-else
      :src="iframeSrc" 
      :data-treasure-plugin="pluginCode"
      frameborder="0" 
      class="plugin-iframe"
      @load="onIframeLoad"
      @error="onIframeError"
    ></iframe>
  </div>
</template>

<script lang="ts">
import {defineComponent} from "vue";
import {ElMessage, ElAlert} from 'element-plus';
import {Loading} from '@element-plus/icons-vue';
import { exists, BaseDirectory } from '@tauri-apps/plugin-fs';

export default defineComponent({
  name: 'Plugin',
  components: {
    ElAlert,
    Loading
  },
  props: {
    pluginCode: {
      type: String,
      required: true
    },
    debugUrl: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      htmlPath: '',
      iframeSrc: '',
      loading: false,
      error: '',
      loaded: false // 标记是否已加载过，避免重复加载
    }
  },
  created() {
    this.loadPlugin();
  },
  
  methods: {
    async loadPlugin() {
      if (this.loaded && this.iframeSrc) {
        return;
      }

      // 调试模式：直接使用 debugUrl
      if (this.debugUrl) {
        this.iframeSrc = this.debugUrl;
        this.loaded = true;
        this.loading = false;
        return;
      }

      const pluginCode = this.pluginCode;
      if (!pluginCode) {
        ElMessage.error('插件代码不能为空');
        return;
      }

      this.loading = true;

      try {
        const relativePath = this.parsePath(pluginCode);

        const fileExists = await this.checkFileExists(relativePath);
        if (!fileExists) {
          ElMessage.error(`插件文件不存在: ${relativePath}`);
          return;
        }

        this.iframeSrc = `plugin://localhost/${relativePath}`;
        this.loaded = true;

        console.log('插件加载路径:', {
          pluginCode,
          relativePath,
          pluginUrl: this.iframeSrc
        });
      } catch (err :any) {
        console.error('插件加载错误详情:', {
          error: err,
          pluginCode: pluginCode
        });
        ElMessage.error(err.message || '加载插件时发生错误');
      } finally {
        this.loading = false;
      }
    },
    
    parsePath(pluginCode: string) {
      // 返回相对于 AppData 目录的路径，插件统一收拢到 plugin/ 子目录
      return `plugin/${pluginCode}/index.html`;
    },
    
    async checkFileExists(filePath: string) {
      try {
        // 使用 Tauri 的 exists API 检查文件是否存在
        return await exists(filePath, { baseDir: BaseDirectory.AppData });
      } catch (error) {
        console.error('文件检查失败:', error);
        return false;
      }
    },
    
    onIframeLoad() {
      console.log('Plugin loaded successfully');
      // 只在首次加载时显示成功消息
      if (!this.loaded) {
        ElMessage.success('插件内容加载完成');
      }
    },
    
    onIframeError() {
      this.error = '无法加载插件内容，请检查文件路径是否正确';
      ElMessage.error(this.error);
    }
  }
})
</script>

<style scoped>
.plugin-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
}

.loading-container .el-icon {
  font-size: 24px;
  margin-bottom: 10px;
}

.error-container {
  padding: 20px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.plugin-iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
</style>