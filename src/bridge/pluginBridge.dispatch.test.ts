import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(), save: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), readDir: vi.fn(),
  invoke: vi.fn(), logEvent: vi.fn(), register: vi.fn(), unregister: vi.fn(),
  query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), getDirectoryAccessGrant: vi.fn(), grantPluginDirectoryPermission: vi.fn(), getPluginDirectoryPermission: vi.fn(), revokePluginDirectoryPermission: vi.fn(),
  isPermissionGranted: vi.fn(), requestPermission: vi.fn(), sendNotification: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, save: mocks.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: mocks.readFile, writeFile: mocks.writeFile, mkdir: mocks.mkdir, readDir: mocks.readDir }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: vi.fn().mockResolvedValue('/app') }));
vi.mock('@tauri-apps/plugin-notification', () => ({ isPermissionGranted: mocks.isPermissionGranted, requestPermission: mocks.requestPermission, sendNotification: mocks.sendNotification }));
vi.mock('@/utils/logger', () => ({ logEvent: mocks.logEvent }));
vi.mock('@/sql/platformService', () => ({ getSettingsByPluginCode: mocks.query, saveSettingsByPluginCode: mocks.execute, getSettingByKey: mocks.query, upsertSettingByKey: mocks.execute, getDirectoryAccessGrant: mocks.getDirectoryAccessGrant, grantPluginDirectoryPermission: mocks.grantPluginDirectoryPermission, getPluginDirectoryPermission: mocks.getPluginDirectoryPermission, revokePluginDirectoryPermission: mocks.revokePluginDirectoryPermission }));
vi.mock('@/store/menuRegistry', () => ({ useMenuRegistry: () => ({ register: mocks.register, unregister: mocks.unregister }) }));
vi.mock('@/store/tabs', () => ({ useTabsStore: () => ({ activePluginCode: 'trusted-plugin' }) }));
vi.mock('./pluginSqlExecutor', () => ({ PluginSqlExecutor: class { executeRequest = mocks.execute; } }));

let listener: ((event: any) => Promise<void>) | undefined;
let source: { postMessage: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  listener = undefined;
  source = { postMessage: vi.fn() };
  mocks.logEvent.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue('/tmp/报告.txt');
  mocks.save.mockResolvedValue('/tmp/自定义报告.pdf');
  mocks.readFile.mockResolvedValue(new Uint8Array([1, 2]));
  mocks.invoke.mockResolvedValue({ sql: 'SELECT 1' });
  mocks.transaction.mockResolvedValue({ code: 1, data: {} });
  mocks.grantPluginDirectoryPermission.mockResolvedValue({ code: 1, data: { grant_id: 'file-grant-1', resource_locator: '/tmp/报告.txt', resource_display_name: '报告.txt' } });
  mocks.getPluginDirectoryPermission.mockResolvedValue({ code: 1, data: { grant_id: 'file-grant-1', resource_locator: '/tmp/报告.txt', resource_display_name: '报告.txt' } });
  mocks.revokePluginDirectoryPermission.mockResolvedValue({ code: 1, data: { grant_id: 'file-grant-1' } });
  mocks.getDirectoryAccessGrant.mockResolvedValue({ code: 1, data: { grant_id: 'active-root', resource_locator: '/tmp/报告.txt', resource_display_name: '报告.txt', status: 'active' } });
  mocks.isPermissionGranted.mockResolvedValue(true);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener: vi.fn((_type: string, handler: any) => { listener = handler; }) } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelectorAll: vi.fn(() => [{ contentWindow: source, dataset: { treasurePlugin: 'trusted-plugin' }, getAttribute: () => 'plugin://localhost/trusted-plugin/index.html' }]),
    querySelector: vi.fn(() => ({ contentWindow: source })),
  } });
});

async function request(operation: string, payload: unknown, messageSource = source) {
  const { initPluginBridge } = await import('./pluginBridge');
  if (!listener) initPluginBridge();
  await listener!({ origin: 'plugin://localhost', source: messageSource, data: { type: 'treasure-db-request', requestId: `${operation}-${Math.random()}`, operation, payload } });
  const calls = messageSource.postMessage.mock.calls;
  return calls[calls.length - 1]?.[0]?.result;
}

describe('plugin bridge dispatch', () => {
  it('derives identity from the iframe source and never honors a spoofed pluginCode payload', async () => {
    const opened = await request('files.openDialog', { kind: 'file', pluginCode: 'attacker' });
    expect(opened).toMatchObject({ ok: true, value: [expect.objectContaining({ id: expect.any(String), name: '报告.txt' })] });
    expect(opened.value[0]).not.toHaveProperty('path');

    const read = await request('files.readFile', { file: opened.value[0], pluginCode: 'other-plugin' });
    expect(read).toEqual({ ok: true, value: new Uint8Array([1, 2]) });
    expect(mocks.readFile).toHaveBeenCalledWith('/tmp/报告.txt');
  });

  it('rejects an unregistered source before it can request a capability', async () => {
    const untrusted = { postMessage: vi.fn() };
    const result = await request('files.openDialog', { kind: 'file' }, untrusted);
    expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('returns CANCELLED instead of throwing when the user closes the system dialog', async () => {
    mocks.open.mockResolvedValueOnce(null);
    await expect(request('files.openDialog', { kind: 'directory' })).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });

  it('rehydrates a persisted directory grant when the bridge cache no longer has its reference', async () => {
    mocks.getDirectoryAccessGrant.mockResolvedValue({ code: 1, data: { grant_id: 'file-grant-99', resource_locator: '/tmp/restored', resource_display_name: 'restored', status: 'active' } });
    mocks.readDir.mockResolvedValue([]);
    await expect(request('directories.list', { directory: { id: 'file-grant-99', name: 'restored', kind: 'directory' } }))
      .resolves.toEqual({ ok: true, value: [] });
    expect(mocks.readDir).toHaveBeenCalledWith('/tmp/restored');
  });

  it('writes a hidden child directory under an active selected root without requiring a second persisted grant', async () => {
    const root = await request('files.openDialog', { kind: 'directory' });
    mocks.readDir.mockResolvedValueOnce([{ name: '.assets', isDirectory: true }]);
    const listed = await request('directories.list', { directory: root.value });
    const assets = listed.value[0].directory;

    await expect(request('files.writeFile', {
      directory: assets, fileName: '.asset-index.json', data: new Uint8Array([1]),
    })).resolves.toMatchObject({ ok: true, value: { kind: 'file', name: '.asset-index.json' } });
    expect(mocks.writeFile).toHaveBeenCalledWith('/tmp/报告.txt/.assets/.asset-index.json', expect.any(Uint8Array));
  });

  it('audits a denied directory reference instead of silently returning a generic permission error', async () => {
    mocks.getDirectoryAccessGrant.mockResolvedValue({ code: 0, msg: 'revoked' });
    await expect(request('files.writeFile', {
      directory: { id: 'expired-child', name: '.assets', kind: 'directory' }, fileName: 'image.png', data: new Uint8Array([1]),
    })).resolves.toEqual({ ok: false, error: { code: 'GRANT_NOT_FOUND', message: '目录授权不存在、已撤销或引用已过期' } });
    expect(mocks.logEvent).toHaveBeenCalledWith('warn', 'bridge', 'directory access denied', expect.objectContaining({
      pluginCode: 'trusted-plugin', reason: 'GRANT_NOT_FOUND',
    }));
  });

  it('opens one native save panel with a default filename and never exposes its path', async () => {
    const saved = await request('files.saveDialog', {
      title: '导出 PDF', defaultFileName: '报告.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ title: '导出 PDF', defaultPath: '报告.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] }));
    expect(saved).toMatchObject({ ok: true, value: { kind: 'file', name: '自定义报告.pdf' } });
    expect(saved.value).not.toHaveProperty('path');
  });

  it('binds a user-selected directory to a plugin-defined permission key without exposing its path', async () => {
    const directory = await request('files.openDialog', { kind: 'directory' });
    await expect(request('permissions.grantDirectory', { permissionKey: 'notes_directory', directory: directory.value })).resolves.toMatchObject({ ok: true, value: { id: 'file-grant-1', kind: 'directory' } });
    expect(mocks.grantPluginDirectoryPermission).toHaveBeenCalledWith('trusted-plugin', 'notes_directory', directory.value.id, '/tmp/报告.txt', '报告.txt');
    await expect(request('permissions.getDirectory', { permissionKey: 'notes_directory' })).resolves.toMatchObject({ ok: true, value: { id: 'file-grant-1', kind: 'directory' } });
    await expect(request('permissions.revokeDirectory', { permissionKey: 'notes_directory' })).resolves.toEqual({ ok: true, value: undefined });
  });

  it('routes directory, private storage, settings, menus, logs and database through registered handlers', async () => {
    const directory = await request('files.openDialog', { kind: 'directory' });
    mocks.readDir.mockResolvedValueOnce([{ name: 'assets', isDirectory: true }, { name: '说明.md', isDirectory: false }]);
    await expect(request('directories.list', { directory: directory.value })).resolves.toMatchObject({ ok: true, value: [expect.objectContaining({ kind: 'directory' }), expect.objectContaining({ kind: 'file' })] });
    await expect(request('directories.create', { directory: directory.value, name: '新目录' })).resolves.toMatchObject({ ok: true, value: { kind: 'directory' } });
    await expect(request('directories.remove', { directory: directory.value, name: '说明.md' })).resolves.toEqual({ ok: true, value: undefined });

    await expect(request('storage.write', { key: 'attachments/a.bin', data: new Uint8Array([1]) })).resolves.toEqual({ ok: true, value: undefined });
    mocks.readFile.mockResolvedValueOnce(new Uint8Array([9]));
    await expect(request('storage.read', { key: 'attachments/a.bin' })).resolves.toEqual({ ok: true, value: new Uint8Array([9]) });
    await expect(request('storage.remove', { key: 'attachments/a.bin' })).resolves.toEqual({ ok: true, value: undefined });

    mocks.query.mockResolvedValueOnce({ code: 1, data: [{ param_key: 'grant', param_value: 'dir-1' }] });
    mocks.execute.mockResolvedValue({ code: 1, data: [] });
    await expect(request('settings.list', {})).resolves.toEqual({ ok: true, value: [{ key: 'grant', value: 'dir-1' }] });
    await expect(request('settings.set', { key: 'grant', value: 'dir-1' })).resolves.toEqual({ ok: true, value: [] });
    await expect(request('menus.register', { menuId: 'file', rootLabel: 'File', items: [] })).resolves.toEqual({ ok: true, value: undefined });
    await expect(request('menus.unregister', { id: 'file' })).resolves.toEqual({ ok: true, value: undefined });
    await expect(request('logs.write', { level: 'info', category: 'test', message: 'ok' })).resolves.toEqual({ ok: true, value: undefined });
    await expect(request('database.query', { sql: 'SELECT * FROM tasks', tables: ['tasks'] })).resolves.toEqual({ ok: true, value: { rows: [] } });
    expect(mocks.register).toHaveBeenCalledWith('trusted-plugin', expect.any(Object));
    expect(mocks.invoke).toHaveBeenCalledWith('move_to_trash', expect.any(Object));
  });

  it('handles write, transaction, settings lookup, notification and validation failure branches', async () => {
    const directory = await request('files.openDialog', { kind: 'directory' });
    await expect(request('files.writeFile', { directory: directory.value, fileName: '导出.txt', data: new Uint8Array([1]) })).resolves.toMatchObject({ ok: true, value: { kind: 'file' } });
    expect(mocks.mkdir).toHaveBeenLastCalledWith('/tmp/报告.txt', { recursive: true });
    await expect(request('files.readFile', { file: { id: 'not-granted' } })).resolves.toMatchObject({ ok: false, error: { code: 'REFERENCE_EXPIRED' } });
    mocks.execute.mockResolvedValue({ code: 1, data: { rowsAffected: 2, lastInsertId: 3 } });
    await expect(request('database.execute', { sql: 'UPDATE tasks SET title = ?', tables: ['tasks'], params: ['x'] })).resolves.toEqual({ ok: true, value: { affectedRows: 2, lastInsertId: 3, rows: undefined } });
    mocks.execute.mockResolvedValue({ code: 1, data: [{ affectedRows: 1 }] });
    await expect(request('database.transaction', { statements: [{ sql: 'DELETE FROM tasks WHERE id = ?', tables: ['tasks'], params: [1] }] })).resolves.toEqual({ ok: true, value: [{ affectedRows: 1 }] });
    mocks.query.mockResolvedValue({ code: 1, data: { param_key: 'grant', param_value: 'dir-1' } });
    await expect(request('settings.get', { key: 'grant' })).resolves.toEqual({ ok: true, value: { key: 'grant', value: 'dir-1' } });
    await expect(request('notifications.send', { title: '完成', body: '已导出' })).resolves.toEqual({ ok: true, value: undefined });
    expect(mocks.sendNotification).toHaveBeenCalledWith(expect.objectContaining({ title: '完成', body: '已导出' }));
    await expect(request('files.writeFile', { directory: { id: 'x' }, fileName: 'a.txt', data: 'base64' })).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    await expect(request('unknown.operation', {})).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('accepts a safe filename containing consecutive dots when writing an uploaded image', async () => {
    const directory = await request('files.openDialog', { kind: 'directory' });
    await expect(request('files.writeFile', {
      directory: directory.value,
      fileName: '截图..2026.png',
      data: new Uint8Array([137, 80, 78, 71]),
    })).resolves.toMatchObject({ ok: true, value: { kind: 'file', name: '截图..2026.png' } });
    expect(mocks.writeFile).toHaveBeenCalledWith('/tmp/报告.txt/截图..2026.png', expect.any(Uint8Array));
  });

  it('preserves a non-Error native file-write failure for the plugin and host audit log', async () => {
    const directory = await request('files.openDialog', { kind: 'directory' });
    mocks.writeFile.mockRejectedValueOnce('原生文件写入被拒绝');
    await expect(request('files.writeFile', { directory: directory.value, fileName: 'note.md', data: new Uint8Array([1]) }))
      .resolves.toEqual({ ok: false, error: { code: 'INTERNAL', message: '原生文件写入被拒绝' } });
    expect(mocks.logEvent).toHaveBeenCalledWith('error', 'bridge', 'writeGrantedFile failed', expect.objectContaining({ error: '原生文件写入被拒绝' }));
  });
});
