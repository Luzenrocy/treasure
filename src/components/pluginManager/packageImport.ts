export interface PackageDirectoryEntry {
  name: string;
  isDirectory: boolean;
}

export interface PackageFileSystem {
  exists(path: string): Promise<boolean>;
  readDir(path: string): Promise<PackageDirectoryEntry[]>;
}

export type PackageRootResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Normalizes either a directory package or a ZIP extraction directory to one
 * package root. A parent containing multiple packages is intentionally
 * rejected instead of choosing an arbitrary plugin.
 */
export async function findPluginPackageRoot(root: string, fs: PackageFileSystem): Promise<PackageRootResult> {
  if (await fs.exists(`${root}/manifest.json`)) return { ok: true, value: root };

  const entries = await fs.readDir(root);
  const candidates: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory && await fs.exists(`${root}/${entry.name}/manifest.json`)) {
      candidates.push(`${root}/${entry.name}`);
    }
  }

  return candidates.length === 1
    ? { ok: true, value: candidates[0] }
    : { ok: false, error: '请选择包含 manifest.json 的单个插件目录' };
}
