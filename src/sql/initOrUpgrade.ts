import { ElMessage } from 'element-plus';
import { Response } from '@/class';
import { invoke } from '@tauri-apps/api/core';

// 模块级缓存 Promise，防 HMR 重载重跑迁移
let _initPromise: Promise<Response> | null = null;

export function initDatabase(): Promise<Response> {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        const res = await runInitOrUpgrade();
        if (res.code !== 1) {
            ElMessage.error('应用初始化失败！原因：' + (res.msg || '未知错误'));
        } else {
            console.log('平台数据库初始化完成');
        }
        return res;
    })();
    return _initPromise;
}

export async function runInitOrUpgrade(): Promise<Response> {
    try {
        const r = await invoke<{ code: number; version: number }>('db_run_migrations');
        if (r.code === 1) {
            return Response.ok({ version: r.version });
        }
        return Response.error('迁移失败');
    } catch (e) {
        return Response.error('数据库初始化失败');
    }
}
