import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { fileGrants, FileGrantService } from '@/bridge/fileGrants';
import {
    deletePluginById, directoryPathHash, getDirectoryAccessGrant, getSettingByKey, grantPluginDirectoryPermission,
    revokePluginDirectoryPermission, setPluginDirectorySetting, verifyPluginDirectoryGrant,
} from './platformService';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: async () => '/app-data' }));
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: async () => false }));

const migrations = readFileSync(new URL('../../src-tauri/src/db.rs', import.meta.url), 'utf8');
const statements = [...migrations.matchAll(/tx\.execute\("([^"\n]+)", \[\]\)\?;/g)].map(match => match[1]);
const schema = [
    ...['tp_plugin', 'tp_menu', 'tp_setting', 'access_grant'].map(table =>
        statements.find(sql => sql.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`))!),
    statements.find(sql => sql === 'ALTER TABLE tp_setting ADD COLUMN access_grant_id TEXT')!,
    statements.find(sql => sql.startsWith('CREATE UNIQUE INDEX IF NOT EXISTS idx_access_grant_active_permission_key'))!,
];

// Retain compatibility with the development Node versions that lack built-in SQLite.
function loadSqlite(): typeof import('node:sqlite') | undefined {
    try { return createRequire(import.meta.url)('node:sqlite'); }
    catch { return undefined; }
}
const sqlite = loadSqlite();
let db: DatabaseSync;
const key = 'workspace_dir';
const path = '/shared/workbooks';

function install(code: string) {
    const plugin = db.prepare('INSERT INTO tp_plugin (plugin_code, plugin_alias, plugin_version, created_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(code, code, '1.0.0');
    const id = Number(plugin.lastInsertRowid);
    db.prepare("INSERT INTO tp_setting (param_code, param_name, param_type, param_value, param_key, plugin_id, created_at, updated_at) VALUES (?, ?, 'dir', '', ?, ?, 0, 0)")
        .run(`${code}::${key}`, key, key, id);
    return id;
}

describe.skipIf(!sqlite)('persistent directory grants', () => {
    beforeEach(() => {
        db = new sqlite!.DatabaseSync(':memory:');
        schema.forEach(sql => db.exec(sql));
        vi.mocked(invoke).mockImplementation(async (command, args) => {
            const input = args as { sql: string; params: SQLInputValue[]; allParams: SQLInputValue[][]; sqls: string[] };
            if (command === 'db_ready') return { ready: true } as never;
            if (command === 'db_query') return db.prepare(input.sql).all(...input.params) as never;
            if (command === 'db_transaction') {
                db.exec('BEGIN');
                try {
                    const results = input.sqls.map((sql, index) => {
                        const result = db.prepare(sql).run(...input.allParams[index]);
                        return { affectedRows: Number(result.changes) };
                    });
                    db.exec('COMMIT');
                    return results as never;
                } catch (error) {
                    db.exec('ROLLBACK');
                    throw error;
                }
            }
            throw new Error(`Unexpected command: ${command}`);
        });
    });

    afterEach(() => db.close());

    it('preserves revoked history and other plugins when uninstalling and reinstalling', async () => {
        const id = install('stone');
        install('map');
        const historical = (await grantPluginDirectoryPermission('stone', key, path, 'workbooks')).data.grant_id;
        const old = (await grantPluginDirectoryPermission('stone', key, path, 'workbooks')).data.grant_id;
        const other = (await grantPluginDirectoryPermission('map', key, path, 'workbooks')).data.grant_id;
        db.prepare('UPDATE access_grant SET revoked_at = 42 WHERE grant_id = ?').run(historical);
        const transient = fileGrants.grantWritableFile('stone', `${path}/example.gxp`);
        expect((await deletePluginById(id)).code).toBe(1);
        expect(fileGrants.resolveWritableFile('stone', transient.id)).toBeUndefined();
        install('stone');
        expect((await getDirectoryAccessGrant('stone', old)).code).toBe(-3);
        const fresh = (await grantPluginDirectoryPermission('stone', key, path, 'workbooks')).data.grant_id;
        expect(new Set([historical, old, other, fresh]).size).toBe(4);
        expect(db.prepare('SELECT revoked_at FROM access_grant WHERE grant_id = ?').get(historical)?.revoked_at).toBe(42);
        expect(db.prepare('SELECT status FROM access_grant WHERE grant_id = ?').get(old)?.status).toBe('revoked');
        expect((await getDirectoryAccessGrant('map', other)).code).toBe(1);
        expect((await getSettingByKey('stone', key)).data.accessGrantId).toBe(fresh);
        expect((await revokePluginDirectoryPermission('stone', key)).code).toBe(1);
        expect((await getSettingByKey('stone', key)).data.accessGrantId).toBeNull();
    });

    it('rolls back a failed authorization and repairs only an invalid current binding', async () => {
        install('map');
        await setPluginDirectorySetting('map', key, path);
        const old = (await grantPluginDirectoryPermission('map', key, path, 'workbooks')).data.grant_id;
        const hash = await directoryPathHash(path);
        db.exec("CREATE TRIGGER reject_new_grant BEFORE INSERT ON access_grant WHEN NEW.resource_locator = '/rejected' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
        expect((await grantPluginDirectoryPermission('map', key, '/rejected', 'rejected')).code).toBe(0);
        expect((await verifyPluginDirectoryGrant('map', key, old, hash)).code).toBe(1);
        expect((await verifyPluginDirectoryGrant('map', key, old, 'old-client-hash')).code).toBe(-2);
        expect((await getSettingByKey('map', key)).data.accessGrantId).toBe(old);
        const fresh = (await grantPluginDirectoryPermission('map', key, path, 'workbooks')).data.grant_id;
        expect((await verifyPluginDirectoryGrant('map', key, old, hash)).code).toBe(-3);
        expect((await getSettingByKey('map', key)).data.accessGrantId).toBe(fresh);
        db.prepare("UPDATE tp_setting SET param_value = '/changed' WHERE access_grant_id = ?").run(fresh);
        expect((await verifyPluginDirectoryGrant('map', key, fresh, hash)).code).toBe(-3);
        expect((await getSettingByKey('map', key)).data.accessGrantId).toBeNull();
        expect(db.prepare('SELECT status FROM access_grant WHERE grant_id = ?').get(fresh)?.status).toBe('revoked');
    });
});

it('issues fresh directory selections and preserves a save-dialog file’s write permission', () => {
    const grants = new FileGrantService();
    const old = grants.issueDirectoryReference('map', path, 'durable-id');
    const selected = grants.grantSelectedDirectory('map', path);
    expect(selected.id).not.toBe(old.id);
    expect(grants.takeSelectedDirectory('stone', selected.id)).toBeUndefined();
    expect(grants.takeSelectedDirectory('map', selected.id)?.path).toBe(path);
    expect(grants.takeSelectedDirectory('map', selected.id)).toBeUndefined();

    const file = grants.grantWritableFile('map', `${path}/example.gxp`);
    expect(grants.resolveFile('map', file.id)).toBeUndefined();
    expect(grants.completeFileWrite('map', file.id)).toEqual(file);
    expect(grants.resolveFile('map', file.id)).toBe(`${path}/example.gxp`);
    expect(grants.resolveWritableFile('map', file.id)).toBe(`${path}/example.gxp`);
    expect(grants.resolveWritableFile('stone', file.id)).toBeUndefined();
});
