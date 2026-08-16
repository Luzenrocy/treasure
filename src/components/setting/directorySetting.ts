export interface DirectorySetting {
  param_key: string;
  param_value?: string;
  directory_display_name?: string;
  directory_status?: string;
}

export interface DirectoryGrant {
  resource_locator?: string;
  resource_display_name?: string;
}

/** Applies a directory picker result without clearing a previously displayed value. */
export function applySelectedDirectory(setting: DirectorySetting, selectedPath: string, grant?: DirectoryGrant): boolean {
  if (setting.param_key !== 'storage_dir') {
    setting.param_value = selectedPath;
    return true;
  }

  if (!grant?.resource_locator) return false;
  setting.param_value = grant.resource_locator;
  setting.directory_display_name = grant.resource_display_name;
  setting.directory_status = 'active';
  return true;
}
