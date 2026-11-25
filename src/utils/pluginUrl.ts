/**
 * Builds the URL for an installed plugin served by Tauri's custom protocol.
 *
 * Tauri maps custom protocols to a localhost HTTP origin in WebView2, while
 * WKWebView uses the protocol name directly. Keeping this decision here makes
 * the iframe URL and the bridge's origin checks use the same contract.
 */
export function isWindowsUserAgent(userAgent: string): boolean {
  return /Windows/i.test(userAgent);
}

export function installedPluginUrl(
  relativePath: string,
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): string {
  const path = relativePath.replace(/^\/+/, '');
  if (!path || path.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new Error('插件入口路径无效');
  }

  return isWindowsUserAgent(userAgent)
    ? `http://plugin.localhost/${path}`
    : `plugin://localhost/${path}`;
}

export function isInstalledPluginUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return (url.protocol === 'plugin:' && url.hostname === 'localhost')
      || (url.protocol === 'http:' && url.hostname === 'plugin.localhost');
  } catch {
    return false;
  }
}

export function isInstalledPluginOrigin(origin: string | null): boolean {
  return origin === 'plugin://localhost' || origin === 'http://plugin.localhost';
}
