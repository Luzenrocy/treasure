# Treasure SDK — 插件开发文档

> 面向 **Treasure 插件开发者**。本文档描述如何开发一个 Treasure 插件，包括 SDK 的使用方法、API 参考、调试技巧和最佳实践。

---

## 一、快速开始

### 1.1 使用模板创建插件

```bash
# 克隆插件模板
cp -r plugin/treasure-plugin my-plugin
cd my-plugin

# 安装依赖
npm install

# 注意：SDK 源码位于宿主仓库 packages/treasure-sdk/ 下
# 当前通过 @sdk alias 指向 packages/treasure-sdk/src
# 后续将发布为独立 npm 包 @treasure/sdk

# 启动开发服务器
npm run dev
```

### 1.2 初始化 SDK

在插件入口 `src/main.ts` 中：

```typescript
import { createApp } from 'vue';
import { initTreasure } from '@sdk/treasure';   // 当前开发方式（vite alias）
// import { initTreasure } from '@treasure/sdk'; // 未来改用 npm 包
import App from './App.vue';

const app = createApp(App);
initTreasure();              // 必须在 app.mount() 之前调用
app.mount('#app');
```

> **导入路径说明**：当前插件的 `vite.config.ts` 中配置了 `@sdk` alias 指向 `packages/treasure-sdk/src`，因此 `@sdk/treasure` 解析到共享 SDK 源码。SDK 发布为 npm 包后改为 `@treasure/sdk`，无需本地 alias。

`initTreasure()` 会自动检测运行环境：
- **生产环境**（在 Treasure 宿主的 iframe 中）：使用 `ProductionBridge`，通过 `postMessage` 与宿主通信
- **开发环境**（独立浏览器）：使用 `DevBridge`，基于 `localStorage` + `sql.js` 模拟宿主功能

### 1.3 在两个文件中声明插件编码

插件编码在 **两个地方** 声明，必须保持一致：

```html
<!-- index.html -->
<meta name="treasure-plugin-code" content="my-plugin" />
```

```json
// manifest.json
{
  "name": "my-plugin",   // 插件编码，与 meta 标签一致
  "alias": "我的插件",
  "version": "1.0.0"
}
```

---

## 二、API 参考

### 2.1 文件系统操作

```typescript
import { file } from '@sdk/treasure';   // 当前
// import { file } from '@treasure/sdk'; // 未来

// 读取文本文件
const res = await file.readFile('/path/to/file.txt');
// { code: 1, data: "文件内容" }

// 读取目录
const res = await file.readDir('/path/to/dir');
// { code: 1, data: [{ name: 'a.txt', path: '/path/to/dir/a.txt', isDirectory: false, isFile: true }] }

// 读取二进制文件（返回 base64）
const res = await file.readBinaryFile('/path/to/image.png');
// { code: 1, data: "iVBORw0KGgo..." }

// 写入二进制文件（传入 base64）
await file.writeBinaryFile('/path/to/output.png', base64String);

// 创建文件
await file.createFile('/path/to/new.txt', '文件内容');

// 更新文件
await file.updateFile('/path/to/existing.txt', '新内容');

// 创建目录
await file.createDir('/path/to/new/dir', { recursive: true });

// 删除文件
await file.deleteFile('/path/to/file.txt');

// 删除目录
await file.deleteDir('/path/to/dir', { recursive: true });
```

**返回值格式（`TreasureResponse`）**：
```typescript
interface TreasureResponse<T = unknown> {
  code: number;      // 1=成功, 0=错误
  msg?: string;      // 错误消息
  data?: T;          // 响应数据
}
```

### 2.2 SQL 数据库操作

```typescript
import { getTreasure } from '@sdk/treasure';   // 当前
// import { getTreasure } from '@treasure/sdk'; // 未来

const bridge = getTreasure();

// 查询数据
const res = await bridge.query(
  'SELECT * FROM notes WHERE status = ? ORDER BY updated_at DESC',
  ['notes'],           // 声明的表名列表
  ['active']           // SQL 参数
);
// Response { code: 1, data: [{ id: 1, title: '...' }] }

// 执行写操作
await bridge.execute(
  'INSERT INTO notes (title, content) VALUES (?, ?)',
  ['notes'],
  ['标题', '内容']
);

// 事务
await bridge.transaction([
  { sql: 'INSERT INTO notes (title) VALUES (?)', tables: ['notes'], params: ['标题'] },
  { sql: 'UPDATE notes SET status = ? WHERE id = ?', tables: ['notes'], params: ['done', 1] },
]);
```

**重要规则**：
- `tables` 参数必须声明本次 SQL 涉及的所有表名
- 表名不要加前缀，宿自动重写为 `plugin_{你的插件编码}_{表名}`
- 禁止操作平台表（如 `tp_plugin`, `tp_setting` 等）
- 禁止执行 `DROP TABLE`、`ALTER TABLE`、`RENAME TABLE`
- 仅允许创建自己的表（`CREATE TABLE`）

### 2.3 配置管理

```typescript
import { setting } from '@sdk/treasure';   // 当前
// import { setting } from '@treasure/sdk'; // 未来

// 获取所有配置
const res = await setting.getSettings();
// { code: 1, data: [{ id: 1, param_key: 'storage_dir', param_value: '/path' }] }

// 保存配置
await setting.saveSettings([{ id: 1, param_value: '/new/path' }]);

// 按 key 获取配置
const res = await setting.getByKey('storage_dir');
// { code: 1, data: { param_key: 'storage_dir', param_value: '/path' } }

// 按 key 保存配置
await setting.saveByKey('storage_dir', '/new/path');
```

### 2.4 系统对话框

```typescript
import { getTreasure } from '@sdk/treasure';   // 当前
// import { getTreasure } from '@treasure/sdk'; // 未来

const bridge = getTreasure();

// 选择目录
const dirPath = await bridge.selectDirectory('请选择存储目录');
// "/Users/xxx/Documents" 或 null（取消）

// 保存文件对话框（部分插件可用）
const filePath = await bridge.saveDialog!({
  defaultPath: 'output.md',
  filters: [{ name: 'Markdown', extensions: ['md'] }]
});
// "/Users/xxx/output.md" 或 null（取消）
```

### 2.5 原生菜单

```typescript
import { getTreasure } from '@sdk/treasure';   // 当前
// import { getTreasure } from '@treasure/sdk'; // 未来

const bridge = getTreasure();

// 注册菜单（通常放在 mounted 中）
await bridge.request!('registerMenu', {
  reg: {
    menuId: 'my-menu',
    rootLabel: 'View',                   // 挂载到系统菜单名称
    submenuLabel: 'My Plugin',           // 子菜单名称
    items: [
      { id: 'toggle', label: '切换模式', type: 'check', checked: false },
      { id: 'export', label: '导出...',   type: 'normal' },
      { id: '',       label: '',          type: 'separator' },
    ],
  },
});

// 监听菜单事件
window.addEventListener('message', (event) => {
  if (event.data?.type === 'treasure-menu-event') {
    const { menuId, itemId } = event.data;
    if (itemId === 'toggle') { /* 切换状态 */ }
  }
});

// 更新菜单项勾选状态
await bridge.request!('updateMenuState', {
  menuId: 'my-menu',
  itemId: 'toggle',
  checked: true,
});

// 注销菜单（通常放在 beforeUnmount 中）
await bridge.request!('unregisterMenu', { menuId: 'my-menu' });
```

---

## 三、manifest.json 配置

```json
{
  "name": "my-plugin",               // 插件编码（kebab-case），也是表名前缀
  "alias": "我的插件",                // 插件显示名称
  "version": "1.0.0",                // semver 版本号
  "description": "插件功能描述",
  "author": "作者名",
  "icon": "icon.svg",                // 插件图标（放在 public/ 下）
  "entry": "index.html",             // 入口文件（固定）
  "minPlatformVersion": "2.0.0",     // 最低宿主版本
  "menu": {
    "name": "我的插件",               // 侧边栏菜单名称
    "icon": "Notebook",              // Element Plus 图标名
    "order": 1                       // 排序（越小越靠前）
  },
  "settings": [
    {
      "param_key": "storage_dir",
      "param_name": "文件存储目录",
      "param_type": "dir",           // input | switch | dir | select | checkbox | radio
      "param_value": "",
      "param_placeholder": "请选择目录"
    }
  ],
  "tables": [
    {
      "name": "notes",               // 裸表名（宿主自动加前缀）
      "comment": "笔记表",
      "columns": [
        { "name": "id", "type": "INTEGER", "options": { "primaryKey": true, "notNull": true } },
        { "name": "title", "type": "TEXT", "comment": "标题" },
        { "name": "content", "type": "TEXT", "comment": "内容" },
        { "name": "status", "type": "TEXT", "default": "active" }
      ]
    }
  ]
}
```

### 3.1 图标配置

`manifest.json` 中支持两种图标配置：

```json
{
  "icon": "assets/my-icon.svg",          // 插件图标（插件中心卡片展示）
  "menu": {
    "name": "我的插件",
    "icon": "Notebook",                  // 侧边栏菜单图标
    "order": 1
  }
}
```

图标值支持三种格式：

| 格式 | 示例 | 说明 |
|------|------|------|
| 预设图标名 | `"Document"` | 使用 Element Plus 内置图标，无需提供文件 |
| 相对路径 | `"assets/my-icon.svg"` | 插件包内的自定义图标文件，放在 `public/` 目录下 |
| 外部 URL | `"https://example.com/icon.png"` | 远程图标资源（谨慎使用） |

> **注意**：自定义图标文件需放在插件项目的 `public/` 目录下，构建时会自动复制到插件包中。推荐使用 SVG 格式，尺寸建议 64x64。

### 3.2 可用预设图标

以下图标可直接在 `manifest.json` 的 `icon` 和 `menu.icon` 中使用，无需提供文件：

> **图标来源**：[Element Plus Icons](https://element-plus.org/zh-CN/component/icon.html)

**基础操作**：`HomeFilled`, `Setting`, `Document`, `FolderOpened`, `Folder`, `Files`, `DocumentFilled`, `Menu`, `Grid`, `List`, `Rank`, `Suitcase`, `Briefcase`, `Goods`, `Box`

**编辑**：`EditPen`, `Delete`, `Check`, `Close`, `Refresh`, `RefreshLeft`, `RefreshRight`, `Search`, `Select`, `CircleCheck`, `CircleCheckFilled`, `CircleClose`, `CircleCloseFilled`, `SuccessFilled`, `ErrorFilled`, `WarningFilled`, `InfoFilled`, `QuestionFilled`

**导航**：`ArrowLeft`, `ArrowRight`, `ArrowDown`, `ArrowUp`, `ArrowUpBold`, `ArrowDownBold`, `DArrowLeft`, `DArrowRight`, `CaretLeft`, `CaretRight`, `CaretBottom`, `CaretTop`, `Expand`, `Fold`, `Back`, `Top`, `Bottom`, `Sort`, `SortUp`, `SortDown`

**数据/分析**：`DataAnalysis`, `TrendCharts`, `PieChart`, `Histogram`, `DataLine`, `DataBoard`, `Chart`, `Opportunity`, `Cpu`, `Monitor`, `Mobike`, `Shop`, `ShoppingBag`, `ShoppingCart`, `ShoppingCartFull`, `Tickets`, `Money`, `Coin`, `Wallet`, `BankCard`, `Discount`

**媒体**：`Picture`, `PictureFilled`, `PictureRounded`, `VideoPlay`, `VideoPause`, `Headset`, `Microphone`, `Camera`, `CameraFilled`, `VideoCamera`, `VideoCameraFilled`

**通讯**：`ChatLineSquare`, `ChatDotSquare`, `ChatSquare`, `Message`, `Mail`, `Phone`, `Cellphone`, `Connection`, `Link`, `Share`, `Upload`, `Download`, `Position`, `Location`, `LocationFilled`, `MapLocation`

**安全**：`Lock`, `Unlock`, `Key`, `Shield`, `ShieldCheck`, `Aim`, `Eye`, `EyeFilled`, `Hide`, `View`

**工具**：`Filter`, `Star`, `StarFilled`, `Timer`, `AlarmClock`, `Clock`, `Calendar`, `CalendarFilled`, `Date`, `TakeawayBox`, `RemoveFilled`, `CirclePlusFilled`, `Plus`, `Minus`, `CirclePlus`, `CircleMinus`, `Pointer`, `Laptop`, `Keyboard`, `Printer`, `Scissor`, `MagicStick`, `Brush`, `Basketball`, `Football`, `Baseball`, `Trophy`, `Medal`, `Flag`, `Guide`, `Help`, `Bell`, `BellFilled`, `MessageFilled`, `ChatDotRound`, `ChatLineRound`, `PhoneFilled`, `Mouse`, `SemiSelect`, `DocumentAdd`, `DocumentDelete`, `DocumentChecked`, `Reading`, `ReadingLamp`, `Notebook`, `Stamp`, `Management`, `Postcard`, `Messages`, `ChatRound`, `ChatRoundFilled`, `Paperclip`, `Pushpin`, `PushpinFilled`, `Place`, `FirstAidKit`, `FirstAidKitFilled`, `Van`, `Car`, `Bicycle`, `Ship`, `Train`, `Plane`, `Present`, `PresentFilled`, `IceCream`, `IceCreamFilled`, `IceTea`, `IceTeaFilled`, `Food`, `FoodFilled`, `Dish`, `DishDot`, `KnifeFork`, `Chicken`, `Apple`, `Cherry`, `Watermelon`, `Grape`, `Orange`, `Lollipop`, `IceCreamSquare`, `IceCreamRound`, `ColdDrink`, `MilkTea`, `Sugar`, `Hamburger`, `Tableware`, `Bowl`, `Goblet`, `GobletFull`, `Goat`, `Deer`, `Horse`, `Dog`, `Cat`, `SGlasses`, `Glasses`, `Sunglasses`

> **提示**：以上图标基于 Element Plus Icons，如需使用其他图标，请提供自定义图标文件。

### 3.3 自定义图标规范

当预设图标无法满足需求时，可以提供自定义图标文件。

#### 文件要求

| 项目 | 要求 |
|------|------|
| **推荐格式** | SVG（矢量，无损缩放） |
| **支持格式** | SVG, PNG, JPG, ICO, WEBP, GIF |
| **建议尺寸** | 64x64 或 128x128 像素 |
| **文件大小** | 建议 < 50KB |
| **viewBox** | 统一使用 `0 0 1024 1024` |
| **填充色** | 使用 `currentColor` 或 `#000000`，由宿主控制实际颜色 |

#### 文件放置

将图标文件放在插件项目的 `public/` 目录下：

```
my-plugin/
├── public/
│   ├── icon.svg              # 默认图标（保持兼容）
│   └── assets/
│       ├── menu-icon.svg     # 菜单自定义图标
│       └── card-icon.svg     # 卡片自定义图标
├── manifest.json
└── ...
```

构建时 `public/` 目录会被完整复制到插件包中。

#### manifest.json 引用

```json
{
  "icon": "assets/card-icon.svg",
  "menu": {
    "name": "我的插件",
    "icon": "assets/menu-icon.svg",
    "order": 1
  }
}
```

#### 注意事项

**推荐做法**：
- ✅ 使用 SVG 格式，保证缩放清晰
- ✅ 使用 `currentColor` 作为填充色，自动适配主题
- ✅ 保持 viewBox 为 `0 0 1024 1024`
- ✅ 文件命名使用 kebab-case（如 `my-icon.svg`）

**禁止做法**：
- ❌ 不要内联 `width` 和 `height` 固定尺寸
- ❌ 不要使用外部 CSS 或 JavaScript
- ❌ 不要使用 `..` 路径遍历
- ❌ 不要使用绝对路径（如 `/assets/icon.svg`）

#### 常见问题

**Q: 自定义图标不显示？**
A: 请检查：
1. 文件是否放在 `public/` 目录下
2. `manifest.json` 中的路径是否正确
3. 文件扩展名是否为支持的图片格式

**Q: 图标颜色异常？**
A: SVG 图标应使用 `fill="currentColor"` 或 `fill="#000000"`，避免硬编码颜色值。

**Q: 图标尺寸不一致？**
A: 移除 SVG 中的 `width` 和 `height` 属性，只保留 `viewBox`。

---

## 四、调试指南

### 4.1 开发模式（浏览器）

在浏览器中直接打开 `http://localhost:5173`，SDK 自动使用 `DevBridge`：

```
DevBridge 数据存储策略：
├── 数据库 → localStorage['treasure_dev_db']（sql.js WASM 序列化）
├── 配置文件 → localStorage['treasure_dev_settings::{pluginCode}']
├── 文件系统 → localStorage['file_{path}']
└── 目录标记 → localStorage['dir_{path}']
```

**注意事项**：
- 浏览器中无 Tauri API，`selectDirectory` 使用 `prompt()` 模拟
- 菜单注册/注销在开发态无宿主环境，返回空响应
- 每次刷新页面数据保留（localStorage 持久化）

### 4.2 宿主环境调试

在 Treasure 应用中通过调试插件功能加载插件：

```
Treasure App → 插件管理 → 注册调试插件
  插件编码: my-plugin
  插件中文名: 我的插件
  调试地址: http://localhost:5173
```

此时插件在 iframe 中运行，使用 `ProductionBridge` 通过 `postMessage` 与宿主通信，可以调试完整的端到端功能。

### 4.3 清理开发数据

```bash
# 清除所有 localStorage 数据（浏览器 DevTools > Application > Local Storage > 清除）
```

---

## 五、构建与打包

### 5.1 构建命令

```bash
npm run build         # Vite 构建 web 资源 → dist/
npm run build:plugin  # 构建 + 打包插件 → build-output/{name}.treasure-plugin/
npm run build:plugin:zip  # 同上，额外生成 .zip 文件
```

### 5.2 插件包结构

```
build-output/my-plugin.treasure-plugin/
├── index.html
├── manifest.json
├── public/
│   └── icon.svg
├── scripts/
│   ├── init.sql          # 初始化 SQL（可选）
│   └── destroy.sql       # 销毁 SQL（可选）
└── assets/
    ├── index-xxx.js
    └── index-xxx.css
```

### 5.3 自定义表结构初始化

**方法一**：在 `manifest.json` 申明 `tables` 字段（推荐）

宿主在导入插件时自动创建表，升级时自动 `ALTER TABLE ADD COLUMN`。

**方法二**：在插件启动时通过 SQL 建表

```typescript
import { getTreasure } from '@sdk/treasure';   // 当前
// import { getTreasure } from '@treasure/sdk'; // 未来

// 需要在 mounted 或初始化逻辑中调用
const bridge = getTreasure();
await bridge.execute(
  `CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, title TEXT, content TEXT)`,
  ['notes']
);
```

---

## 六、最佳实践

### 6.1 错误处理

```typescript
import { file } from '@sdk/treasure';   // 当前
// import { file } from '@treasure/sdk'; // 未来

async function loadData() {
  const res = await file.readFile('/path/to/data.json');
  if (res.code !== 1) {
    console.error('读取失败:', res.msg);
    // 显示用户友好的错误消息
    return;
  }
  const data = JSON.parse(res.data!);
  // 处理数据...
}
```

### 6.2 路径规范

- 使用绝对路径（以 `/` 开头）
- 插件文件建议存放在 `/plugins/{pluginCode}/` 下
- 文件路径中的特殊字符需编码处理

### 6.3 性能优化

- SQL 批量操作使用 `transaction` 而非逐条 `execute`
- 读取大文件时使用 `readBinaryFile` + 流式处理
- 频繁读取的配置 use `setting.getByKey` 缓存结果

### 6.4 兼容性注意事项

- `saveDialog` 和 `request` 方法不是所有宿主版本都支持，使用时需要可选链 `bridge.saveDialog?.()`
- 插件最小兼容版本在 `manifest.json` 的 `minPlatformVersion` 中声明

---

## 七、FAQ

**Q: `initTreasure()` 和 `getTreasure()` 有什么区别？**
A: `initTreasure()` 初始化桥接实例（单例），在 `main.ts` 中调用一次。`getTreasure()` 获取已初始化的实例，在业务代码中调用。

**Q: 为什么我的 SQL 执行失败？**
A: 常见原因：① `tables` 参数未声明使用的表 ② 表名包含非法字符 ③ 操作了平台禁止的表 ④ SQL 语法错误

**Q: 开发态数据会丢失吗？**
A: DevBridge 将数据存储在 `localStorage`，手动清除浏览器数据或调用 `localStorage.clear()` 会丢失。生产环境数据存储在宿主 SQLite 数据库，不会丢失。

**Q: 如何获取宿主的版本号？**
A: 当前版本暂无此 API，可通过 `manifest.json` 的 `minPlatformVersion` 声明最低版本要求。如有需要请联系宿主开发团队。**（即将支持 `bridge.getPlatformVersion()`）**

**Q: 预设图标在哪里可以预览？**
A: 预设图标来自 [Element Plus Icons](https://element-plus.org/zh-CN/component/icon.html)。在 `manifest.json` 的 `icon` 和 `menu.icon` 中直接使用图标名称即可，无需提供文件。

**Q: 自定义图标应该放在哪里？**
A: 将图标文件放在插件项目的 `public/` 目录下，建议使用 `public/assets/` 子目录。构建时会自动复制到插件包中。在 `manifest.json` 中使用相对路径引用，例如 `"icon": "assets/my-icon.svg"`。

**Q: 自定义图标有什么技术要求？**
A:
- 推荐使用 SVG 格式，尺寸建议 64x64 或 128x128
- viewBox 统一使用 `0 0 1024 1024`
- 填充色使用 `currentColor` 或 `#000000`，由宿主控制实际颜色
- 不要内联 `width`/`height` 固定尺寸
- 文件大小建议 < 50KB

**Q: 自定义图标不显示怎么办？**
A: 请检查：
1. 文件是否放在 `public/` 目录下
2. `manifest.json` 中的路径是否正确（使用相对路径，如 `"assets/icon.svg"`）
3. 文件扩展名是否为支持的格式（svg/png/jpg/ico/webp/gif）
4. SVG 是否包含 `viewBox` 属性
