<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { Check, Close, FullScreen, Minus } from '@element-plus/icons-vue';
import DiamondIcon from '@/assets/diamond.svg?component';
import {
  findMenuCommandByAccelerator,
  type ApplicationMenuAction,
  type ApplicationMenuGroup,
  type ApplicationMenuItem,
} from './applicationMenu';

export default defineComponent({
  name: 'WindowsTitleBar',
  components: { Check, Close, DiamondIcon, FullScreen, Minus },
  props: {
    menuGroups: {
      type: Array as PropType<ApplicationMenuGroup[]>,
      required: true,
    },
  },
  emits: ['menu-action', 'minimize', 'toggle-maximize', 'close'],
  mounted() {
    window.addEventListener('keydown', this.onKeydown);
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onKeydown);
  },
  methods: {
    runItem(item: ApplicationMenuItem) {
      if (!item.command || item.disabled) return;
      const action: ApplicationMenuAction = item.type === 'check'
        ? { ...item.command, checked: !item.checked }
        : item.command;
      this.$emit('menu-action', action);
    },
    onKeydown(event: KeyboardEvent) {
      const item = findMenuCommandByAccelerator(this.menuGroups, event);
      if (!item) return;
      event.preventDefault();
      this.runItem(item);
    },
  },
});
</script>

<template>
  <header class="windows-titlebar">
    <div class="windows-app-mark" data-tauri-drag-region aria-label="Treasure">
      <DiamondIcon aria-hidden="true" />
    </div>

    <nav class="windows-menu-bar" aria-label="应用菜单">
      <el-menu mode="horizontal" :ellipsis="false" class="windows-menu-root">
        <el-sub-menu
          v-for="group in menuGroups"
          :key="group.id"
          :index="group.id"
          :popper-class="'windows-titlebar-menu-popper'"
        >
          <template #title>{{ group.label }}</template>
          <template v-for="item in group.items" :key="item.id">
            <div v-if="item.type === 'separator'" class="windows-menu-separator" role="separator" />
            <el-sub-menu
              v-else-if="item.type === 'submenu'"
              :index="item.id"
              :popper-class="'windows-titlebar-menu-popper'"
            >
              <template #title>{{ item.label }}</template>
              <template v-for="child in item.children" :key="child.id">
                <div v-if="child.type === 'separator'" class="windows-menu-separator" role="separator" />
                <el-menu-item
                  v-else
                  :index="child.id"
                  :disabled="child.disabled"
                  @click="runItem(child)"
                >
                  <el-icon v-if="child.type === 'check'" class="windows-check" :class="{ visible: child.checked }"><Check /></el-icon>
                  <span class="windows-menu-item-label">{{ child.label }}</span>
                  <kbd v-if="child.accelerator">{{ child.accelerator }}</kbd>
                </el-menu-item>
              </template>
            </el-sub-menu>
            <el-menu-item
              v-else
              :index="item.id"
              :disabled="item.disabled"
              @click="runItem(item)"
            >
              <el-icon v-if="item.type === 'check'" class="windows-check" :class="{ visible: item.checked }"><Check /></el-icon>
              <span class="windows-menu-item-label">{{ item.label }}</span>
              <kbd v-if="item.accelerator">{{ item.accelerator }}</kbd>
            </el-menu-item>
          </template>
        </el-sub-menu>
      </el-menu>
    </nav>

    <div class="windows-titlebar-drag" data-tauri-drag-region />

    <div class="windows-window-controls" aria-label="窗口控制">
      <button type="button" aria-label="最小化" @click="$emit('minimize')"><el-icon><Minus /></el-icon></button>
      <button type="button" aria-label="最大化或还原" @click="$emit('toggle-maximize')"><el-icon><FullScreen /></el-icon></button>
      <button type="button" class="close" aria-label="关闭" @click="$emit('close')"><el-icon><Close /></el-icon></button>
    </div>
  </header>
</template>

<style scoped lang="scss">
.windows-titlebar {
  height: 40px;
  min-height: 40px;
  display: flex;
  align-items: stretch;
  background: var(--treasure-bg-tabs);
  border-bottom: 1px solid var(--treasure-border-color);
  color: var(--treasure-tab-text);
  user-select: none;
  position: relative;
  z-index: 1100;
}

.windows-app-mark {
  width: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 40px;

  svg {
    width: 16px;
    height: 16px;
    color: var(--treasure-side-text);
  }
}

.windows-menu-bar {
  min-width: 0;
  display: flex;
  align-items: stretch;
}

.windows-menu-root {
  height: 39px;
  border-bottom: 0;
  background: transparent;

  :deep(.el-sub-menu__title) {
    height: 39px;
    line-height: 39px;
    padding: 0 11px;
    color: var(--treasure-tab-text);
    font-size: 12px;
    border-bottom: 0 !important;

    .el-sub-menu__icon-arrow {
      display: none;
    }

    &:hover,
    &:focus-visible {
      background: color-mix(in srgb, var(--treasure-side-active-bg) 56%, transparent);
    }
  }
}

.windows-titlebar-drag {
  flex: 1 1 auto;
  min-width: 12px;
}

.windows-window-controls {
  display: flex;
  flex: 0 0 auto;

  button {
    width: 46px;
    height: 39px;
    border: 0;
    background: transparent;
    color: inherit;
    display: grid;
    place-items: center;
    cursor: default;

    &:hover {
      background: rgba(0, 0, 0, 0.08);
    }

    &:focus-visible {
      outline: 2px solid var(--el-color-primary);
      outline-offset: -2px;
    }

    &.close:hover {
      background: #c42b1c;
      color: #fff;
    }
  }
}
</style>

<style lang="scss">
.windows-titlebar-menu-popper {
  min-width: 210px !important;
  padding: 4px !important;
  border: 1px solid var(--treasure-border-color) !important;
  border-radius: 6px !important;
  background: var(--treasure-background-color) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18) !important;

  .el-menu {
    border-right: 0;
    background: transparent;
  }

  .el-menu-item,
  .el-sub-menu__title {
    height: 32px;
    line-height: 32px;
    padding: 0 10px;
    color: var(--treasure-tab-text);
    font-size: 12px;
    border-radius: 4px;
  }

  .el-menu-item:hover,
  .el-sub-menu__title:hover {
    background: color-mix(in srgb, var(--treasure-side-active-bg) 54%, transparent);
  }

  .el-menu-item.is-disabled {
    opacity: 0.45;
  }

  .el-sub-menu__icon-arrow {
    margin-top: -2px;
  }

  .windows-menu-separator {
    height: 1px;
    margin: 4px 8px;
    background: var(--treasure-border-color);
  }

  .windows-check {
    width: 16px;
    margin-right: 4px;
    opacity: 0;

    &.visible {
      opacity: 1;
    }
  }

  .windows-menu-item-label {
    flex: 1;
  }

  kbd {
    margin-left: 24px;
    color: var(--el-text-color-secondary);
    font: inherit;
    font-size: 11px;
  }
}
</style>
