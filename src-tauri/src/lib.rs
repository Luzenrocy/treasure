use std::fs::{self, File};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tauri::State;
use tauri_plugin_notification::NotificationExt;
use zip::ZipArchive;
use sqlparser::ast::{Statement, Query, SetExpr, TableFactor, TableWithJoins, Join, ColumnOption, TableConstraint};
use sqlparser::dialect::SQLiteDialect;
use sqlparser::parser::Parser;
use std::collections::HashSet;
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
        _ => {}
    }
    tables
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
    trash::delete(&path).map_err(|e| e.to_string())
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
