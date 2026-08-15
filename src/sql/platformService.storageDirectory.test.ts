import { beforeEach, describe, expect, it, vi } from 'vitest';

const sql = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), buildBatchDeleteSql: vi.fn() }));
vi.mock('@/sql/common', () => sql);
vi.mock('@/sql/dbClient', () => ({ readonlyTransaction: vi.fn(), normalizeError: vi.fn() }));

import { createDebugPlugin, getDirectoryAccessGrant, getPluginDirectoryPermission, grantPluginDirectoryPermission, revokePluginDirectoryPermission } from './platformService';

describe('plugin directory permissions', () => {
  beforeEach(() => { Object.values(sql).forEach(mock => mock.mockReset()); });

  it('binds a stable permission key while projecting the real directory to a matching system setting', async () => {
    sql.query.mockResolvedValue({ code: 1, data: [] });
    sql.execute.mockResolvedValue({ code: 1, data: { rowsAffected: 1 } });
    await expect(grantPluginDirectoryPermission('shi-yu-lu-yvnr8p', 'storage_dir', 'grant-1', '/Users/test/notes', 'notes')).resolves.toMatchObject({ code: 1, data: { grant_id: 'grant-1', resource_locator: '/Users/test/notes' } });
    expect(sql.execute).toHaveBeenCalledWith(expect.stringContaining('permission_key'), expect.arrayContaining(['grant-1', 'shi-yu-lu-yvnr8p', 'storage_dir', '/Users/test/notes']));
    expect(sql.execute).toHaveBeenCalledWith(expect.stringContaining('param_value = ?, access_grant_id = ?'), ['/Users/test/notes', 'grant-1', expect.any(Number), 'shi-yu-lu-yvnr8p', 'storage_dir']);
  });

  it('reads and revokes an owned permission by its stable key', async () => {
    sql.query.mockResolvedValue({ code: 1, data: [{ grant_id: 'grant-1', resource_locator: '/Users/test/notes', resource_display_name: 'notes' }] });
    sql.execute.mockResolvedValue({ code: 1, data: { rowsAffected: 1 } });
    await expect(getPluginDirectoryPermission('shi-yu-lu-yvnr8p', 'storage_dir')).resolves.toMatchObject({ code: 1, data: { grant_id: 'grant-1' } });
    await expect(revokePluginDirectoryPermission('shi-yu-lu-yvnr8p', 'storage_dir')).resolves.toMatchObject({ code: 1, data: { grant_id: 'grant-1' } });
    expect(sql.execute).toHaveBeenCalledWith(expect.stringContaining("status = 'revoked'"), expect.arrayContaining(['grant-1', 'shi-yu-lu-yvnr8p']));
  });

  it('retrieves an active directory grant only for its owning plugin', async () => {
    sql.query.mockResolvedValue({ code: 1, data: [{ grant_id: 'file-grant-9', resource_locator: '/Users/test/notes', resource_display_name: 'notes', status: 'active' }] });
    await expect(getDirectoryAccessGrant('shi-yu-lu-yvnr8p', 'file-grant-9')).resolves.toMatchObject({ code: 1, data: { grant_id: 'file-grant-9', resource_locator: '/Users/test/notes' } });
    expect(sql.query).toHaveBeenCalledWith(expect.stringContaining("subject_id = ?"), ['shi-yu-lu-yvnr8p', 'file-grant-9']);
  });
});

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
