import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { awaitReady, ddl, execute, normalizeError, query, readonlyTransaction, runMigrations, transaction } from './dbClient';

describe('dbClient SQL result contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves SELECT and RETURNING rows rather than discarding them', async () => {
    invoke.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([{ id: 2 }]);
    await expect(query('SELECT id FROM tasks', [])).resolves.toMatchObject({ code: 1, data: [{ id: 1 }] });
    await expect(execute('INSERT INTO tasks DEFAULT VALUES RETURNING id', [])).resolves.toMatchObject({ code: 1, data: { rowsAffected: 1, rows: [{ id: 2 }] } });
    expect(invoke).toHaveBeenNthCalledWith(1, 'db_query', { sql: 'SELECT id FROM tasks', params: [] });
    expect(invoke).toHaveBeenNthCalledWith(2, 'db_query', { sql: 'INSERT INTO tasks DEFAULT VALUES RETURNING id', params: [] });
  });

  it('returns native write and per-statement transaction results', async () => {
    invoke.mockResolvedValueOnce({ rowsAffected: 2, lastInsertId: 7 }).mockResolvedValueOnce([{ affectedRows: 1, lastInsertId: 8 }]);
    await expect(execute('UPDATE tasks SET title = ?', ['x'])).resolves.toMatchObject({ code: 1, data: { rowsAffected: 2, lastInsertId: 7 } });
    await expect(transaction([{ sql: 'DELETE FROM tasks WHERE id = ?', params: [1] }])).resolves.toMatchObject({ code: 1, data: [{ affectedRows: 1, lastInsertId: 8 }] });
    expect(invoke).toHaveBeenLastCalledWith('db_transaction', { sqls: ['DELETE FROM tasks WHERE id = ?'], allParams: [[1]] });
  });

  it('normalizes rejected invocations without leaking unknown values', async () => {
    invoke.mockRejectedValueOnce(new Error('disk offline'));
    await expect(query('SELECT 1')).resolves.toMatchObject({ code: 0, msg: 'disk offline' });
    expect(normalizeError({ message: '结构化错误' })).toBe('结构化错误');
    expect(normalizeError('{"message":"json错误"}')).toBe('{"message":"json错误"}');
    expect(normalizeError({ reason: 'unknown' })).toBe('{"reason":"unknown"}');
    expect(normalizeError(undefined)).toBe('未知错误');
  });

  it('covers migration, DDL, readonly transaction and write failure responses', async () => {
    invoke.mockResolvedValueOnce({ code: 1, version: 4 });
    await expect(runMigrations()).resolves.toMatchObject({ code: 1, data: { version: 4 } });
    invoke.mockResolvedValueOnce({ rowsAffected: 1 });
    await expect(ddl('CREATE INDEX idx ON tasks(title)')).resolves.toMatchObject({ code: 1, data: { rowsAffected: 1 } });
    invoke.mockResolvedValueOnce([{ id: 1 }]);
    await expect(readonlyTransaction([{ sql: 'SELECT id FROM tasks' }])).resolves.toEqual([{ id: 1 }]);
    invoke.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 });
    await expect(execute('DELETE FROM tasks WHERE id = ?', [1])).resolves.toMatchObject({ code: 1 });
    invoke.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 0 });
    await expect(execute('UPDATE tasks SET title = title')).resolves.toMatchObject({ code: 1, data: { rowsAffected: 0, lastInsertId: 0 } });
    invoke.mockRejectedValueOnce('transaction failed');
    await expect(transaction([{ sql: 'UPDATE tasks SET title = ?', params: ['x'] }])).resolves.toMatchObject({ code: 0 });
    invoke.mockRejectedValueOnce(new Error('migration failed'));
    await expect(runMigrations()).resolves.toMatchObject({ code: 0, msg: 'migration failed' });
    invoke.mockRejectedValueOnce(new Error('readonly failed'));
    await expect(readonlyTransaction([{ sql: 'SELECT 1' }])).rejects.toThrow('readonly failed');
    // The readiness gate shares the same Result contract on its first call.
    invoke.mockResolvedValueOnce({ code: 1, version: 5 });
    await expect(awaitReady()).resolves.toMatchObject({ code: 1, data: { version: 5 } });
  });
});
