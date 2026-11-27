import { beforeEach, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
});

it('shares one migration across concurrent startup callers', async () => {
    let finish!: (result: { code: number; version: number }) => void;
    invoke.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { runInitOrUpgrade } = await import('./initOrUpgrade');
    const { awaitReady } = await import('./dbClient');

    const initialization = runInitOrUpgrade();
    const menuReadiness = awaitReady();
    expect(invoke).toHaveBeenCalledTimes(1);
    finish({ code: 1, version: 10 });

    expect((await initialization).code).toBe(1);
    expect((await menuReadiness).code).toBe(1);
    await awaitReady();
    expect(invoke).toHaveBeenCalledTimes(1);
});

it('allows a migration to be retried after a failure', async () => {
    invoke.mockRejectedValueOnce(new Error('database busy'));
    invoke.mockResolvedValueOnce({ code: 1, version: 10 });
    const { awaitReady } = await import('./dbClient');

    expect((await awaitReady()).code).not.toBe(1);
    expect((await awaitReady()).code).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(2);
});
