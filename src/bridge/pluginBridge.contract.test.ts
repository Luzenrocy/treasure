import { describe, expect, it } from 'vitest';
import { capabilityRegistry, isExpectedPluginOrigin, toResult } from './pluginBridge';

describe('plugin bridge SDK 2.0 contract', () => {
  it('only registers stable typed operations at the 2.0 platform boundary', () => {
    expect(Object.keys(capabilityRegistry)).toEqual(expect.arrayContaining([
      'files.openDialog', 'files.saveDialog', 'files.readFile', 'files.writeFile',
      'directories.list', 'directories.create', 'directories.remove',
      'storage.read', 'storage.write', 'storage.remove',
      'database.query', 'database.execute', 'database.transaction',
      'settings.get', 'settings.set', 'settings.list',
      'permissions.grantDirectory', 'permissions.getDirectory', 'permissions.revokeDirectory',
      'menus.register', 'menus.unregister', 'notifications.send', 'logs.write',
    ]));
    expect(capabilityRegistry['files.writeFile']!.validate({ directory: { id: 'dir' }, fileName: '报告.txt', data: new Uint8Array([1]) })).toBe(true);
    expect(capabilityRegistry['permissions.grantDirectory']!.validate({ permissionKey: 'notes_directory', directory: { id: 'grant', kind: 'directory' } })).toBe(true);
    expect(capabilityRegistry['permissions.grantDirectory']!.validate({ permissionKey: '../invalid', directory: { id: 'grant', kind: 'directory' } })).toBe(false);
    expect(capabilityRegistry['files.saveDialog']!.validate({ title: '保存', defaultFileName: '报告.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] })).toBe(true);
    expect(capabilityRegistry['files.saveDialog']!.validate({ defaultFileName: '../报告.pdf' })).toBe(false);
    expect(capabilityRegistry['files.writeFile']!.validate({ directory: { id: 'dir' }, fileName: '报告.txt', data: 'base64' })).toBe(false);
    expect(capabilityRegistry['database.query']!.minPlatformVersion).toBe('2.0.0');
    expect(capabilityRegistry['request']).toBeUndefined();
  });

  it('accepts Uint8Array values received from another window realm', () => {
    const crossRealmBytes = new Uint8Array([1, 2]);
    Object.setPrototypeOf(crossRealmBytes, Int8Array.prototype);
    expect(crossRealmBytes instanceof Uint8Array).toBe(false);
    expect(capabilityRegistry['files.writeFile']!.validate({ directory: { id: 'dir' }, fileName: '报告.txt', data: crossRealmBytes })).toBe(true);
    expect(capabilityRegistry['storage.write']!.validate({ key: 'attachments/a.bin', data: crossRealmBytes })).toBe(true);
  });

  it('normalizes legacy host records into the Result<T> contract without losing transaction results', () => {
    expect(toResult({ code: 1, data: [{ id: 1 }] }, 'database.query')).toEqual({ ok: true, value: { rows: [{ id: 1 }] } });
    expect(toResult({ code: 1, data: [] }, 'database.query')).toEqual({ ok: true, value: { rows: [] } });
    expect(toResult({ code: 1, data: [{ affectedRows: 1, lastInsertId: 2 }] }, 'database.transaction')).toEqual({ ok: true, value: [{ affectedRows: 1, lastInsertId: 2 }] });
    expect(toResult({ code: 1, data: [{ param_key: 'grant', param_value: 'dir-1' }] }, 'settings.list')).toEqual({ ok: true, value: [{ key: 'grant', value: 'dir-1' }] });
    expect(toResult({ code: 0, msg: '拒绝' })).toEqual({ ok: false, error: { code: 'INTERNAL', message: '拒绝' } });
  });

  it('requires a debug plugin message origin to exactly match its registered development origin', () => {
    const source = {} as Window;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { querySelectorAll: () => [{ contentWindow: source, getAttribute: () => 'http://localhost:5173/' }] },
    });

    expect(isExpectedPluginOrigin(source, 'http://localhost:5173')).toBe(true);
    expect(isExpectedPluginOrigin(source, 'http://localhost:5174')).toBe(false);
    expect(isExpectedPluginOrigin(source, 'http://example.test')).toBe(false);
  });
});
