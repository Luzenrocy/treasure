export interface FileGrant {
  id: string;
  name: string;
  kind: 'file';
}

export interface DirectoryGrant {
  id: string;
  name: string;
  kind: 'directory';
}

export interface GrantRecord {
  pluginCode: string;
  path: string;
  kind: 'file' | 'directory';
  access?: 'read' | 'write';
  /** Present only when this reference descends from a durable access grant. */
  rootGrantId?: string;
}

/** Lexical containment guard for host-issued references. Symlink resolution
 * remains the native filesystem boundary's responsibility. */
export function isPathWithinGrantedRoot(targetPath: string, rootPath: string): boolean {
  const target = normalizePath(targetPath);
  const root = normalizePath(rootPath);
  return target === root || target.startsWith(`${root}/`);
}

/**
 * Keeps host-side paths out of the plugin message protocol. A reference only
 * resolves for the plugin that received it from a system dialog or storage.
 */
export class FileGrantService {
  private sequence = 0;
  private readonly grants = new Map<string, GrantRecord>();

  grantFile(pluginCode: string, path: string, rootGrantId?: string): FileGrant {
    return this.grant(pluginCode, path, 'file', 'read', rootGrantId) as FileGrant;
  }

  /** Grants a path returned by the native Save dialog. It is write-only until written. */
  grantWritableFile(pluginCode: string, path: string): FileGrant {
    return this.grant(pluginCode, path, 'file', 'write') as FileGrant;
  }

  grantDirectory(pluginCode: string, path: string, rootGrantId?: string): DirectoryGrant {
    const existing = Array.from(this.grants.entries()).find(([, record]) => record.pluginCode === pluginCode && record.kind === 'directory' && record.path === path);
    if (existing) return { id: existing[0], name: baseName(path), kind: 'directory' };
    const grant = this.grant(pluginCode, path, 'directory', undefined, rootGrantId) as DirectoryGrant;
    return grant;
  }

  /** Issues a fresh, session-scoped reference for a durable authorization. */
  issueDirectoryReference(pluginCode: string, path: string, rootGrantId: string): DirectoryGrant {
    return this.grant(pluginCode, path, 'directory', undefined, rootGrantId) as DirectoryGrant;
  }

  /** Restores a host-persisted access grant after an application restart. */
  restoreDirectory(pluginCode: string, id: string, path: string, name: string): DirectoryGrant {
    this.grants.set(id, { pluginCode, path, kind: 'directory', rootGrantId: id });
    this.advanceSequence(id);
    return { id, name, kind: 'directory' };
  }

  getDirectoryGrant(pluginCode: string, id: string): Readonly<GrantRecord> | undefined {
    const record = this.grants.get(id);
    return record?.pluginCode === pluginCode && record.kind === 'directory' ? record : undefined;
  }

  getFileGrant(pluginCode: string, id: string): Readonly<GrantRecord> | undefined {
    const record = this.grants.get(id);
    return record?.pluginCode === pluginCode && record.kind === 'file' ? record : undefined;
  }

  getDirectoryPath(pluginCode: string, id: string): string | undefined { return this.resolveDirectory(pluginCode, id); }

  resolveFile(pluginCode: string, id: string): string | undefined {
    return this.resolve(pluginCode, id, 'file', 'read');
  }

  resolveWritableFile(pluginCode: string, id: string): string | undefined {
    return this.resolve(pluginCode, id, 'file', 'write');
  }

  resolveDirectory(pluginCode: string, id: string): string | undefined {
    return this.resolve(pluginCode, id, 'directory');
  }

  revokeDirectory(pluginCode: string, id: string): boolean {
    const path = this.resolveDirectory(pluginCode, id);
    if (!path) return false;
    this.grants.delete(id);
    return true;
  }

  revokeRootGrant(pluginCode: string, rootGrantId: string): void {
    for (const [id, record] of this.grants) {
      if (record.pluginCode === pluginCode && (id === rootGrantId || record.rootGrantId === rootGrantId)) this.grants.delete(id);
    }
  }

  resolveOutputPath(pluginCode: string, directoryId: string, fileName: string): string | undefined {
    if (!isPlainFileName(fileName)) return undefined;
    const directory = this.resolveDirectory(pluginCode, directoryId);
    return directory ? joinPath(directory, fileName) : undefined;
  }

  static resolveStoragePath(storageDirectory: string, key: string): string | undefined {
    if (!key || key.startsWith('/') || key.startsWith('\\') || key.split(/[\\/]/).some(part => part === '..' || part === '')) return undefined;
    return `${storageDirectory.replace(/[\\/]+$/, '')}/${key}`;
  }

  private grant(pluginCode: string, path: string, kind: GrantRecord['kind'], access?: GrantRecord['access'], rootGrantId?: string): FileGrant | DirectoryGrant {
    const id = `file-grant-${++this.sequence}`;
    // A reference returned directly by a system dialog is valid for this
    // bridge session without being durable. Durable authorization is attached
    // only by permissions.grantDirectory / restoreDirectory.
    this.grants.set(id, { pluginCode, path, kind, access, rootGrantId });
    return { id, name: baseName(path), kind } as FileGrant | DirectoryGrant;
  }

  private advanceSequence(id: string) {
    const sequence = Number(id.replace('file-grant-', ''));
    if (Number.isFinite(sequence)) this.sequence = Math.max(this.sequence, sequence);
  }

  private resolve(pluginCode: string, id: string, kind: GrantRecord['kind'], access?: GrantRecord['access']): string | undefined {
    const record = this.grants.get(id);
    return record?.pluginCode === pluginCode && record.kind === kind && (!access || record.access === access) ? record.path : undefined;
  }
}

function isPlainFileName(value: string): boolean {
  return Boolean(value)
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\');
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function joinPath(directory: string, fileName: string): string {
  return `${directory.replace(/[\\/]+$/, '')}/${fileName}`;
}

function normalizePath(path: string): string {
  const unified = path.replace(/\\/g, '/');
  const prefix = unified.match(/^[A-Za-z]:/)?.[0] || (unified.startsWith('/') ? '/' : '');
  const parts: string[] = [];
  for (const part of unified.slice(prefix.length).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { parts.pop(); continue; }
    parts.push(part);
  }
  return `${prefix}${parts.join('/')}`.replace(/\/$/, '') || prefix;
}
