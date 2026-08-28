export interface DebugIconDownloadTarget {
  relativePath: string;
  sourceUrl: string;
}

const PRESET_ICON_PATTERN = /^[A-Z][a-zA-Z0-9]*$/;

function normalizeRelativeIconPath(iconRef: string): string | null {
  const trimmed = iconRef.trim();
  if (!trimmed || PRESET_ICON_PATTERN.test(trimmed)) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error('调试插件图标必须使用相对路径或预设图标名');
  }

  const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
  if (!normalized || normalized.split('/').includes('..')) {
    throw new Error('图标路径不能包含 ".."');
  }

  return normalized;
}

/** Builds the local icon download plan used by debug registration and manifest synchronization. */
export function buildDebugIconDownloadPlan(manifest: any, debugUrl: string): DebugIconDownloadTarget[] {
  const baseUrl = new URL(`${debugUrl.replace(/\/+$/, '')}/`);
  const refs = [manifest?.icon, manifest?.menu?.icon];
  const targets: DebugIconDownloadTarget[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    if (typeof ref !== 'string') continue;
    const relativePath = normalizeRelativeIconPath(ref);
    if (!relativePath || seen.has(relativePath)) continue;
    seen.add(relativePath);
    targets.push({ relativePath, sourceUrl: new URL(relativePath, baseUrl).toString() });
  }

  return targets;
}
