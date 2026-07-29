use std::sync::{Mutex, Arc};
use tauri::State;
use rusqlite::{Connection, Result as RusResult, Row, OptionalExtension, params_from_iter};
use tokio::task;
use tokio::time::timeout;
use serde_json::{Value, json};
use std::time::Duration;
use chrono::Utc;
use tracing::{debug, info};

const DEFAULT_TIMEOUT_MS: u64 = 15000;

pub struct Database {
    write_conn: Arc<Mutex<Connection>>,
    timeout_ms: u64,
}

impl Clone for Database {
    fn clone(&self) -> Self {
        Database {
            write_conn: Arc::clone(&self.write_conn),
            timeout_ms: self.timeout_ms,
        }
    }
}

// ─── 桥接：Value → rusqlite::types::Value ───

fn to_rl(v: &Value) -> rusqlite::types::Value {
    match v {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(b) => rusqlite::types::Value::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() { rusqlite::types::Value::Integer(i) }
            else if let Some(f) = n.as_f64() { rusqlite::types::Value::Real(f) }
            else { rusqlite::types::Value::Text(n.to_string()) }
        }
        Value::String(s) => rusqlite::types::Value::Text(s.clone()),
        _ => rusqlite::types::Value::Text(v.to_string()),
    }
}

/// 构建 ParamsFromIter（'static 所有权，可在 spawn_blocking 中使用）
/// rl::types::Value 实现了 ToSql → I::Item = rl::Value 满足 I::Item: ToSql
fn make_params(params: &[Value]) -> rusqlite::ParamsFromIter<std::vec::IntoIter<rusqlite::types::Value>> {
    let rl: Vec<rusqlite::types::Value> = params.iter().map(to_rl).collect();
    params_from_iter(rl.into_iter())
}

// ─── Database ───

impl Database {
    pub fn open(path: &str, busy_timeout_ms: u64) -> RusResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(&format!(
            "PRAGMA journal_mode=WAL;\
             PRAGMA synchronous=NORMAL;\
             PRAGMA cache_size=-61440;\
             PRAGMA foreign_keys=ON;\
             PRAGMA busy_timeout={};",
            busy_timeout_ms
        ))?;
        Ok(Self { write_conn: Arc::new(Mutex::new(conn)), timeout_ms: DEFAULT_TIMEOUT_MS })
    }

    pub fn query_value(&self, sql: &str, ps: rusqlite::ParamsFromIter<std::vec::IntoIter<rusqlite::types::Value>>) -> RusResult<Vec<Value>> {
        let conn = self.write_conn.lock().unwrap();
        let mut stmt = conn.prepare(sql)?;
        let mut rows = stmt.query(ps)?;
        let mut results = Vec::new();
        while let Some(row) = rows.next()? {
            results.push(row_to_value(&row));
        }
        Ok(results)
    }

    pub fn execute_value(&self, sql: &str, ps: rusqlite::ParamsFromIter<std::vec::IntoIter<rusqlite::types::Value>>) -> RusResult<Value> {
        let conn = self.write_conn.lock().unwrap();
        let rows_affected = conn.execute(sql, ps)? as u64;
        let last_insert_id = conn.last_insert_rowid();
        Ok(json!({ "rowsAffected": rows_affected, "lastInsertId": last_insert_id }))
    }

    pub fn transaction_value(&self, sqls: &[String], all_params: &[Vec<Value>]) -> RusResult<u64> {
        let mut conn = self.write_conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut executed = 0u64;
        for (i, sql) in sqls.iter().enumerate() {
            // map(to_rl) → Iterator<Item = rl::Value>，rl::Value: ToSql
            let ps = params_from_iter(
                all_params.get(i).map(|v| v.as_slice()).unwrap_or(&[])
                    .iter()
                    .map(to_rl)
            );
            tx.execute(sql, ps)?;
            executed += 1;
        }
        tx.commit()?;
        Ok(executed)
    }

    pub fn readonly_transaction_value(&self, sqls: &[String], all_params: &[Vec<Value>]) -> RusResult<Vec<Value>> {
        let conn = self.write_conn.lock().unwrap();
        conn.execute("BEGIN", [])?;
        let mut all_rows = Vec::new();
        for (i, sql) in sqls.iter().enumerate() {
            let mut stmt = conn.prepare(sql)?;
            let ps = params_from_iter(
                all_params.get(i).map(|v| v.as_slice()).unwrap_or(&[])
                    .iter()
                    .map(to_rl)
            );
            let mut rows = stmt.query(ps)?;
            while let Some(row) = rows.next()? {
                all_rows.push(row_to_value(&row));
            }
        }
        conn.execute("COMMIT", [])?;
        Ok(all_rows)
    }

    pub fn run_migrations(&self) -> RusResult<i64> {
        let mut conn = self.write_conn.lock().unwrap();
        conn.execute_batch("PRAGMA busy_timeout=10000")?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sys_migration (\
             id INTEGER PRIMARY KEY,\
             version INTEGER NOT NULL UNIQUE,\
             name TEXT NOT NULL,\
             applied_at INTEGER NOT NULL,\
             checksum TEXT,\
             error TEXT\
             )", [],
        )?;

        let current: i64 = conn
            .query_row("SELECT COALESCE(MAX(version),0) FROM sys_migration WHERE error IS NULL", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap_or(0);

        let migrations: [(&str, &str); 8] = [
            ("1", "Platform Base"),
            ("2", "Add param_key"),
            ("3", "Plugin Init Script Log"),
            ("4", "Add log settings"),
            ("5", "Optimize log settings"),
            ("6", "Logging defaults off and rename"),
            ("7", "Test plugin data"),
            ("8", "More test plugin data"),
        ];

        for (version_str, name) in &migrations {
            let version: i64 = version_str.parse().unwrap();
            if version <= current { continue; }
            let now = Utc::now().timestamp_millis();
            let mut last_err: Option<String> = None;
            for retry in (0..3).rev() {
                let tx_res: Result<(), String> = (|| {
                    let tx = conn.transaction().map_err(|e| e.to_string())?;
                    match version {
                          1 => apply_v1(&tx, now).map_err(|e| e.to_string())?,
                          2 => apply_v2(&tx).map_err(|e| e.to_string())?,
                          3 => apply_v3(&tx).map_err(|e| e.to_string())?,
                          4 => apply_v4(&tx).map_err(|e| e.to_string())?,
                          5 => apply_v5(&tx).map_err(|e| e.to_string())?,
                          6 => apply_v6(&tx).map_err(|e| e.to_string())?,
                          7 => apply_v7(&tx).map_err(|e| e.to_string())?,
                          8 => apply_v8(&tx).map_err(|e| e.to_string())?,
                          _ => {}
                    }
                    tx.execute(
                        "INSERT INTO sys_migration (version, name, applied_at) VALUES (?, ?, ?)",
                        [*version_str, *name, &now.to_string()],
                    ).map_err(|e| e.to_string())?;
                    tx.commit().map_err(|e| e.to_string())?;
                    Ok(())
                })();
                match tx_res {
                    Ok(()) => { last_err = None; break; }
                    Err(e) => {
                        last_err = Some(e);
                        if retry > 0 {
                            std::thread::sleep(std::time::Duration::from_millis((3 - retry) * 1000));
                        }
                    }
                }
            }
            if let Some(err) = &last_err {
                let _ = conn.execute(
                    "INSERT INTO sys_migration (version, name, applied_at, error) VALUES (?, ?, ?, ?)",
                    [*version_str, *name, &Utc::now().timestamp_millis().to_string(), err],
                );
                return Err(rusqlite::Error::StatementChangedRows(0));
            }
        }
        Ok(current)
    }
}

// ─── Tauri Commands ───

fn extract_table(sql: &str) -> String {
    let sql_lower = sql.to_lowercase();
    let patterns = [" from ", " into ", " update "];
    for pattern in &patterns {
        if let Some(idx) = sql_lower.find(pattern) {
            let start = idx + pattern.len();
            let rest = &sql_lower[start..];
            if let Some(end) = rest.find(|c: char| c == ' ' || c == ',' || c == ';' || c == '(') {
                return rest[..end].to_string();
            }
            if !rest.is_empty() {
                return rest.to_string();
            }
        }
    }
    "unknown".to_string()
}

#[tauri::command]
pub fn db_ready(_state: State<'_, Database>) -> Value {
    json!({ "ready": true, "code": 1 })
}

#[tauri::command]
pub async fn db_query(
    state: State<'_, Database>,
    sql: String,
    params: Vec<Value>,
) -> Result<Value, String> {
    let db = state.inner().clone();
    let start = std::time::Instant::now();
    let sql_truncated = sql.chars().take(200).collect::<String>();
    let table_name = extract_table(&sql);
    
    debug!(target: "db", table = table_name, op = "query", sql = sql_truncated, "db_query start");
    
    let result = timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS), task::spawn_blocking(move || -> Result<Value, String> {
        let ps = make_params(&params);
        db.query_value(&sql, ps).map(Value::Array).map_err(|e| e.to_string())
    }))
    .await
    .map_err(|_| "查询超时".to_string())?
    .map_err(|_| "线程错误".to_string())?;
    
    let cost_ms = start.elapsed().as_millis() as u64;
    let rows = result.as_ref().map(|v| v.as_array().map(|a| a.len()).unwrap_or(0)).unwrap_or(0);
    
    info!(target: "db", table = table_name, op = "query", cost_ms = cost_ms, rows = rows, "db_query done");
    
    result
}

#[tauri::command]
pub async fn db_execute(
    state: State<'_, Database>,
    sql: String,
    params: Vec<Value>,
) -> Result<Value, String> {
    let db = state.inner().clone();
    let start = std::time::Instant::now();
    let sql_truncated = sql.chars().take(200).collect::<String>();
    let table_name = extract_table(&sql);
    
    debug!(target: "db", table = table_name, op = "execute", sql = sql_truncated, "db_execute start");
    
    let result = timeout(Duration::from_millis(8000), task::spawn_blocking(move || -> Result<Value, String> {
        let ps = make_params(&params);
        db.execute_value(&sql, ps).map_err(|e| e.to_string())
    }))
    .await
    .map_err(|_| "执行超时".to_string())?
    .map_err(|_| "线程错误".to_string())?;
    
    let cost_ms = start.elapsed().as_millis() as u64;
    let rows = result.as_ref().map(|v| v.get("rowsAffected").and_then(|n| n.as_u64()).unwrap_or(0)).unwrap_or(0);
    
    info!(target: "db", table = table_name, op = "execute", cost_ms = cost_ms, rows = rows, "db_execute done");
    
    result
}

#[tauri::command]
pub async fn db_transaction(
    state: State<'_, Database>,
    sqls: Vec<String>,
    all_params: Vec<Vec<Value>>,
) -> Result<Value, String> {
    let db = state.inner().clone();
    let start = std::time::Instant::now();
    let sql_count = sqls.len();
    
    debug!(target: "db", op = "transaction", sql_count = sql_count, "db_transaction start");
    
    let result = timeout(Duration::from_millis(20000), task::spawn_blocking(move || -> Result<Value, String> {
        db.transaction_value(&sqls, &all_params)
            .map(|n| json!({ "executed": n }))
            .map_err(|e| e.to_string())
    }))
    .await
    .map_err(|_| "事务超时".to_string())?
    .map_err(|_| "线程错误".to_string())?;
    
    let cost_ms = start.elapsed().as_millis() as u64;
    let executed = result.as_ref().map(|v| v.get("executed").and_then(|n| n.as_u64()).unwrap_or(0)).unwrap_or(0);
    
    info!(target: "db", op = "transaction", sql_count = sql_count, executed = executed, cost_ms = cost_ms, "db_transaction done");
    
    result
}

#[tauri::command]
pub async fn db_readonly_transaction(
    state: State<'_, Database>,
    sqls: Vec<String>,
    all_params: Vec<Vec<Value>>,
) -> Result<Value, String> {
    let db = state.inner().clone();
    let start = std::time::Instant::now();
    let sql_count = sqls.len();
    
    debug!(target: "db", op = "readonly_transaction", sql_count = sql_count, "db_readonly_transaction start");
    
    let result = timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS), task::spawn_blocking(move || -> Result<Value, String> {
        db.readonly_transaction_value(&sqls, &all_params)
            .map(Value::Array)
            .map_err(|e| e.to_string())
    }))
    .await
    .map_err(|_| "只读事务超时".to_string())?
    .map_err(|_| "线程错误".to_string())?;
    
    let cost_ms = start.elapsed().as_millis() as u64;
    let rows = result.as_ref().map(|v| v.as_array().map(|a| a.len()).unwrap_or(0)).unwrap_or(0);
    
    info!(target: "db", op = "readonly_transaction", sql_count = sql_count, rows = rows, cost_ms = cost_ms, "db_readonly_transaction done");
    
    result
}

#[tauri::command]
pub async fn db_run_migrations(
    state: State<'_, Database>,
) -> Result<Value, String> {
    let db = state.inner().clone();
    timeout(Duration::from_millis(60000), task::spawn_blocking(move || -> Result<Value, String> {
        let v: i64 = db.run_migrations().map_err(|e| e.to_string())?;
        Ok(json!({ "code": 1, "version": v as u64 }))
    }))
    .await
    .map_err(|_| "迁移超时".to_string())?
    .map_err(|_| "线程错误".to_string())?
}

// ─── 内部辅助 ───

fn row_to_value(row: &Row) -> Value {
    let mut map = serde_json::Map::new();
    let count = row.as_ref().column_count();
    for i in 0..count {
        let name = row.as_ref().column_name(i).unwrap_or("unknown").to_string();
        map.insert(name, col_val(row, i));
    }
    Value::Object(map)
}

fn col_val(row: &Row, idx: usize) -> Value {
    if let Ok(Some(n)) = row.get::<_, Option<i64>>(idx) {
        return Value::Number(n.into());
    }
    if let Ok(Some(n)) = row.get::<_, Option<f64>>(idx) {
        return serde_json::Number::from_f64(n).map(Value::Number).unwrap_or(Value::Null);
    }
    if let Ok(Some(s)) = row.get::<_, Option<String>>(idx) {
        return Value::String(s);
    }
    Value::Null
}

fn apply_v1(tx: &rusqlite::Transaction, now: i64) -> RusResult<()> {
    tx.execute("CREATE TABLE IF NOT EXISTS sys_migration (id INTEGER PRIMARY KEY, version INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, applied_at INTEGER NOT NULL, checksum TEXT, error TEXT)", [])?;
    tx.execute("CREATE TABLE IF NOT EXISTS tp_plugin (id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_code TEXT NOT NULL UNIQUE, plugin_alias TEXT NOT NULL, plugin_version TEXT NOT NULL, plugin_desc TEXT, plugin_author TEXT, plugin_icon TEXT, plugin_entry TEXT, plugin_location TEXT, has_init_script INTEGER DEFAULT 0, has_destroy_script INTEGER DEFAULT 0, plugin_type INTEGER NOT NULL DEFAULT 0, debug_url TEXT, plugin_uid TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)", [])?;
    tx.execute("CREATE TABLE IF NOT EXISTS tp_menu (id INTEGER PRIMARY KEY AUTOINCREMENT, menu_id TEXT NOT NULL UNIQUE, menu_name TEXT NOT NULL, menu_type INTEGER NOT NULL DEFAULT 1, menu_level INTEGER NOT NULL DEFAULT 1, parent_id INTEGER DEFAULT NULL, menu_path TEXT NOT NULL, menu_icon TEXT, show_type INTEGER NOT NULL DEFAULT 2, show_order INTEGER DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, plugin_id INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (plugin_id) REFERENCES tp_plugin(id) ON DELETE SET NULL, FOREIGN KEY (parent_id) REFERENCES tp_menu(id) ON DELETE CASCADE)", [])?;
    tx.execute("CREATE TABLE IF NOT EXISTS tp_setting (id INTEGER PRIMARY KEY AUTOINCREMENT, param_code TEXT NOT NULL UNIQUE, param_name TEXT NOT NULL, param_type TEXT NOT NULL, param_value TEXT NOT NULL, param_placeholder TEXT, param_properties TEXT, param_options TEXT, param_key TEXT, plugin_id INTEGER NOT NULL, menu_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (plugin_id) REFERENCES tp_plugin(id) ON DELETE CASCADE, FOREIGN KEY (menu_id) REFERENCES tp_menu(menu_id) ON DELETE SET NULL)", [])?;
    tx.execute("INSERT OR IGNORE INTO tp_menu (menu_id, menu_name, menu_type, menu_level, parent_id, menu_path, menu_icon, show_type, show_order, hidden, created_at, updated_at) VALUES ('100002', '插件中心', 1, 1, NULL, '/pluginManager', 'plugin', 2, 9999998, 0, ?, ?)", [now, now])?;
    tx.execute("INSERT OR IGNORE INTO tp_menu (menu_id, menu_name, menu_type, menu_level, parent_id, menu_path, menu_icon, show_type, show_order, hidden, created_at, updated_at) VALUES ('100003', '系统设置', 1, 1, NULL, '/setting', 'setting', 2, 9999999, 0, ?, ?)", [now, now])?;
    tx.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_tp_plugin_uid ON tp_plugin(plugin_uid) WHERE plugin_uid IS NOT NULL", [])?;
    tx.execute("INSERT OR IGNORE INTO tp_plugin (plugin_code, plugin_alias, plugin_version, plugin_type, plugin_uid, created_at, updated_at) VALUES ('treasure', '系统参数', '1.0.0', 0, '00000000-0000-5000-8000-000000000000', ?, ?)", [now, now])?;
    tx.execute("INSERT OR IGNORE INTO tp_setting (param_code, param_name, param_type, param_value, param_options, plugin_id, menu_id, created_at, updated_at) VALUES ('treasure::plugin_manager_switch', '插件中心', 'switch', '1', '{\"activeText\":\"显示\",\"inActiveText\":\"隐藏\",\"activeValue\":\"1\",\"inactiveValue\":\"0\"}', (SELECT id FROM tp_plugin WHERE plugin_code = 'treasure'), '100002', ?, ?)", [now, now])?;
    tx.execute("INSERT OR IGNORE INTO tp_setting (param_code, param_name, param_type, param_value, param_options, plugin_id, created_at, updated_at) VALUES ('treasure::debug_switch', '调试', 'switch', '0', '{\"activeText\":\"开\",\"inActiveText\":\"关\",\"activeValue\":\"1\",\"inactiveValue\":\"0\"}', (SELECT id FROM tp_plugin WHERE plugin_code = 'treasure'), ?, ?)", [now, now])?;
    let plugin_count: i64 = match tx.query_row("SELECT COUNT(*) as count FROM tp_plugin WHERE plugin_code = 'treasure'", [], |row| row.get(0)).optional() {
        Ok(Some(n)) => n,
        Ok(None) | Err(rusqlite::Error::QueryReturnedNoRows) => 0,
        Err(e) => return Err(e),
    };
    if plugin_count == 0 { return Err(rusqlite::Error::StatementChangedRows(0)); }
    let setting_count: i64 = match tx.query_row("SELECT COUNT(*) as count FROM tp_setting WHERE param_code LIKE 'treasure::%'", [], |row| row.get(0)).optional() {
        Ok(Some(n)) => n,
        Ok(None) | Err(rusqlite::Error::QueryReturnedNoRows) => 0,
        Err(e) => return Err(e),
    };
    if setting_count == 0 { return Err(rusqlite::Error::StatementChangedRows(0)); }
    Ok(())
}

fn apply_v2(tx: &rusqlite::Transaction) -> RusResult<()> {
    let cols: Vec<(String,)> = tx
        .prepare("PRAGMA table_info(tp_setting)")?
        .query_and_then([], |row| Ok::<(String,), rusqlite::Error>((row.get::<_, String>(1)?,)))?
        .collect::<Result<Vec<_>, _>>()?;
    if !cols.iter().any(|(n,)| n == "param_key") {
        tx.execute("ALTER TABLE tp_setting ADD COLUMN param_key TEXT", [])?;
        tx.execute(
            "UPDATE tp_setting SET param_key = \
             CASE WHEN instr(param_code, '::') > 0 THEN substr(param_code, instr(param_code, '::') + 2) ELSE param_name END",
            [],
        )?;
    }
    Ok(())
}

fn apply_v3(tx: &rusqlite::Transaction) -> RusResult<()> {
    tx.execute(
        "CREATE TABLE IF NOT EXISTS tp_plugin_init_log (\
         id INTEGER PRIMARY KEY AUTOINCREMENT,\
         plugin_id INTEGER NOT NULL,\
         init_version TEXT NOT NULL,\
         script_hash TEXT,\
         executed_at INTEGER NOT NULL,\
         success INTEGER NOT NULL DEFAULT 1,\
         error_message TEXT,\
         FOREIGN KEY (plugin_id) REFERENCES tp_plugin(id) ON DELETE CASCADE\
         )", [],
    )?;
    tx.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_init_version \
         ON tp_plugin_init_log(plugin_id, init_version)", [],
    )?;
    Ok(())
}

fn apply_v4(tx: &rusqlite::Transaction) -> RusResult<()> {
    let now = Utc::now().timestamp_millis();
    tx.execute(
        "INSERT OR IGNORE INTO tp_setting (param_code, param_name, param_type, param_value, param_placeholder, param_properties, param_key, plugin_id, created_at, updated_at) \
         VALUES ('treasure::log_retention_days', '日志保留天数', 'number', '6', '', '{\"min\":1,\"max\":365,\"step\":1}', 'log_retention_days', (SELECT id FROM tp_plugin WHERE plugin_code = 'treasure'), ?, ?)",
        [now, now],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO tp_setting (param_code, param_name, param_type, param_value, param_placeholder, param_properties, param_key, plugin_id, created_at, updated_at) \
         VALUES ('treasure::log_level', '日志级别', 'select', 'info', '', '{}', 'log_level', (SELECT id FROM tp_plugin WHERE plugin_code = 'treasure'), ?, ?)",
        [now, now],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO tp_setting (param_code, param_name, param_type, param_value, param_placeholder, param_properties, param_key, plugin_id, created_at, updated_at) \
         VALUES ('treasure::log_db_enabled', '数据库日志', 'switch', '0', '', '{\"activeText\":\"开\",\"inActiveText\":\"关\",\"activeValue\":\"1\",\"inactiveValue\":\"0\"}', 'log_db_enabled', (SELECT id FROM tp_plugin WHERE plugin_code = 'treasure'), ?, ?)",
        [now, now],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO tp_setting (param_code, param_name, param_type, param_value, param_placeholder, param_properties, param_key, plugin_id, created_at, updated_at) \
         VALUES ('treasure::log_biz_enabled', '插件日志', 'switch', '0', '', '{\"activeText\":\"开\",\"inActiveText\":\"关\",\"activeValue\":\"1\",\"inactiveValue\":\"0\"}', 'log_biz_enabled', (SELECT id FROM tp_plugin WHERE plugin_code = 'treasure'), ?, ?)",
        [now, now],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO tp_setting (param_code, param_name, param_type, param_value, param_placeholder, param_properties, param_key, plugin_id, created_at, updated_at) \
         VALUES ('treasure::log_sys_enabled', 'treasure日志', 'switch', '0', '', '{\"activeText\":\"开\",\"inActiveText\":\"关\",\"activeValue\":\"1\",\"inactiveValue\":\"0\"}', 'log_sys_enabled', (SELECT id FROM tp_plugin WHERE plugin_code = 'treasure'), ?, ?)",
        [now, now],
    )?;
    // 设置 log_level 的可选值
    tx.execute(
        "UPDATE tp_setting SET param_options = ? WHERE param_code = 'treasure::log_level'",
        [r#"[{"value":"trace","label":"TRACE"},{"value":"debug","label":"DEBUG"},{"value":"info","label":"INFO"},{"value":"warn","label":"WARN"},{"value":"error","label":"ERROR"}]"#],
    )?;
    Ok(())
}

fn apply_v5(tx: &rusqlite::Transaction) -> RusResult<()> {
    // 修复已有用户的日志保留天数：number 类型，若仍为旧默认值 30 则改为 6
    tx.execute(
        "UPDATE tp_setting SET param_type = 'number', param_properties = '{\"min\":1,\"max\":365,\"step\":1}', param_value = CASE WHEN param_value = '30' THEN '6' ELSE param_value END WHERE param_code = 'treasure::log_retention_days'",
        [],
    )?;
    // 修复已有用户的日志级别：select 类型 + 可选值
    tx.execute(
        "UPDATE tp_setting SET param_type = 'select', param_options = '[{\"value\":\"trace\",\"label\":\"TRACE\"},{\"value\":\"debug\",\"label\":\"DEBUG\"},{\"value\":\"info\",\"label\":\"INFO\"},{\"value\":\"warn\",\"label\":\"WARN\"},{\"value\":\"error\",\"label\":\"ERROR\"}]' WHERE param_code = 'treasure::log_level'",
        [],
    )?;
    Ok(())
}

fn apply_v6(tx: &rusqlite::Transaction) -> RusResult<()> {
    // 日志开关默认关闭
    tx.execute(
        "UPDATE tp_setting SET param_value = '0' WHERE param_code IN ('treasure::log_db_enabled', 'treasure::log_biz_enabled', 'treasure::log_sys_enabled') AND param_value = '1'",
        [],
    )?;
    // 重命名：业务日志 → 插件日志，系统日志 → treasure日志
    tx.execute(
        "UPDATE tp_setting SET param_name = '插件日志' WHERE param_code = 'treasure::log_biz_enabled' AND param_name = '业务日志'",
        [],
    )?;
    tx.execute(
        "UPDATE tp_setting SET param_name = 'treasure日志' WHERE param_code = 'treasure::log_sys_enabled' AND param_name = '系统日志'",
        [],
    )?;
    Ok(())
}

fn apply_v7(_tx: &rusqlite::Transaction) -> RusResult<()> {
    Ok(())
}

fn apply_v8(_tx: &rusqlite::Transaction) -> RusResult<()> {
    Ok(())
}
