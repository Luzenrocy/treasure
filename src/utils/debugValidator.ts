export function validateDebugUrl(url: string): { valid: boolean; error?: string } {
    try {
        const parsed = new URL(url);

        if (parsed.protocol !== 'http:') {
            return { valid: false, error: '仅允许 http 协议' };
        }

        const allowedHosts = ['localhost', '127.0.0.1', '[::1]'];
        if (!allowedHosts.includes(parsed.hostname)) {
            return { valid: false, error: '仅允许 localhost/127.0.0.1/[::1] 地址' };
        }

        const port = parseInt(parsed.port);
        if (isNaN(port) || port < 1024 || port > 65535) {
            return { valid: false, error: '端口范围必须为 1024-65535' };
        }

        if (parsed.pathname.includes('..')) {
            return { valid: false, error: '路径不允许包含 ..' };
        }

        return { valid: true };
    } catch {
        return { valid: false, error: 'URL 格式无效' };
    }
}
