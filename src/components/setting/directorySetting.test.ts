import { describe, expect, it } from 'vitest';
import { applySelectedDirectory } from './directorySetting';

describe('applySelectedDirectory', () => {
  it('immediately replaces the visible storage directory with the granted directory path', () => {
    const setting = {
      param_key: 'storage_dir',
      param_value: '/old/location',
      directory_display_name: 'location',
      directory_status: 'active',
    };

    const applied = applySelectedDirectory(setting, '/new/location', {
      resource_locator: '/new/location',
      resource_display_name: 'new-location',
    });

    expect(applied).toBe(true);
    expect(setting).toMatchObject({
      param_value: '/new/location',
      directory_display_name: 'new-location',
      directory_status: 'active',
    });
  });

  it('keeps the current visible path when a storage-directory binding has no path', () => {
    const setting = { param_key: 'storage_dir', param_value: '/old/location' };

    const applied = applySelectedDirectory(setting, '/new/location', {});

    expect(applied).toBe(false);
    expect(setting.param_value).toBe('/old/location');
  });

  it('uses the chosen path directly for other directory settings', () => {
    const setting = { param_key: 'export_dir', param_value: '/old/export' };

    expect(applySelectedDirectory(setting, '/new/export')).toBe(true);
    expect(setting.param_value).toBe('/new/export');
  });
});
