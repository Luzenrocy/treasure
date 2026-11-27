import { expect, it, vi } from 'vitest';
import Frame from './index.vue';

it('keeps the startup overlay until menu loading succeeds', async () => {
  let finish!: (result: { code: number; msg: string }) => void;
  const fetchMenus = vi.fn(() => new Promise<{ code: number; msg: string }>(resolve => { finish = resolve; }));
  const state = { startupLoading: true, startupError: '', menuStore: { fetchMenus } };
  const loading = Frame.methods!.loadStartup.call(state as never);
  expect(state.startupLoading).toBe(true);
  finish({ code: 1, msg: '' });
  await loading;
  expect(state.startupLoading).toBe(false);
});

it('shows an error and permits retry when initialization fails', async () => {
  const fetchMenus = vi.fn()
    .mockResolvedValueOnce({ code: 0, msg: '数据库忙' })
    .mockResolvedValueOnce({ code: 1, msg: '' });
  const state = { startupLoading: true, startupError: '', menuStore: { fetchMenus } };
  await Frame.methods!.loadStartup.call(state as never);
  expect(state.startupLoading).toBe(true);
  expect(state.startupError).toBe('数据库忙');
  await Frame.methods!.loadStartup.call(state as never);
  expect(state.startupLoading).toBe(false);
  expect(state.startupError).toBe('');
});
