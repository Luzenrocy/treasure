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
    collapsed: {
      type: Boolean,
      default: false,
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
    <div class="windows-app-brand" :class="{ 'is-collapsed': collapsed }" data-tauri-drag-region aria-label="Treasure">
      <DiamondIcon aria-hidden="true" />
      <span class="windows-app-brand-text">Treasure</span>
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
  color: var(--treasure-tab-text);
  user-select: none;
  position: relative;
  z-index: 1100;
}

.windows-app-brand {
  width: var(--treasure-sidebar-width, 128px);
  flex: 0 0 var(--treasure-sidebar-width, 128px);
  transition: width 0.3s ease-in-out, flex-basis 0.3s ease-in-out;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  overflow: hidden;
  background: var(--treasure-side-backgroud-color);
  border-right: 1px solid var(--el-border-color-light);
  color: var(--treasure-side-text);

  svg {
    width: 16px;
    height: 16px;
    color: var(--treasure-side-text);
    flex: 0 0 auto;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
    transform: translateY(-2px);
  }

  &.is-collapsed {
    .windows-app-brand-text {
      display: none;
    }
  }
}

.windows-app-brand-text {
  font-family: 'Pinyon Script', cursive;
  font-size: 28px;
  font-weight: 400;
  line-height: 1;
  letter-spacing: 0.2px;
  background: linear-gradient(100deg, #fff0bd 0%, #e8bd61 38%, #c99546 66%, #c5a8dc 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  white-space: nowrap;
  transform: translateY(-2px);
  text-shadow: 0 1px 9px rgba(232, 201, 138, 0.12);
}

.windows-menu-bar {
  min-width: 0;
  display: flex;
  align-items: stretch;
}

.windows-menu-root {
  height: 39px;
  --el-menu-horizontal-height: 39px;
  border-bottom: 0;
  background: transparent;

  :deep(> .el-sub-menu) {
    flex: 0 0 auto;
    height: 39px;
    min-width: 0;
    margin: 0 !important;
  }

  :deep(> .el-sub-menu > .el-sub-menu__title) {
    height: 39px;
    line-height: 39px;
    min-width: 0 !important;
    padding: 0 7px !important;
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

  :deep(> .el-sub-menu.is-active > .el-sub-menu__title),
  :deep(> .el-sub-menu.is-opened > .el-sub-menu__title) {
    background: color-mix(in srgb, var(--treasure-side-active-bg) 56%, transparent) !important;
    color: var(--el-color-primary);
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
  min-width: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;

  .el-menu {
    width: max-content;
    min-width: 164px;
    padding: 4px;
    border-right: 0;
    border: 1px solid var(--treasure-border-color);
    border-radius: 6px;
    background: var(--treasure-bg-tabs);
    box-shadow: 0 8px 24px rgba(70, 51, 40, 0.16);
  }

  .el-menu-item,
  .el-sub-menu__title {
    height: 32px;
    line-height: 32px;
    padding: 0 10px;
    color: var(--treasure-tab-text);
    font-size: 12px;
    border-radius: 4px;
    background: transparent !important;
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
