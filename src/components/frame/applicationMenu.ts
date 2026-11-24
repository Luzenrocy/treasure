import { MENU_LABEL_ALIASES } from '@/bridge/pluginBridge';
import type { MenuRegistration } from '@/store/menuRegistry';

export type HostMenuCommand =
  | 'closeCurrentTab'
  | 'closeAllTabs'
  | 'closeWindow'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'minimize'
  | 'toggleMaximize'
  | 'toggleFullscreen'
  | 'about';

export type ApplicationMenuCommand =
  | { target: 'host'; command: HostMenuCommand }
  | { target: 'plugin'; pluginCode: string; menuId: string; itemId: string; checkable: boolean };

export type ApplicationMenuAction = ApplicationMenuCommand & { checked?: boolean };

export interface ApplicationMenuItem {
  id: string;
  label: string;
  type: 'command' | 'check' | 'separator' | 'submenu';
  accelerator?: string;
  checked?: boolean;
  disabled?: boolean;
  command?: ApplicationMenuCommand;
  children?: ApplicationMenuItem[];
}

export interface ApplicationMenuGroup {
  id: string;
  label: string;
  items: ApplicationMenuItem[];
}

const rootGroups = (): ApplicationMenuGroup[] => [
  {
    id: 'file', label: 'File', items: [
      hostItem('close-current-tab', 'Close Current Tab', 'closeCurrentTab', 'Ctrl+W'),
      hostItem('close-all-tabs', 'Close All Tabs', 'closeAllTabs', 'Ctrl+Shift+W'),
      separator('file-separator'),
      hostItem('close-window', 'Close Window', 'closeWindow'),
    ],
  },
  {
    id: 'edit', label: 'Edit', items: [
      hostItem('undo', 'Undo', 'undo', 'Ctrl+Z'),
      hostItem('redo', 'Redo', 'redo', 'Ctrl+Y'),
      separator('edit-history-separator'),
      hostItem('cut', 'Cut', 'cut', 'Ctrl+X'),
      hostItem('copy', 'Copy', 'copy', 'Ctrl+C'),
      hostItem('paste', 'Paste', 'paste', 'Ctrl+V'),
      hostItem('select-all', 'Select All', 'selectAll', 'Ctrl+A'),
    ],
  },
  {
    id: 'view', label: 'View', items: [
      hostItem('toggle-fullscreen', 'Toggle Full Screen', 'toggleFullscreen', 'F11'),
    ],
  },
  {
    id: 'window', label: 'Window', items: [
      hostItem('minimize', 'Minimize', 'minimize'),
      hostItem('toggle-maximize', 'Maximize / Restore', 'toggleMaximize'),
    ],
  },
  {
    id: 'help', label: 'Help', items: [
      hostItem('about', 'About Treasure', 'about'),
    ],
  },
];

function hostItem(id: string, label: string, command: HostMenuCommand, accelerator?: string): ApplicationMenuItem {
  return {
    id,
    label,
    type: 'command',
    accelerator,
    command: { target: 'host', command },
  };
}

function separator(id: string): ApplicationMenuItem {
  return { id, label: '', type: 'separator' };
}

function canonicalRootLabel(label: string): string {
  const root = rootGroups().find(group =>
    group.label === label || (MENU_LABEL_ALIASES[group.label] || []).includes(label),
  );
  return root?.label || label;
}

function getOrCreateGroup(groups: ApplicationMenuGroup[], rootLabel: string): ApplicationMenuGroup {
  const canonicalLabel = canonicalRootLabel(rootLabel);
  const existing = groups.find(group => group.label === canonicalLabel);
  if (existing) return existing;

  const group: ApplicationMenuGroup = {
    id: `plugin-root-${groups.length}-${canonicalLabel}`,
    label: canonicalLabel,
    items: [],
  };
  groups.push(group);
  return group;
}

/**
 * Produces the Windows-rendered menu from the same registrations that feed the
 * native macOS menu. Keeping this transformation pure makes the two adapters
 * share one plugin contract without sharing rendering details.
 */
export function buildApplicationMenu(
  pluginCode: string | null,
  registrations: MenuRegistration[],
): ApplicationMenuGroup[] {
  const groups = rootGroups();
  if (!pluginCode) return groups;

  for (const registration of registrations) {
    const target = getOrCreateGroup(groups, registration.rootLabel);
    const items = registration.items.map<ApplicationMenuItem>((item, itemIndex) => {
      if (item.type === 'separator') {
        return separator(`${registration.menuId}-${item.id || itemIndex}`);
      }
      const checkable = item.type === 'check';
      return {
        id: `${registration.menuId}-${item.id}`,
        label: item.label,
        type: checkable ? 'check' : 'command',
        accelerator: item.accelerator,
        checked: item.checked,
        disabled: item.enabled === false,
        command: {
          target: 'plugin',
          pluginCode,
          menuId: registration.menuId,
          itemId: item.id,
          checkable,
        },
      };
    });

    if (registration.submenuLabel) {
      target.items.push({
        id: `${registration.menuId}-submenu`,
        label: registration.submenuLabel,
        type: 'submenu',
        children: items,
      });
    } else {
      target.items.push(...items);
    }
  }
  return groups;
}

export function matchesAccelerator(event: KeyboardEvent, accelerator?: string): boolean {
  if (!accelerator || event.isComposing) return false;
  const parts = accelerator.toLowerCase().split('+').map(item => item.trim());
  const key = parts.pop();
  if (!key) return false;

  const expectsCtrl = parts.includes('ctrl') || parts.includes('cmdorctrl');
  const expectsMeta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command');
  const expectsAlt = parts.includes('alt') || parts.includes('option');
  const expectsShift = parts.includes('shift');
  const actualKey = event.key.toLowerCase();
  const expectedKey = key === 'return' ? 'enter' : key;

  return actualKey === expectedKey
    && event.ctrlKey === expectsCtrl
    && event.metaKey === expectsMeta
    && event.altKey === expectsAlt
    && event.shiftKey === expectsShift;
}

export function findMenuCommandByAccelerator(
  groups: ApplicationMenuGroup[],
  event: KeyboardEvent,
): ApplicationMenuItem | undefined {
  const find = (items: ApplicationMenuItem[]): ApplicationMenuItem | undefined => {
    for (const item of items) {
      if (item.type === 'submenu' && item.children) {
        const match = find(item.children);
        if (match) return match;
      }
      if (!item.disabled && item.command && matchesAccelerator(event, item.accelerator)) return item;
    }
    return undefined;
  };
  return groups.reduce<ApplicationMenuItem | undefined>((match, group) => match || find(group.items), undefined);
}
