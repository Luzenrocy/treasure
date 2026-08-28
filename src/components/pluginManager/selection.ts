/** Returns a new selected-id list, allowing Vue to render from one source of truth. */
export function toggleSelectedPluginId(selectedIds: number[], pluginId: number): number[] {
  return selectedIds.includes(pluginId)
    ? selectedIds.filter(id => id !== pluginId)
    : [...selectedIds, pluginId];
}

/** Removes a plugin after a successful individual deletion. */
export function removeSelectedPluginId(selectedIds: number[], pluginId: number): number[] {
  return selectedIds.filter(id => id !== pluginId);
}

/** Removes stale selections after the plugin list has been refreshed. */
export function retainExistingPluginIds(selectedIds: number[], existingIds: number[]): number[] {
  const existing = new Set(existingIds);
  return [...new Set(selectedIds)].filter(id => existing.has(id));
}
