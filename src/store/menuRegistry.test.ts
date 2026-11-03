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
});
