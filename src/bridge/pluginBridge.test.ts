import { describe, expect, it } from 'vitest';
import { capabilityRegistry, MENU_CAPABILITY_VERSION, toResult } from './pluginBridge';

describe('menu bridge contract', () => {
  it('registers versioned menu operations with payload validation', () => {
    expect(MENU_CAPABILITY_VERSION).toBe(1);
    expect(capabilityRegistry['menus.update'].validate({ menuId: 'm', items: [] })).toBe(true);
    expect(capabilityRegistry['menus.subscribe'].validate({ menuId: 'm', token: 't' })).toBe(true);
    expect(capabilityRegistry['menus.unsubscribe'].validate({ token: 't' })).toBe(true);
    expect(capabilityRegistry['menus.subscribe'].validate({ menuId: 'm' })).toBe(false);
    expect(toResult({ code: 0, msg: 'unsupported' }, 'menus.update')).toMatchObject({ ok: false });
  });
});
