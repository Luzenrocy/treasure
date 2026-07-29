import { invoke } from '@tauri-apps/api/core';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'db' | 'biz' | 'sys' | 'bridge';

export async function logEvent(level: LogLevel, category: LogCategory, message: string, details?: any): Promise<void> {
  try {
    await invoke('log_event', {
      level,
      category,
      message,
      details: details ? JSON.stringify(details) : null,
    });
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('[logger] log_event failed:', e);
    }
  }
}

export async function setLogLevel(level: LogLevel): Promise<void> {
  try {
    await invoke('set_log_level', { level });
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error('[logger] set_log_level failed:', e);
    }
  }
}