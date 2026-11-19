import { getVersion } from '@tauri-apps/api/app';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export class PlatformVersionError extends Error {}

export function isSemver(value: unknown): value is string {
  return typeof value === 'string' && SEMVER.test(value);
}

/** Compares stable semantic versions. Returns a positive value when `a` is newer than `b`. */
export function compareSemver(a: string, b: string): number {
  if (!isSemver(a) || !isSemver(b)) throw new PlatformVersionError('版本号必须采用 major.minor.patch 格式');
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function isMinimumPlatformVersionSatisfied(required: string | undefined | null, current: string): boolean {
  if (!required) return true;
  return compareSemver(current, required) >= 0;
}

export function platformVersionRequirementMessage(required: string, current: string): string {
  return `此插件需要 Treasure ${required} 或更高版本。\n当前版本：${current}。\n\n请先更新 Treasure，再继续安装此插件。`;
}

/** Reads the version embedded in the running Tauri application, never a build-time placeholder. */
export async function getCurrentPlatformVersion(): Promise<string> {
  const version = await getVersion();
  if (!isSemver(version)) throw new PlatformVersionError(`无法识别当前 Treasure 版本：${version || '未知版本'}`);
  return version;
}

export async function assertMinimumPlatformVersion(required: string | undefined | null): Promise<string> {
  const current = await getCurrentPlatformVersion();
  if (!required) return current;
  if (!isSemver(required)) throw new PlatformVersionError(`插件最低平台版本无效：${String(required)}`);
  if (!isMinimumPlatformVersionSatisfied(required, current)) {
    throw new PlatformVersionError(platformVersionRequirementMessage(required, current));
  }
  return current;
}
