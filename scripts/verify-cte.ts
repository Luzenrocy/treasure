/**
 * 手动验证 CTE SQL 安全校验链路
 * 运行：npx tsx scripts/verify-cte.ts
 */

import { validateSqlSecurity } from '../src/bridge/sqlSecurity';

function test(name: string, sql: string, pluginCode: string, expected: boolean) {
  const result = validateSqlSecurity(sql, 'query', pluginCode);
  const pass = result.valid === expected;
  console.log(`${pass ? '✅' : '❌'} ${name}`);
  if (!pass) {
    console.log(`   期望: ${expected}, 实际: ${result.valid}, 错误: ${result.error}`);
  }
}

const pluginCode = 'kao-cheng-ce';

console.log('=== CTE SQL 安全校验验证 ===\n');

// 注意：validateSqlSecurity 接收的是 rewriteWithDeclaredTables 重写后的 SQL
// 插件原始 SQL 使用裸表名，宿主侧会自动添加 plugin_{code}_ 前缀

test(
  '递归 CTE 查询通过',
  `WITH RECURSIVE descendants AS (
    SELECT id FROM "plugin_kao-cheng-ce_tasks" WHERE parent_id = ? AND is_deleted = 0
    UNION ALL
    SELECT t.id FROM "plugin_kao-cheng-ce_tasks" t
    INNER JOIN descendants d ON t.parent_id = d.id
    WHERE t.is_deleted = 0
  )
  SELECT id FROM descendants`,
  pluginCode,
  true
);

test(
  '嵌套 CTE 通过',
  `WITH a AS (SELECT id FROM "plugin_kao-cheng-ce_tasks" WHERE parent_id = 1),
       b AS (SELECT id FROM "plugin_kao-cheng-ce_tasks" WHERE parent_id IN (SELECT id FROM a))
  SELECT id FROM b`,
  pluginCode,
  true
);

test(
  '多 CTE 互相引用通过',
  `WITH RECURSIVE tree AS (
    SELECT id, parent_id FROM "plugin_kao-cheng-ce_tasks" WHERE id = ?
    UNION ALL
    SELECT t.id, t.parent_id FROM "plugin_kao-cheng-ce_tasks" t
    INNER JOIN tree tr ON t.parent_id = tr.id
  )
  SELECT id FROM tree`,
  pluginCode,
  true
);

test(
  '非 CTE SQL 行为不变',
  'SELECT * FROM "plugin_kao-cheng-ce_tasks" WHERE id = ?',
  pluginCode,
  true
);

test(
  '禁止操作平台表 sys_*',
  'SELECT * FROM sys_migration',
  pluginCode,
  false
);

test(
  '禁止操作平台表 tp_*',
  'SELECT * FROM tp_plugin',
  pluginCode,
  false
);

test(
  '未声明真实表名被拒绝',
  'SELECT * FROM unknown_table',
  pluginCode,
  false
);

test(
  'CTE 名称与真实表名相同仍通过（CTE 引用的是 CTE 自身而非真实表）',
  `WITH tasks AS (SELECT id FROM "plugin_kao-cheng-ce_tasks" WHERE parent_id = 1)
  SELECT id FROM tasks`,
  pluginCode,
  true
);

console.log('\n=== 验证完成 ===');
