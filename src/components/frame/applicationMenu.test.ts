import { describe, expect, it } from 'vitest';
import { buildApplicationMenu, findMenuCommandByAccelerator } from './applicationMenu';

describe('Windows application menu model', () => {
  it('places plugin items in the same File and View roots used by macOS', () => {
    const groups = buildApplicationMenu('shi-yu-lu-2lglfy', [
      {
        menuId: 'export',
        rootLabel: 'File',
        submenuLabel: 'Export',
        items: [{ id: 'pdf', label: 'Export as PDF', type: 'normal', accelerator: 'Ctrl+Shift+E' }],
      },
      {
        menuId: 'mode',
        rootLabel: '显示',
        items: [{ id: 'edit-only', label: 'Edit only', type: 'check', checked: true }],
      },
    ]);

    const file = groups.find(group => group.label === 'File');
    const view = groups.find(group => group.label === 'View');
    expect(file?.items[file.items.length - 1]).toMatchObject({ label: 'Export', type: 'submenu' });
    expect(view?.items[view.items.length - 1]).toMatchObject({ label: 'Edit only', type: 'check', checked: true });
  });

  it('finds only exact Windows shortcut modifier combinations', () => {
    const groups = buildApplicationMenu(null, []);
    const shortcut = { key: 'w', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false } as KeyboardEvent;
    const extraModifier = { key: 'w', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, isComposing: false } as KeyboardEvent;

    expect(findMenuCommandByAccelerator(groups, shortcut)?.command).toEqual({
      target: 'host', command: 'closeCurrentTab',
    });
    expect(findMenuCommandByAccelerator(groups, extraModifier)).toBeUndefined();
  });
});
