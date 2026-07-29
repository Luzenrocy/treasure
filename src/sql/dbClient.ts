import { invoke } from '@tauri-apps/api/core';
import { Response } from '@/class';

// ── 错误归一化 ──────────────────────────────────────────────
export function normalizeError(e: unknown): string {
    if (e instanceof Error && e.message) return e.message;
    if (typeof e === 'string' && e.length > 0) return e;
    if (e && typeof e === 'object' && 'message' in e && typeof (e as any).message === 'string' && (e as any).message) {
        return (e as any).message;
    }
    try {
        const s = JSON.stringify(e);
        if (s && s !== '{}') return s;
    } catch { /* fallthrough */ }
    return '未知错误';
}

// ── 初始化门禁 ──────────────────────────────────────────────
let _readyPromise: Promise<Response> | null = null;

export async function awaitReady(): Promise<Response> {
    if (_readyPromise) return _readyPromise;
    _readyPromise = runMigrations();
    _readyPromise = _readyPromise.then(r => {
        if (r.code !== 1) _readyPromise = null;
        return r;
    }).catch(() => {
        _readyPromise = null;
        throw _readyPromise;
    });
    return _readyPromise;
}

// ── 迁移执行器 ──────────────────────────────────────────────
export const LATEST_VERSION = 3;

export async function runMigrations(): Promise<Response> {
    try {
        const r = await invoke<{ code: number; version: number }>('db_run_migrations');
        if (r.code === 1) {
            return Response.ok({ version: r.version });
        }
        return Response.error('迁移失败');
    } catch (e) {
        const msg = normalizeError(e);
        return Response.error(msg);
    }
}

// ── 公共出口 ─────────────────────────────────────────────────

/** 执行 SELECT 查询 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<Response> {
    try {
        const rows = await invoke<T[]>('db_query', { sql, params });
        return Response.ok(rows);
    } catch (e) {
        const msg = normalizeError(e);
        return Response.error(msg);
    }
}

/** 执行写操作（INSERT / UPDATE / DELETE） */
export async function execute(sql: string, params: any[] = []): Promise<Response> {
    try {
        const res = await invoke<{ rowsAffected: number; lastInsertId: number }>('db_execute', { sql, params });
        return Response.ok({ lastInsertId: res.lastInsertId || 0, rowsAffected: res.rowsAffected || 0 });
    } catch (e) {
        const msg = normalizeError(e);
        return Response.error(msg);
    }
}

/** 执行 DDL 语句 */
export async function ddl(sql: string): Promise<Response> {
    try {
        const res = await invoke<{ rowsAffected: number }>('db_execute', { sql, params: [] });
        return Response.ok({ rowsAffected: res.rowsAffected || 0 });
    } catch (e) {
        const msg = normalizeError(e);
        return Response.error(msg);
    }
}

/** 执行事务（多条 SQL 原子提交） */
export async function transaction(operations: Array<{ sql: string; params?: any[] }>): Promise<Response> {
    try {
        const sqls = operations.map(op => op.sql);
        const allParams = operations.map(op => (op.params || []));
        const res = await invoke<{ executed: number }>('db_transaction', { sqls, allParams });
        return Response.ok({ executed: res.executed || 0 });
    } catch (e) {
        const msg = normalizeError(e);
        return Response.error(`事务执行失败: ${msg}`);
    }
}

/** 执行只读事务（多条 SQL，无写锁） */
export async function readonlyTransaction(
    operations: Array<{ sql: string; params?: any[] }>,
): Promise<any[]> {
    try {
        const sqls = operations.map(op => op.sql);
        const allParams = operations.map(op => (op.params || []));
        const rows = await invoke<any[]>('db_readonly_transaction', { sqls, allParams });
        return rows;
    } catch (e) {
        throw new Error(normalizeError(e));
    }
}
