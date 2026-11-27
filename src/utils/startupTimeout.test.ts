import { afterEach, describe, expect, it, vi } from 'vitest';
import { withStartupTimeout } from './startupTimeout';

afterEach(() => vi.useRealTimers());

describe('startup timeout', () => {
  it('returns a completed initialization result', async () => {
    vi.useFakeTimers();
    await expect(withStartupTimeout(Promise.resolve('ready'))).resolves.toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows the startup screen to report a stalled initialization', async () => {
    vi.useFakeTimers();
    const result = withStartupTimeout(new Promise(() => {}), 1000);
    const assertion = expect(result).rejects.toThrow('初始化超时，请重试');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});
