import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('Startup recovery script is missing');

function startPlaceholder(options: { reloaded?: boolean; mounted?: boolean; windows?: boolean } = {}) {
  let timeout: (() => void) | undefined;
  let saved = options.reloaded ? '1' : null;
  const reload = vi.fn();
  const placeholder = { textContent: '', appendChild: vi.fn() };
  const button = { textContent: '', onclick: undefined as (() => void) | undefined };
  runInNewContext(script!, {
    navigator: { userAgent: options.windows === false ? 'Macintosh' : 'Windows' },
    sessionStorage: { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } },
    document: {
      getElementById: () => options.mounted ? null : placeholder,
      createElement: () => button,
    },
    window: { addEventListener: vi.fn(), setTimeout: (callback: () => void) => { timeout = callback; }, location: { reload } },
  });
  return { expire: () => timeout?.(), placeholder, button, reload };
}

describe('Windows startup placeholder recovery', () => {
  it('reloads once when the frontend never mounts', () => {
    const state = startPlaceholder();
    state.expire();
    expect(state.reload).toHaveBeenCalledOnce();
  });

  it('offers a retry after a failed automatic reload', () => {
    const state = startPlaceholder({ reloaded: true });
    state.expire();
    expect(state.placeholder.textContent).toContain('启动失败');
    state.button.onclick?.();
    expect(state.reload).toHaveBeenCalledOnce();
  });

  it('does not reload after the app mounts or on macOS', () => {
    const mounted = startPlaceholder({ mounted: true });
    const mac = startPlaceholder({ windows: false });
    mounted.expire();
    mac.expire();
    expect(mounted.reload).not.toHaveBeenCalled();
    expect(mac.reload).not.toHaveBeenCalled();
  });
});
