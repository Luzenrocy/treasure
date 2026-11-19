import { describe, expect, it } from 'vitest';
import { compareSemver, isMinimumPlatformVersionSatisfied, isSemver } from './platformVersion';

describe('platform version compatibility', () => {
  it('compares all three semantic-version components', () => {
    expect(compareSemver('2.2.0', '2.3.0')).toBeLessThan(0);
    expect(compareSemver('2.10.0', '2.3.0')).toBeGreaterThan(0);
    expect(compareSemver('2.3.0', '2.3.0')).toBe(0);
  });

  it('rejects a plugin that requires a newer Treasure client', () => {
    expect(isMinimumPlatformVersionSatisfied('2.3.0', '2.2.0')).toBe(false);
    expect(isMinimumPlatformVersionSatisfied('2.3.0', '2.3.0')).toBe(true);
    expect(isMinimumPlatformVersionSatisfied(undefined, '2.2.0')).toBe(true);
  });

  it('only accepts stable semantic-version values', () => {
    expect(isSemver('2.3.0')).toBe(true);
    expect(isSemver('2.3')).toBe(false);
    expect(isSemver('v2.3.0')).toBe(false);
  });
});
