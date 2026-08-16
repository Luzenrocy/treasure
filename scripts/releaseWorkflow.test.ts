import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('2.1.0 release configuration', () => {
  it('keeps the frontend, Tauri, and Rust package versions in sync', () => {
    const packageVersion = JSON.parse(read('package.json')).version;
    const tauriVersion = JSON.parse(read('src-tauri/tauri.conf.json')).version;
    const cargoVersion = read('src-tauri/Cargo.toml').match(
      /^version\s*=\s*"([^"]+)"/m,
    )?.[1];
    const cargoLockVersion = read('src-tauri/Cargo.lock').match(
      /\[\[package\]\]\nname = "treasure"\nversion = "([^"]+)"/,
    )?.[1];

    expect(packageVersion).toBe('2.1.0');
    expect(tauriVersion).toBe(packageVersion);
    expect(cargoVersion).toBe(packageVersion);
    expect(cargoLockVersion).toBe(packageVersion);
  });

  it('publishes a zipped Windows x64 portable build beside the installers', () => {
    const workflow = read('.github/workflows/release.yml');

    expect(workflow).toContain('name: Package Windows portable build');
    expect(workflow).toContain("if: runner.os == 'Windows'");
    expect(workflow).toContain('src-tauri/target/release/treasure.exe');
    expect(workflow).toContain('Treasure_${version}_windows-x64_portable.zip');
    expect(workflow).toContain('Compress-Archive');
    expect(workflow).toContain('name: Upload Windows portable build');
    expect(workflow).toContain('gh release upload');
  });
});
