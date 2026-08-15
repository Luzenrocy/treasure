import { describe, expect, it } from 'vitest';
import { FileGrantService, isPathWithinGrantedRoot } from './fileGrants';

describe('FileGrantService', () => {
  it('accepts a root and its descendants but rejects prefix collisions and traversal', () => {
    expect(isPathWithinGrantedRoot('/tmp/notes', '/tmp/notes')).toBe(true);
    expect(isPathWithinGrantedRoot('/tmp/notes/.assets/index.json', '/tmp/notes')).toBe(true);
    expect(isPathWithinGrantedRoot('/tmp/notes-other/file.md', '/tmp/notes')).toBe(false);
    expect(isPathWithinGrantedRoot('/tmp/notes/../secret.txt', '/tmp/notes')).toBe(false);
  });

  it('resolves a file only for the plugin that received the grant', () => {
    const grants = new FileGrantService();
    const file = grants.grantFile('plugin-a', '/tmp/example.txt');

    expect(grants.resolveFile('plugin-a', file.id)).toEqual('/tmp/example.txt');
    expect(grants.resolveFile('plugin-b', file.id)).toBeUndefined();
  });

  it('rejects path traversal in a requested output file name', () => {
    const grants = new FileGrantService();
    const directory = grants.grantDirectory('plugin-a', '/tmp/exports');

    expect(grants.resolveOutputPath('plugin-a', directory.id, '../secret.txt')).toBeUndefined();
    expect(grants.resolveOutputPath('plugin-a', directory.id, 'report.txt')).toBe('/tmp/exports/report.txt');
    expect(grants.resolveOutputPath('plugin-a', directory.id, '.')).toBeUndefined();
    expect(grants.resolveOutputPath('plugin-a', directory.id, 'nested/report.txt')).toBeUndefined();
  });

  it('resolves a safe relative key inside plugin storage only', () => {
    expect(FileGrantService.resolveStoragePath('/tmp/plugin/data', 'attachments/a.txt')).toBe('/tmp/plugin/data/attachments/a.txt');
    expect(FileGrantService.resolveStoragePath('/tmp/plugin/data', '../a.txt')).toBeUndefined();
  });

  it('rejects empty, absolute and empty-segment private keys', () => {
    expect(FileGrantService.resolveStoragePath('/tmp/plugin/data/', '')).toBeUndefined();
    expect(FileGrantService.resolveStoragePath('/tmp/plugin/data', '/secret.txt')).toBeUndefined();
    expect(FileGrantService.resolveStoragePath('/tmp/plugin/data', 'attachments//a.txt')).toBeUndefined();
  });

  it('keeps directory grants plugin-scoped and revocable', () => {
    const grants = new FileGrantService();
    const directory = grants.grantDirectory('plugin-a', '/tmp/导出');
    expect(grants.resolveDirectory('plugin-b', directory.id)).toBeUndefined();
    expect(grants.revokeDirectory('plugin-b', directory.id)).toBe(false);
    expect(grants.revokeDirectory('plugin-a', directory.id)).toBe(true);
    expect(grants.resolveDirectory('plugin-a', directory.id)).toBeUndefined();
  });

  it('reuses an identical directory grant but never conflates another plugin or path', () => {
    const grants = new FileGrantService();
    const first = grants.grantDirectory('plugin-a', '/tmp/exports');
    expect(grants.grantDirectory('plugin-a', '/tmp/exports').id).toBe(first.id);
    expect(grants.grantDirectory('plugin-b', '/tmp/exports').id).not.toBe(first.id);
    expect(grants.grantDirectory('plugin-a', '/tmp/other').id).not.toBe(first.id);
    expect(grants.resolveOutputPath('plugin-a', 'missing', 'x.txt')).toBeUndefined();
    expect(grants.grantFile('plugin-a', '').name).toBe('');
  });

  it('derives a hidden child directory from its authorized root without making it a second persistent grant', () => {
    const grants = new FileGrantService();
    const root = grants.grantDirectory('plugin-a', '/tmp/notes');
    const assets = grants.grantDirectory('plugin-a', '/tmp/notes/.assets', root.id);

    expect(grants.getDirectoryGrant('plugin-a', assets.id)).toMatchObject({
      path: '/tmp/notes/.assets',
      rootGrantId: root.id,
    });
    expect(grants.getDirectoryGrant('plugin-b', assets.id)).toBeUndefined();
  });

  it('restores a persisted root reference without treating browser storage as an authority', () => {
    const grants = new FileGrantService();
    grants.restoreDirectory('plugin-a', 'root-grant', '/tmp/资料', '资料');
    expect(grants.getDirectoryGrant('plugin-a', 'root-grant')).toMatchObject({
      path: '/tmp/资料', rootGrantId: 'root-grant',
    });
  });

});
