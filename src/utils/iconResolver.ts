/**
 * 图标引用解析器
 *
 * 负责将图标引用字符串解析为可渲染的具体资源。
 * 支持三种格式：
 *   - 预设名（如 "Document"）
 *   - 相对路径（如 "assets/custom-icon.svg"）
 *   - 绝对 URL（如 "https://..."）
 *
 * 使用方式：
 *   import { resolveIconRef, normalizeIconPath } from '@/utils/iconResolver';
 */

import { PRESET_ICON_SET } from '@/constants/presetIcons';

/** 图片扩展名白名单 */
const IMAGE_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.ico', '.webp', '.gif']);

/**
 * 旧数据兼容映射：小写/蛇形图标名 → 标准预设图标名
 *
 * 历史原因：早期插件和菜单数据中，icon 字段以小写形式存储（如 'setting', 'plugin'）。
 * 新版使用 Element Plus 的 PascalCase 命名（如 'Setting', 'Plugin'）。
 * 此映射保证旧数据无需迁移即可正常显示。
 */
const LEGACY_ICON_ALIASES: Record<string, string> = {
  // 系统内置菜单图标
  'home': 'HomeFilled',
  'setting': 'Setting',
  'notebook': 'Notebook',
  'folder': 'Folder',
  'document': 'Document',
  // 常见别名补充
  'file': 'Document',
  'file-text': 'Document',
  'settings': 'Setting',
  'gear': 'Setting',
  'cog': 'Setting',
  'home-filled': 'HomeFilled',
  'folder-opened': 'FolderOpened',
  'picture': 'Picture',
  'image': 'Picture',
  'video': 'VideoPlay',
  'music': 'Headset',
  'audio': 'Headset',
  'chat': 'ChatLineSquare',
  'message': 'Message',
  'mail': 'Mail',
  'email': 'Mail',
  'lock': 'Lock',
  'unlock': 'Unlock',
  'key': 'Key',
  'shield': 'Shield',
  'search': 'Search',
  'filter': 'Filter',
  'star': 'Star',
  'star-filled': 'StarFilled',
  'timer': 'Timer',
  'alarm': 'AlarmClock',
  'clock': 'Clock',
  'calendar': 'Calendar',
  'user': 'User',
  'users': 'UserFilled',
  'avatar': 'Avatar',
  'link': 'Link',
  'share': 'Share',
  'download': 'Download',
  'upload': 'Upload',
  'refresh': 'Refresh',
  'edit': 'EditPen',
  'delete': 'Delete',
  'check': 'Check',
  'close': 'Close',
  'plus': 'Plus',
  'minus': 'Minus',
  'warning': 'WarningFilled',
  'info': 'InfoFilled',
  'question': 'QuestionFilled',
  'error': 'ErrorFilled',
  'success': 'SuccessFilled',
  'help': 'Help',
  'bell': 'Bell',
  'notification': 'Bell',
  'phone': 'Phone',
  'cellphone': 'Cellphone',
  'location': 'Location',
  'map': 'MapLocation',
  'pin': 'Pushpin',
  'flag': 'Flag',
  'trophy': 'Trophy',
  'medal': 'Medal',
  'rank': 'Rank',
  'list': 'List',
  'grid': 'Grid',
  'menu': 'Menu',
  'suitcase': 'Suitcase',
  'briefcase': 'Briefcase',
  'goods': 'Goods',
  'box': 'Box',
  'money': 'Money',
  'coin': 'Coin',
  'wallet': 'Wallet',
  'bank-card': 'BankCard',
  'discount': 'Discount',
  'ticket': 'Tickets',
  'data': 'DataAnalysis',
  'chart': 'Chart',
  'trend': 'TrendCharts',
  'pie': 'PieChart',
  'histogram': 'Histogram',
  'line': 'DataLine',
  'dashboard': 'DataBoard',
  'board': 'DataBoard',
  'camera': 'Camera',
  'video-camera': 'VideoCamera',
  'headset': 'Headset',
  'microphone': 'Microphone',
  'eye': 'Eye',
  'hide': 'Hide',
  'view': 'View',
  'aim': 'Aim',
  'printer': 'Printer',
  'keyboard': 'Keyboard',
  'laptop': 'Laptop',
  'basketball': 'Basketball',
  'football': 'Football',
  'baseball': 'Baseball',
  'brush': 'Brush',
  'magic': 'MagicStick',
  'scissor': 'Scissor',
  'first-aid': 'FirstAidKit',
  'first-aid-kit': 'FirstAidKit',
  'present': 'Present',
  'gift': 'Present',
  'ice-cream': 'IceCream',
  'food': 'Food',
  'dish': 'Dish',
  'knife-fork': 'KnifeFork',
  'chicken': 'Chicken',
  'apple': 'Apple',
  'cherry': 'Cherry',
  'watermelon': 'Watermelon',
  'grape': 'Grape',
  'orange': 'Orange',
  'lollipop': 'Lollipop',
  'cold-drink': 'ColdDrink',
  'milk-tea': 'MilkTea',
  'sugar': 'Sugar',
  'hamburger': 'Hamburger',
  'bowl': 'Bowl',
  'goblet': 'Goblet',
  'goat': 'Goat',
  'deer': 'Deer',
  'horse': 'Horse',
  'dog': 'Dog',
  'cat': 'Cat',
  'glasses': 'Glasses',
  'sunglasses': 'Sunglasses',
};

/** 图标引用解析结果类型 */
export type ResolvedIconType = 'preset' | 'url' | 'path';

export interface ResolvedIcon {
  /** 解析后的图标类型 */
  type: ResolvedIconType;
  /** 渲染所需的数据 */
  src: string;
  /** 原始引用字符串 */
  raw: string;
  /** 仅 path 类型使用：规范化后的相对路径 */
  normalizedPath?: string;
}

/**
 * 检查字符串是否为 URL
 * @param str 待检查字符串
 * @returns 是否为 URL
 */
export function isUrl(str: string): boolean {
  return /^https?:\/\//i.test(str.trim());
}

/**
 * 规范化图标路径
 *   - 去除前导 ./ （保留相对性）
 *   - 去除开头 / 以避免变成 plugin:// 下的绝对路径
 *   - 统一使用正斜杠
 *
 * @param path 原始路径
 * @returns 规范化后的路径
 */
export function normalizeIconPath(path: string): string {
  let normalized = path.replace(/\\/g, '/').trim();

  // 去除前导 / 和 ./ ，保持相对路径
  normalized = normalized.replace(/^\.\//, '').replace(/^\//, '');

  return normalized;
}

/**
 * 检查路径是否为有效的图片文件路径
 * @param path 路径字符串
 * @returns 是否为有效图片路径
 */
export function isValidImagePath(path: string): boolean {
  const ext = path.toLowerCase().split('.').pop() || '';
  return IMAGE_EXTENSIONS.has('.' + ext);
}

/**
 * 将旧数据小写/蛇形图标名转换为标准预设图标名
 *
 * 兼容策略：
 * 1. 先尝试精确匹配 PRESET_ICONS（PascalCase）
 * 2. 再尝试小写/蛇形别名映射
 * 3. 最后尝试将下划线/短横线转为 PascalCase 后匹配
 *
 * @param name 原始图标名
 * @returns 标准预设图标名，无法匹配则返回 null
 */
function resolveLegacyIconName(name: string): string | null {
  // 1. 已经是标准预设名
  if (PRESET_ICON_SET.has(name)) {
    return name;
  }

  const lower = name.toLowerCase();

  // 2. 查别名映射表
  const alias = LEGACY_ICON_ALIASES[lower];
  if (alias && PRESET_ICON_SET.has(alias)) {
    return alias;
  }

  // 3. 尝试将下划线/短横线分隔的蛇形名转为 PascalCase
  // 例：'folder_opened' → 'FolderOpened', 'picture-filled' → 'PictureFilled'
  const pascal = lower
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  if (PRESET_ICON_SET.has(pascal)) {
    return pascal;
  }

  return null;
}

/**
 * 解析图标引用字符串
 *
 * 解析规则（按优先级）：
 *   1. 空字符串 → 降级到默认图标（由调用方处理 fallback）
 *   2. 标准预设图标名（PascalCase）→ type = 'preset'
 *   3. 旧数据小写/蛇形图标名 → 映射为标准预设名 → type = 'preset'
 *   4. 绝对 URL → type = 'url'
 *   5. 相对路径 → type = 'path'，构建为 plugin:// URL
 *   6. 其他 → 降级（由调用方处理 fallback）
 *
 * @param iconRef 图标引用字符串
 * @param pluginCode 插件编码（用于构建 plugin:// URL）
 * @returns 解析结果；若 iconRef 为空或无法识别，返回 null
 */
export function resolveIconRef(iconRef: string): ResolvedIcon | null {
  if (!iconRef || typeof iconRef !== 'string') {
    return null;
  }

  const trimmed = iconRef.trim();

  // 1. 标准预设图标名
  if (PRESET_ICON_SET.has(trimmed)) {
    return {
      type: 'preset',
      src: trimmed,
      raw: trimmed,
    };
  }

  // 2. 旧数据兼容：小写/蛇形 → 标准预设名
  const legacyPreset = resolveLegacyIconName(trimmed);
  if (legacyPreset) {
    return {
      type: 'preset',
      src: legacyPreset,
      raw: trimmed,
    };
  }

  // 3. 绝对 URL
  if (isUrl(trimmed)) {
    return {
      type: 'url',
      src: trimmed,
      raw: trimmed,
    };
  }

  // 4. 相对路径
  const normalized = normalizeIconPath(trimmed);
  if (normalized && isValidImagePath(normalized)) {
    return {
      type: 'path',
      src: normalized,
      raw: trimmed,
      normalizedPath: normalized,
    };
  }

  // 5. 无法识别
  return null;
}

