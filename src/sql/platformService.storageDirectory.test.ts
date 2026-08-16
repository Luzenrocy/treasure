import { beforeEach, describe, expect, it, vi } from 'vitest';

const sql = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), buildBatchDeleteSql: vi.fn() }));
vi.mock('@/sql/common', () => sql);
vi.mock('@/sql/dbClient', () => ({ readonlyTransaction: vi.fn(), normalizeError: vi.fn() }));

import { batchDeletePlugins, createDebugPlugin, deletePluginById, getDirectoryAccessGrant, grantPluginDirectoryPermission, revokePluginDirectoryPermission, verifyPluginDirectoryGrant } from './platformService';

describe('plugin directory permissions', () => {
  beforeEach(() => { Object.values(sql).forEach(mock => mock.mockReset()); });

  it('creates a new authorization and only binds the matching directory setting', async () => {
    sql.query.mockResolvedValue({ code: 1, data: [{ param_value: '/Users/test/notes' }] });
    sql.transaction.mockResolvedValue({ code: 1, data: { rowsAffected: 1 } });
    await expect(grantPluginDirectoryPermission('shi-yu-lu-yvnr8p', 'storage_dir', '/Users/test/notes', 'notes')).resolves.toMatchObject({ code: 1, data: { grant_id: expect.any(String), resource_locator: '/Users/test/notes' } });
    expect(sql.transaction).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ sql: expect.stringContaining('INSERT INTO access_grant'), params: expect.arrayContaining(['shi-yu-lu-yvnr8p', 'storage_dir', '/Users/test/notes']) }),
      expect.objectContaining({ sql: expect.stringContaining('SET access_grant_id = ?'), params: [expect.any(String), expect.any(Number), 'shi-yu-lu-yvnr8p', 'storage_dir'] }),
    ]));
    expect(sql.transaction.mock.calls[0][0].map((item: any) => item.sql).join('\n')).not.toContain('param_value = ?');
  });

  it('verifies only the supplied authorization identity and path hash, without querying settings', async () => {
    sql.query.mockResolvedValueOnce({ code: 1, data: [{ grant_id: 'grant-1', resource_locator: '/Users/test/notes', resource_display_name: 'notes', status: 'active' }] });
    const hash = await sha256('/Users/test/notes');

    await expect(verifyPluginDirectoryGrant('shi-yu-lu-yvnr8p', 'storage_dir', 'grant-1', hash)).resolves.toMatchObject({
      code: 1,
      data: { grant_id: 'grant-1', resource_locator: '/Users/test/notes', resource_display_name: 'notes' },
    });
    expect(sql.query).toHaveBeenCalledTimes(1);
    expect(sql.query).toHaveBeenLastCalledWith(expect.not.stringContaining('tp_setting'), [
      'plugin', 'shi-yu-lu-yvnr8p', 'filesystem_directory', 'grant-1', 'storage_dir',
    ]);
  });

  it('requires reauthorization when the supplied path hash does not match the authorization', async () => {
    sql.query.mockResolvedValueOnce({ code: 1, data: [{ grant_id: 'grant-1', resource_locator: '/Users/test/notes', resource_display_name: 'notes', status: 'active' }] });

    await expect(verifyPluginDirectoryGrant('shi-yu-lu-yvnr8p', 'storage_dir', 'grant-1', 'other-hash')).resolves.toMatchObject({
      code: -2,
      msg: '目录设置与当前授权不一致，请重新授权',
    });
  });

  it('revokes an owned permission by its stable key', async () => {
    sql.query.mockResolvedValue({ code: 1, data: [{ grant_id: 'grant-1' }] });
    sql.execute.mockResolvedValue({ code: 1, data: { rowsAffected: 1 } });
    await expect(revokePluginDirectoryPermission('shi-yu-lu-yvnr8p', 'storage_dir')).resolves.toMatchObject({ code: 1, data: { grant_id: 'grant-1' } });
    expect(sql.execute).toHaveBeenCalledWith(expect.stringContaining("status = 'revoked'"), expect.arrayContaining(['grant-1', 'shi-yu-lu-yvnr8p']));
  });

  it('retrieves an active directory grant only for its owning plugin', async () => {
    sql.query.mockResolvedValue({ code: 1, data: [{ grant_id: 'file-grant-9', resource_locator: '/Users/test/notes', resource_display_name: 'notes', status: 'active' }] });
    await expect(getDirectoryAccessGrant('shi-yu-lu-yvnr8p', 'file-grant-9')).resolves.toMatchObject({ code: 1, data: { grant_id: 'file-grant-9', resource_locator: '/Users/test/notes' } });
    expect(sql.query).toHaveBeenCalledWith(expect.stringContaining("subject_id = ?"), ['shi-yu-lu-yvnr8p', 'file-grant-9']);
  });
});

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(item => item.toString(16).padStart(2, '0')).join('');
}

describe('createDebugPlugin', () => {
  beforeEach(() => { Object.values(sql).forEach(mock => mock.mockReset()); });

  it('refreshes an existing debug registration instead of creating a duplicate plugin', async () => {
    sql.query
      .mockResolvedValueOnce({ code: 1, data: [{ count: 1 }] })
      .mockResolvedValueOnce({ code: 1, data: [{ id: 9, plugin_type: 1, plugin_uid: 'debug-uid' }] })
      .mockResolvedValueOnce({ code: 1, data: [{ id: 9, plugin_type: 1, plugin_uid: 'debug-uid' }] });
    sql.transaction.mockResolvedValue({ code: 1, data: {} });

    await expect(createDebugPlugin({ pluginCode: 'my-plugin', pluginAlias: '我的插件', debugUrl: 'http://localhost:5173' }))
      .resolves.toMatchObject({ code: 1, data: { pluginId: 9 } });
    expect(sql.transaction).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ params: expect.arrayContaining(['debug-uid', 'http://localhost:5173']) }),
    ]));
  });
});

describe('plugin deletion', () => {
  beforeEach(() => {
    Object.values(sql).forEach(mock => mock.mockReset());
    sql.buildBatchDeleteSql.mockImplementation((table: string, column: string, ids: number[]) => ({
      sql: `DELETE FROM ${table} WHERE ${column} IN (${ids.map(() => '?').join(',')})`,
      params: ids,
    }));
    sql.query.mockResolvedValue({ code: 1, data: [] });
    sql.transaction.mockResolvedValue({ code: 1, data: {} });
  });

  it('deletes the deleted plugin\'s directory grants by plugin code', async () => {
    sql.query.mockResolvedValueOnce({ code: 1, data: [{ plugin_code: 'shi-yu-lu-yvnr8p' }] });

    await deletePluginById(42);

    expect(sql.transaction).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        sql: expect.stringContaining('DELETE FROM access_grant'),
        params: ['plugin', 'shi-yu-lu-yvnr8p', 'filesystem_directory'],
      }),
    ]));
  });

  it('deletes directory grants for every plugin in a batch deletion', async () => {
    sql.query.mockImplementation((statement: string, params: unknown[]) => {
      if (statement === 'SELECT plugin_code FROM tp_plugin WHERE id = ?') {
        return Promise.resolve({
          code: 1,
          data: [{ plugin_code: params[0] === 42 ? 'shi-yu-lu-yvnr8p' : 'another-plugin' }],
        });
      }
      return Promise.resolve({ code: 1, data: [] });
    });

    await batchDeletePlugins([42, 43]);

    expect(sql.transaction).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ sql: expect.stringContaining('DELETE FROM access_grant'), params: ['plugin', 'shi-yu-lu-yvnr8p', 'filesystem_directory'] }),
      expect.objectContaining({ sql: expect.stringContaining('DELETE FROM access_grant'), params: ['plugin', 'another-plugin', 'filesystem_directory'] }),
    ]));
  });
});
