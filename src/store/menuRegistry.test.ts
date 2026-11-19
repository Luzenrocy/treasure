import { describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useMenuRegistry } from './menuRegistry';

describe('menu registry capability lifecycle', () => {
  it('tracks subscriptions and removes them with plugin cleanup', () => {
    setActivePinia(createPinia());
    const registry = useMenuRegistry();
    registry.register('demo', { menuId: 'm', rootLabel: 'File', items: [] });
    registry.subscribe('demo', 'm', 'token');
    expect(registry.isSubscribed('demo', 'm')).toBe(true);
    registry.unsubscribe('demo', 'token');
    expect(registry.isSubscribed('demo', 'm')).toBe(false);
    registry.subscribe('demo', 'm', 'token2');
    registry.unregisterAll('demo');
    expect(registry.isSubscribed('demo', 'm')).toBe(false);
  });

  it('only removes the calling plugin subscription when token values collide', () => {
    setActivePinia(createPinia());
    const registry = useMenuRegistry();
    registry.subscribe('plugin-a', 'file', 'menu_1');
    registry.subscribe('plugin-b', 'view', 'menu_1');

    registry.unsubscribe('plugin-a', 'menu_1');

    expect(registry.isSubscribed('plugin-a', 'file')).toBe(false);
    expect(registry.isSubscribed('plugin-b', 'view')).toBe(true);
  });
});
