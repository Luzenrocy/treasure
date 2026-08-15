use std::fs::{self, File};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tauri::State;
use tauri_plugin_notification::NotificationExt;
use zip::ZipArchive;
use sqlparser::ast::{Statement, Query, SetExpr, TableFactor, TableWithJoins, Join, AlterTableOperation, ColumnOption, TableConstraint, Ident, ObjectName, visit_relations_mut};
use sqlparser::dialect::SQLiteDialect;
use sqlparser::parser::Parser;
use std::collections::HashSet;
use std::ops::ControlFlow;
use tracing::{debug, error, info, trace, warn};
mod db;
use db::Database;
mod logging;
use logging::LogEngine;

fn extract_table_names_recursive(stmt: &Statement) -> HashSet<String> {
    let mut tables = HashSet::new();
    match stmt {
        Statement::Query(query) => {
            extract_tables_from_query(query, &mut tables);
        }
        Statement::Insert(insert) => {
            tables.insert(insert.table_name.to_string().to_lowercase());
            if let Some(source) = &insert.source {
                extract_tables_from_query(source, &mut tables);
            }
        }
        Statement::Update { table, from, .. } => {
            extract_table_from_twj(table, &mut tables);
            if let Some(from_table) = from {
                extract_table_from_twj(from_table, &mut tables);
            }
        }
        Statement::Delete(delete) => {
            match &delete.from {
                sqlparser::ast::FromTable::WithFromKeyword(twjs) |
                sqlparser::ast::FromTable::WithoutKeyword(twjs) => {
                    for twj in twjs {
                        extract_table_from_twj(twj, &mut tables);
                    }
                }
            }
        }
        Statement::CreateTable(create) => {
            tables.insert(create.name.to_string().to_lowercase());
            for column in &create.columns {
                for option_def in &column.options {
                    if let ColumnOption::ForeignKey { foreign_table, .. } = &option_def.option {
                        tables.insert(foreign_table.to_string().to_lowercase());
                    }
                }
            }
            for constraint in &create.constraints {
                if let TableConstraint::ForeignKey { foreign_table, .. } = constraint {
                    tables.insert(foreign_table.to_string().to_lowercase());
                }
            }
        }
        Statement::CreateIndex(create_index) => {
            tables.insert(create_index.table_name.to_string().to_lowercase());
        }
        Statement::Drop { names, .. } => {
            for name in names {
                tables.insert(name.to_string().to_lowercase());
            }
        }
        Statement::AlterTable { name, operations, .. } => {
            tables.insert(name.to_string().to_lowercase());
            for operation in operations {
                match operation {
                    AlterTableOperation::RenameTable { table_name } => {
                        tables.insert(table_name.to_string().to_lowercase());
                    }
                    AlterTableOperation::AddConstraint(constraint) => {
                        if let TableConstraint::ForeignKey { foreign_table, .. } = constraint {
                            tables.insert(foreign_table.to_string().to_lowercase());
                        }
                    }
                    AlterTableOperation::AddColumn { column_def, .. } => {
                        for option_def in &column_def.options {
                            if let ColumnOption::ForeignKey { foreign_table, .. } = &option_def.option {
                                tables.insert(foreign_table.to_string().to_lowercase());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    tables
}

fn namespace_declared_relation(relation: &mut ObjectName, declared: &HashSet<String>, prefix: &str) {
    let bare = relation.to_string().trim_matches('"').to_lowercase();
    if declared.contains(&bare) {
        *relation = ObjectName(vec![Ident::with_quote('"', format!("{}_{}", prefix, bare))]);
    }
}

fn namespace_foreign_key(constraint: &mut TableConstraint, declared: &HashSet<String>, prefix: &str) {
    if let TableConstraint::ForeignKey { foreign_table, .. } = constraint {
        namespace_declared_relation(foreign_table, declared, prefix);
    }
}

fn namespace_column_foreign_keys(
    column: &mut sqlparser::ast::ColumnDef,
    declared: &HashSet<String>,
    prefix: &str,
) {
    for option_def in &mut column.options {
        if let ColumnOption::ForeignKey { foreign_table, .. } = &mut option_def.option {
            namespace_declared_relation(foreign_table, declared, prefix);
        }
    }
}

/// `visit_relations_mut` deliberately does not visit foreign-key targets or
/// `ALTER TABLE ... RENAME TO` targets. They are table references as well and
/// must receive the same namespace transformation as query/DML relations.
fn namespace_migration_references(statement: &mut Statement, declared: &HashSet<String>, prefix: &str) {
    match statement {
        Statement::CreateTable(create) => {
            for column in &mut create.columns {
                namespace_column_foreign_keys(column, declared, prefix);
            }
            for constraint in &mut create.constraints {
                namespace_foreign_key(constraint, declared, prefix);
            }
        }
        Statement::AlterTable { operations, .. } => {
            for operation in operations {
                match operation {
                    AlterTableOperation::RenameTable { table_name } => {
                        namespace_declared_relation(table_name, declared, prefix);
                    }
                    AlterTableOperation::AddConstraint(constraint) => {
                        namespace_foreign_key(constraint, declared, prefix);
                    }
                    AlterTableOperation::AddColumn { column_def, .. } => {
                        namespace_column_foreign_keys(column_def, declared, prefix);
                    }
                    _ => {}
                }
            }
        }
        Statement::Drop { names, .. } => {
            for name in names {
                namespace_declared_relation(name, declared, prefix);
            }
        }
        _ => {}
    }
}

fn extract_tables_from_query(query: &Query, tables: &mut HashSet<String>) {
    // 收集 CTE 名称（递归 CTE 自我引用的名字，不是真实表）
    let cte_names: HashSet<String> = query.with
        .as_ref()
        .map(|with| {
            with.cte_tables
                .iter()
                .map(|cte| cte.alias.name.value.to_lowercase())
                .collect()
        })
        .unwrap_or_default();

    if let Some(with) = &query.with {
        for cte in &with.cte_tables {
            extract_tables_from_query(&cte.query, tables);
        }
    }
    extract_tables_from_set_expr(&query.body, tables);

    // 后置移除 CTE 名称，避免被当作真实表名（verify_sql 误判）
    for cte_name in &cte_names {
        tables.remove(cte_name);
    }
}

fn extract_tables_from_set_expr(set_expr: &SetExpr, tables: &mut HashSet<String>) {
    match set_expr {
        SetExpr::Select(select) => {
            for twj in &select.from {
                extract_table_from_twj(twj, tables);
            }
        }
        SetExpr::Query(subquery) => {
            extract_tables_from_query(subquery, tables);
        }
        SetExpr::SetOperation { left, right, .. } => {
            extract_tables_from_set_expr(left, tables);
            extract_tables_from_set_expr(right, tables);
        }
        _ => {}
    }
}

fn extract_table_from_twj(twj: &TableWithJoins, tables: &mut HashSet<String>) {
    extract_table_from_factor(&twj.relation, tables);
    for join in &twj.joins {
        extract_table_from_join(join, tables);
    }
}

fn extract_table_from_factor(factor: &TableFactor, tables: &mut HashSet<String>) {
    match factor {
        TableFactor::Table { name, .. } => {
            tables.insert(name.to_string().to_lowercase());
        }
        TableFactor::Derived { subquery, .. } => {
            extract_tables_from_query(subquery, tables);
        }
        TableFactor::NestedJoin { table_with_joins, .. } => {
            extract_table_from_twj(table_with_joins, tables);
        }
        _ => {}
    }
}

fn extract_table_from_join(join: &Join, tables: &mut HashSet<String>) {
    extract_table_from_factor(&join.relation, tables);
}

#[tauri::command]
async fn verify_sql(sql: String, declared_tables: Vec<String>) -> Result<serde_json::Value, String> {
    let dialect = SQLiteDialect {};
    let statements = Parser::parse_sql(&dialect, &sql)
        .map_err(|e| format!("SQL解析失败: {}", e))?;

    if statements.is_empty() {
        return Ok(serde_json::json!({
            "ok": false,
            "actual_tables": [],
            "missing": [],
            "extra": [],
            "error": "SQL为空"
        }));
    }

    if statements.len() > 1 {
        return Ok(serde_json::json!({
            "ok": false,
            "actual_tables": [],
            "missing": [],
            "extra": [],
            "error": "不支持多语句SQL"
        }));
    }

    let actual_tables = extract_table_names_recursive(&statements[0]);

    let declared_set: HashSet<String> = declared_tables.iter().map(|s| s.to_lowercase()).collect();
    let actual_set: HashSet<String> = actual_tables.iter().map(|s| s.to_lowercase()).collect();

    let missing: Vec<String> = actual_set.difference(&declared_set).map(|s| s.clone()).collect();
    let extra: Vec<String> = declared_set.difference(&actual_set).map(|s| s.clone()).collect();

    let ok = missing.is_empty();

    Ok(serde_json::json!({
        "ok": ok,
        "actual_tables": actual_tables.into_iter().collect::<Vec<_>>(),
        "missing": missing,
        "extra": extra
    }))
}

/** Parses, validates and namespaces SQL in one Rust AST operation. */
#[tauri::command]
async fn prepare_plugin_sql(sql: String, declared_tables: Vec<String>, plugin_code: String, action: String) -> Result<serde_json::Value, String> {
    let dialect = SQLiteDialect {};
    let mut statements = Parser::parse_sql(&dialect, &sql).map_err(|e| format!("SQL解析失败: {}", e))?;
    if statements.len() != 1 { return Err("只支持单条 SQL 语句".into()); }
    let allowed = match action.as_str() {
        "query" => matches!(statements[0], Statement::Query(_)),
        "execute" => matches!(statements[0], Statement::Insert(_) | Statement::Update { .. } | Statement::Delete(_)),
        // Installation and uninstall scripts are host-owned, versioned migration
        // inputs. Runtime plugin requests can never select this mode. INSERT is
        // required for data-preserving schema repairs (`INSERT ... SELECT ...`).
        "migration" => matches!(statements[0],
            Statement::CreateTable { .. } | Statement::CreateIndex { .. } |
            Statement::Drop { .. } | Statement::AlterTable { .. } | Statement::Insert(_)),
        _ => false,
    };
    if !allowed { return Err("该数据库能力不允许此 SQL 语句类型".into()); }
    let actual = extract_table_names_recursive(&statements[0]);
    let declared: HashSet<String> = declared_tables.iter().map(|table| table.to_lowercase()).collect();
    let missing: Vec<String> = actual.iter().filter(|table| !declared.contains(*table)).cloned().collect();
    if !missing.is_empty() { return Err(format!("SQL 引用了未声明表: {}", missing.join(", "))); }
    let prefix = format!("plugin_{}", plugin_code);
    let _ = visit_relations_mut(&mut statements, |relation: &mut ObjectName| {
        namespace_declared_relation(relation, &declared, &prefix);
        ControlFlow::<()>::Continue(())
    });
    namespace_migration_references(&mut statements[0], &declared, &prefix);
    Ok(serde_json::json!({ "sql": statements[0].to_string() }))
}

#[cfg(target_os = "macos")]
fn set_traffic_lights_hidden_internal(window: &tauri::WebviewWindow, hidden: bool) -> Result<(), String> {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())?;
    let ns_window: &NSWindow = unsafe { &*(ns_window_ptr.cast()) };

    let buttons = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ];

    for b in buttons {
        if let Some(button) = ns_window.standardWindowButton(b) {
            button.setHidden(hidden);
        }
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn set_traffic_lights_hidden_internal(_window: &tauri::WebviewWindow, _hidden: bool) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn extract_tables_from_sql(sql: String) -> Result<Vec<String>, String> {
    let dialect = SQLiteDialect {};
    let statements = Parser::parse_sql(&dialect, &sql)
        .map_err(|e| format!("SQL解析失败: {}", e))?;
    if statements.is_empty() {
        return Ok(vec![]);
    }
    let mut all_tables = HashSet::new();
    for stmt in &statements {
        let tables = extract_table_names_recursive(stmt);
        all_tables.extend(tables);
    }
    let mut result: Vec<String> = all_tables.into_iter().collect();
    result.sort();
    Ok(result)
}

#[tauri::command]
fn move_to_trash(path: String) -> Result<(), String> {
    move_path_to_trash(&path)
}

#[cfg(target_os = "macos")]
fn macos_trash_context() -> trash::TrashContext {
    use trash::macos::{DeleteMethod, TrashContextExtMacos};

    let mut context = trash::TrashContext::new();
    // Finder's AppleScript path fails for some hidden, external-volume and
    // sandbox-adjacent files. NSFileManager moves the same item to Trash
    // without requiring Finder automation.
    context.set_delete_method(DeleteMethod::NsFileManager);
    context
}

fn move_path_to_trash(path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return macos_trash_context().delete(path).map_err(|e| e.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(path).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod trash_tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_trash_context_uses_ns_file_manager_instead_of_finder() {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};

        assert!(matches!(super::macos_trash_context().delete_method(), DeleteMethod::NsFileManager));
    }
}

#[tauri::command]
fn delete_directory(path: String) -> Result<(), String> {
    if PathBuf::from(&path).exists() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn copy_directory(from: String, to: String) -> Result<(), String> {
    fn copy_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
        if src.is_dir() {
            fs::create_dir_all(dst)?;
            for entry in fs::read_dir(src)? {
                let entry = entry?;
                let entry_type = entry.file_type()?;
                let src_path = entry.path();
                let dst_path = dst.join(entry.file_name());
                if entry_type.is_dir() {
                    copy_recursive(&src_path, &dst_path)?;
                } else {
                    fs::copy(&src_path, &dst_path)?;
                }
            }
        } else {
            fs::copy(src, dst)?;
        }
        Ok(())
    }
    copy_recursive(&PathBuf::from(&from), &PathBuf::from(&to)).map_err(|e| e.to_string())
}

#[tauri::command]
fn extract_zip(zip_path: String, target_dir: String) -> Result<(), String> {
    let file = File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let entry_path = entry.mangled_name();
        let full_path = PathBuf::from(&target_dir).join(&entry_path);

        if entry.is_dir() {
            fs::create_dir_all(&full_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = full_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = File::create(&full_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn close_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_traffic_lights_visible(window: tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    set_traffic_lights_hidden_internal(&window, !visible)
}

#[tauri::command]
async fn get_log_settings(state: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db = state.inner().clone();
    let empty: Vec<rusqlite::types::Value> = vec![];
    let rows = db.query_value(
        "SELECT param_key, param_value FROM tp_setting WHERE param_code LIKE 'treasure::log_%'",
        rusqlite::params_from_iter(empty.into_iter()),
    ).map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Array(rows))
}

#[tauri::command]
async fn log_event(level: String, category: String, message: String, details: Option<String>) -> Result<(), String> {
    let details = details.unwrap_or_default();
    match level.as_str() {
        "trace" => trace!(target: "plugin", category = category, message = message, details = details),
        "debug" => debug!(target: "plugin", category = category, message = message, details = details),
        "info" => info!(target: "plugin", category = category, message = message, details = details),
        "warn" => warn!(target: "plugin", category = category, message = message, details = details),
        "error" => error!(target: "plugin", category = category, message = message, details = details),
        _ => info!(target: "plugin", category = category, message = message, details = details),
    }
    Ok(())
}

#[tauri::command]
async fn set_log_level(level: String, state: tauri::State<'_, Arc<LogEngine>>) -> Result<(), String> {
    state.inner().set_level_from_string(&level)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 启动时申请 macOS 通知权限
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let notification = app_handle.notification();
                let granted = notification.permission_state()
                    .map(|state| matches!(state, tauri_plugin_notification::PermissionState::Granted))
                    .unwrap_or(false);
                if !granted {
                    let _ = notification.request_permission();
                }
            });
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            fs::create_dir_all(&app_data_dir).ok();
            let db_path = app_data_dir.join("treasure.db");
            let database = Database::open(db_path.to_str().unwrap(), 5000)
                .expect("Failed to open database");
            
            let log_dir = app_data_dir.join("logs");
            let log_level = LogEngine::read_level_from_db(&database);
            let retention_days = LogEngine::read_retention_days_from_db(&database);
            let db_enabled = LogEngine::read_db_enabled_from_db(&database);
            let biz_enabled = LogEngine::read_biz_enabled_from_db(&database);
            let sys_enabled = LogEngine::read_sys_enabled_from_db(&database);
            let log_engine = LogEngine::init(log_dir, retention_days, log_level, db_enabled, biz_enabled, sys_enabled);
            
            app.manage(database);
            app.manage(log_engine);
            
            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Destroyed = event {
                        handle.exit(0);
                    }
                });
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            move_to_trash,
            delete_directory,
            copy_directory,
            extract_zip,
            close_window,
            set_traffic_lights_visible,
            verify_sql,
            prepare_plugin_sql,
            extract_tables_from_sql,
            db::db_query,
            db::db_execute,
            db::db_transaction,
            db::db_readonly_transaction,
            db::db_run_migrations,
            db::db_ready,
            get_log_settings,
            log_event,
            set_log_level,
        ])
        .register_uri_scheme_protocol("plugin", |ctx, request| {
            let uri = request.uri();
            let path = uri.path();

            let app_data_dir = ctx
                .app_handle()
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");

            let file_path = app_data_dir.join(path.trim_start_matches('/'));
            println!("file path : {}", file_path.display());
            println!("Plugin protocol request: {} -> {:?}", path, file_path);

            match fs::read(&file_path) {
                Ok(content) => {
                    let mime_type = get_mime_type(&file_path);

                    tauri::http::Response::builder()
                        .status(200)
                        .header("Content-Type", mime_type)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(content)
                        .unwrap()
                }
                Err(e) => {
                    eprintln!("Failed to read file {:?}: {}", file_path, e);
                    tauri::http::Response::builder()
                        .status(404)
                        .header("Content-Type", "text/plain")
                        .body(format!("File not found: {}", path).into_bytes())
                        .unwrap()
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn get_mime_type(path: &PathBuf) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") | Some("mjs") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("eot") => "application/vnd.ms-fontobject",
        Some("xml") => "application/xml",
        Some("txt") => "text/plain; charset=utf-8",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod sql_contract_tests {
    use super::*;

    #[test]
    fn namespaces_cte_join_tables_with_one_ast_pass() {
        let prepared = tauri::async_runtime::block_on(prepare_plugin_sql(
            "WITH active AS (SELECT id FROM tasks WHERE status = ?) SELECT t.id FROM tasks t JOIN task_tags tt ON tt.task_id = t.id WHERE EXISTS (SELECT 1 FROM active)".into(),
            vec!["tasks".into(), "task_tags".into()],
            "demo".into(),
            "query".into(),
        )).expect("valid query");
        let sql = prepared["sql"].as_str().expect("sql result");
        assert!(sql.contains("plugin_demo_tasks"));
        assert!(sql.contains("plugin_demo_task_tags"));
        assert!(!sql.contains("plugin_demo_active"));
    }

    #[test]
    fn accepts_complex_dml_but_rejects_runtime_ddl_and_multi_statement() {
        let write = tauri::async_runtime::block_on(prepare_plugin_sql(
            "UPDATE tasks SET status = ? WHERE EXISTS (SELECT 1 FROM task_tags WHERE task_id = tasks.id) RETURNING id".into(),
            vec!["tasks".into(), "task_tags".into()],
            "demo".into(),
            "execute".into(),
        ));
        assert!(write.is_ok());

        let ddl = tauri::async_runtime::block_on(prepare_plugin_sql(
            "CREATE TABLE tasks (id INTEGER)".into(), vec!["tasks".into()], "demo".into(), "execute".into(),
        ));
        assert!(ddl.unwrap_err().contains("不允许"));

        let multiple = tauri::async_runtime::block_on(prepare_plugin_sql(
            "SELECT * FROM tasks; SELECT * FROM tasks".into(), vec!["tasks".into()], "demo".into(), "query".into(),
        ));
        assert!(multiple.unwrap_err().contains("单条"));
    }

    #[test]
    fn namespaces_self_referencing_foreign_keys_in_plugin_migrations() {
        let prepared = tauri::async_runtime::block_on(prepare_plugin_sql(
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES tasks(id))".into(),
            vec!["tasks".into()],
            "demo".into(),
            "migration".into(),
        )).expect("valid plugin migration");
        let sql = prepared["sql"].as_str().expect("sql result");
        assert!(sql.contains("CREATE TABLE \"plugin_demo_tasks\""));
        assert!(sql.contains("REFERENCES \"plugin_demo_tasks\" (id)"));
    }

    #[test]
    fn namespaces_migration_rename_targets_and_copy_sources() {
        let renamed = tauri::async_runtime::block_on(prepare_plugin_sql(
            "ALTER TABLE tasks RENAME TO tasks_legacy".into(),
            vec!["tasks".into(), "tasks_legacy".into()],
            "demo".into(),
            "migration".into(),
        )).expect("valid table rename");
        assert_eq!(
            renamed["sql"].as_str(),
            Some("ALTER TABLE \"plugin_demo_tasks\" RENAME TO \"plugin_demo_tasks_legacy\"")
        );

        let copied = tauri::async_runtime::block_on(prepare_plugin_sql(
            "INSERT INTO tasks (id) SELECT id FROM tasks_legacy".into(),
            vec!["tasks".into(), "tasks_legacy".into()],
            "demo".into(),
            "migration".into(),
        )).expect("data-preserving migration copy");
        let sql = copied["sql"].as_str().expect("sql result");
        assert!(sql.contains("INSERT INTO \"plugin_demo_tasks\""));
        assert!(sql.contains("FROM \"plugin_demo_tasks_legacy\""));
    }

    #[test]
    fn migrated_self_referencing_table_accepts_root_task_with_foreign_keys_enabled() {
        let prepared = tauri::async_runtime::block_on(prepare_plugin_sql(
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES tasks(id))".into(),
            vec!["tasks".into()],
            "demo".into(),
            "migration".into(),
        )).expect("valid plugin migration");
        let sql = prepared["sql"].as_str().expect("sql result");
        let db = db::Database::open(":memory:", 1_000).expect("in-memory database");
        db.execute_value(sql, rusqlite::params_from_iter(Vec::<rusqlite::types::Value>::new().into_iter()))
            .expect("create namespaced table");
        db.execute_value(
            "INSERT INTO plugin_demo_tasks (id, parent_id) VALUES (1, NULL)",
            rusqlite::params_from_iter(Vec::<rusqlite::types::Value>::new().into_iter()),
        ).expect("root task must not resolve its foreign key to main.tasks");
    }

    #[test]
    fn data_preserving_repair_replaces_broken_foreign_key_schema() {
        fn prepare(sql: &str, tables: Vec<&str>) -> String {
            tauri::async_runtime::block_on(prepare_plugin_sql(
                sql.into(),
                tables.into_iter().map(str::to_owned).collect(),
                "demo".into(),
                "migration".into(),
            ))
            .expect("valid repair statement")["sql"]
                .as_str()
                .expect("sql result")
                .to_owned()
        }

        let db = db::Database::open(":memory:", 1_000).expect("in-memory database");
        let empty = || rusqlite::params_from_iter(Vec::<rusqlite::types::Value>::new().into_iter());
        db.execute_value("CREATE TABLE plugin_demo_tasks (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES tasks(id))", empty())
            .expect("create legacy broken table");
        db.execute_value("PRAGMA foreign_keys = OFF", empty()).expect("disable foreign keys to seed legacy data");
        db.execute_value("INSERT INTO plugin_demo_tasks (id, parent_id) VALUES (1, NULL)", empty())
            .expect("seed legacy row");
        db.execute_value("PRAGMA foreign_keys = ON", empty()).expect("restore foreign key checks");

        for (sql, tables) in [
            ("ALTER TABLE tasks RENAME TO tasks_legacy", vec!["tasks", "tasks_legacy"]),
            ("CREATE TABLE tasks (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES tasks(id))", vec!["tasks"]),
            ("INSERT INTO tasks (id, parent_id) SELECT id, parent_id FROM tasks_legacy", vec!["tasks", "tasks_legacy"]),
            ("DROP TABLE tasks_legacy", vec!["tasks_legacy"]),
        ] {
            let prepared = prepare(sql, tables);
            db.execute_value(&prepared, empty())
                .unwrap_or_else(|error| panic!("apply repair statement `{prepared}`: {error}"));
        }

        let rows = db.query_value("SELECT id FROM plugin_demo_tasks", empty()).expect("read preserved task");
        assert_eq!(rows.len(), 1);
        db.execute_value("INSERT INTO plugin_demo_tasks (id, parent_id) VALUES (2, 1)", empty())
            .expect("repaired foreign key must reference the namespaced table");
    }

    #[test]
    fn transaction_reports_each_statement_result() {
        let db = db::Database::open(":memory:", 1_000).expect("in-memory database");
        db.execute_value("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT)", rusqlite::params_from_iter(Vec::<rusqlite::types::Value>::new().into_iter()))
            .expect("create table");
        let results = db.transaction_value(
            &["INSERT INTO tasks (title) VALUES (?)".into(), "UPDATE tasks SET title = ? WHERE id = ?".into()],
            &[vec![serde_json::json!("first")], vec![serde_json::json!("updated"), serde_json::json!(1)]],
        ).expect("transaction");
        assert_eq!(results.len(), 2);
        assert_eq!(results[0]["affectedRows"], 1);
        assert_eq!(results[1]["affectedRows"], 1);
    }
}

#[cfg(test)]
mod filesystem_capability_tests {
    use std::collections::HashSet;

    #[test]
    fn host_filesystem_capability_uses_a_global_scope_and_supports_dot_paths() {
        let capability: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json"))
            .expect("valid capability JSON");
        let permissions = capability["permissions"].as_array().expect("permissions array");
        let commands: HashSet<&str> = permissions.iter()
            .filter_map(|permission| permission.as_str().or_else(|| permission["identifier"].as_str()))
            .collect();
        for command in [
            "fs:allow-read-file", "fs:allow-read-text-file", "fs:allow-read-dir",
            "fs:allow-exists", "fs:allow-write-file", "fs:allow-write-text-file",
            "fs:allow-mkdir", "fs:allow-remove",
        ] {
            assert!(commands.contains(command), "missing required fs command: {command}");
        }
        let scope_paths: HashSet<&str> = permissions.iter()
            .find(|permission| permission["identifier"] == "fs:scope")
            .and_then(|permission| permission["allow"].as_array())
            .expect("global fs scope")
            .iter()
            .filter_map(|entry| entry["path"].as_str())
            .collect();
        assert!(scope_paths.contains("/"), "scope must include the root directory itself");
        assert!(scope_paths.contains("/**/*"), "scope must include recursive descendants");
        assert!(!include_str!("../capabilities/default.json").contains(".assets"), "capability must not encode application-specific hidden path names");

        let tauri_config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("valid Tauri config");
        assert_eq!(tauri_config["plugins"]["fs"]["requireLiteralLeadingDot"], false,
            "glob scopes must match dotfiles and dot-directories without hard-coded names");
    }
}
