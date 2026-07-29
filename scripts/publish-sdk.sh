#!/bin/bash
# ============================================================
# @treasure/sdk 发布脚本
# 使用方式：bash scripts/publish.sh
# 前置条件：npm login 已登录（`npm whoami` 返回用户名）
# ============================================================

set -e

# 切换到 SDK 目录
cd "$(dirname "$0")/../packages/treasure-sdk"

echo "📦 构建 @treasure/sdk..."
npm run build

echo "🔍 检查 npm 登录状态..."
if ! npm whoami --registry https://registry.npmjs.org &>/dev/null; then
  echo "❌ 未登录 npm，请先执行: npm login --registry https://registry.npmjs.org"
  exit 1
fi

echo "📤 发布到 npm registry..."
npm publish --registry https://registry.npmjs.org

echo "✅ @treasure/sdk@$(node -p "require('./package.json').version") 发布成功"