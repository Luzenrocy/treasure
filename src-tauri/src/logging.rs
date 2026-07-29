use tracing::{info, Level};
use tracing_subscriber::{EnvFilter, Registry};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::reload;
use tracing_appender::non_blocking::WorkerGuard;
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::fs::{self, OpenOptions, File};
use chrono::Local;
use crate::db::Database;

/// 自定义按天轮转写入器，生成 `treasure-YYYY-MM-DD.log`
struct DailyLogRotator {
    log_dir: PathBuf,
    state: Mutex<RotatorState>,
}

struct RotatorState {
    date: String,
    file: Option<File>,
}

impl DailyLogRotator {
    fn new(log_dir: PathBuf) -> Self {
        Self {
            log_dir,
            state: Mutex::new(RotatorState {
                date: String::new(),
                file: None,
            }),
        }
    }
}

impl Write for DailyLogRotator {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let date = Local::now().format("%Y-%m-%d").to_string();
        let mut state = self.state.lock().unwrap();
        if state.date != date || state.file.is_none() {
            state.date = date.clone();
            let path = self.log_dir.join(format!("treasure-{}.log", date));
            fs::create_dir_all(&self.log_dir).ok();
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)?;
            state.file = Some(file);
        }
        state.file.as_mut().unwrap().write(buf)
    }
    fn flush(&mut self) -> io::Result<()> {
        let mut state = self.state.lock().unwrap();
        if let Some(file) = state.file.as_mut() {
            file.flush()
        } else {
            Ok(())
        }
    }
}

pub struct LogEngine {
    retention_days: u32,
    log_dir: PathBuf,
    _guard: WorkerGuard,
    reload_handle: Mutex<Option<reload::Handle<EnvFilter, Registry>>>,
}

impl LogEngine {
    pub fn init(log_dir: PathBuf, retention_days: u32, level: Level, db_enabled: bool, biz_enabled: bool, sys_enabled: bool) -> Arc<Self> {
        let _ = std::fs::create_dir_all(&log_dir);
        
        let log_rotator = DailyLogRotator::new(log_dir.clone());
        let (non_blocking, guard) = tracing_appender::non_blocking(log_rotator);
        
        let json_layer = tracing_subscriber::fmt::layer()
            .json()
            .with_writer(non_blocking)
            .with_timer(tracing_subscriber::fmt::time::ChronoLocal::rfc_3339());
        
        let console_layer = tracing_subscriber::fmt::layer()
            .with_writer(std::io::stdout)
            .with_ansi(true);
        
        let mut filter = EnvFilter::from_default_env()
            .add_directive(level.into());
        
        // 按日志类型开关控制输出
        if !db_enabled {
            filter = filter.add_directive("target:db=off".parse().unwrap());
        }
        if !biz_enabled {
            filter = filter.add_directive("target:biz=off".parse().unwrap());
        }
        if !sys_enabled {
            filter = filter.add_directive("target:sys=off".parse().unwrap());
            filter = filter.add_directive("target:bridge=off".parse().unwrap());
        }
        
        let (filter_layer, reload_handle) = reload::Layer::new(filter);
        
        let subscriber = Registry::default()
            .with(filter_layer)
            .with(json_layer)
            .with(console_layer);
        
        tracing::subscriber::set_global_default(subscriber)
            .expect("无法初始化日志 subscriber");
        
        let engine = Arc::new(Self {
            retention_days,
            log_dir,
            _guard: guard,
            reload_handle: Mutex::new(Some(reload_handle)),
        });
        
        engine.cleanup_old_logs();
        
        engine
    }
    
    fn cleanup_old_logs(&self) {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(self.retention_days as i64);
        let prefix = "treasure-";
        let _ = std::fs::read_dir(&self.log_dir).and_then(|entries| {
            for entry in entries.flatten() {
                let path = entry.path();
                let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if !file_name.starts_with(prefix) || !file_name.ends_with(".log") {
                    continue;
                }
                // 从文件名解析日期：treasure-YYYY-MM-DD.log
                let date_str = file_name.trim_start_matches(prefix).trim_end_matches(".log");
                if let Ok(file_date) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                    let file_datetime = file_date.and_hms_opt(0, 0, 0).unwrap().and_utc();
                    if file_datetime < cutoff {
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
            Ok(())
        });
    }
    
    /// 从数据库 tp_setting 读取日志级别，若查询失败或无效则返回默认 INFO
    pub fn read_level_from_db(db: &Database) -> Level {
        let empty: Vec<rusqlite::types::Value> = vec![];
        let result = db.query_value(
            "SELECT param_value FROM tp_setting WHERE param_code = 'treasure::log_level'",
            rusqlite::params_from_iter(empty.into_iter()),
        );
        match result {
            Ok(rows) => {
                if let Some(row) = rows.first() {
                    if let Some(val) = row.get("param_value").and_then(|v| v.as_str()) {
                        return Self::parse_level(val);
                    }
                }
                Level::INFO
            }
            Err(_) => Level::INFO,
        }
    }
    
    /// 从数据库 tp_setting 读取日志保留天数，默认 6
    pub fn read_retention_days_from_db(db: &Database) -> u32 {
        let empty: Vec<rusqlite::types::Value> = vec![];
        let result = db.query_value(
            "SELECT param_value FROM tp_setting WHERE param_code = 'treasure::log_retention_days'",
            rusqlite::params_from_iter(empty.into_iter()),
        );
        match result {
            Ok(rows) => {
                if let Some(row) = rows.first() {
                    if let Some(val) = row.get("param_value").and_then(|v| v.as_str()) {
                        if let Ok(n) = val.parse::<u32>() {
                            return n.max(1);
                        }
                    }
                }
                6
            }
            Err(_) => 6,
        }
    }

    /// 从数据库 tp_setting 读取数据库日志开关，默认 false
    pub fn read_db_enabled_from_db(db: &Database) -> bool {
        Self::read_bool_from_db(db, "treasure::log_db_enabled", false)
    }

    /// 从数据库 tp_setting 读取插件日志开关，默认 false
    pub fn read_biz_enabled_from_db(db: &Database) -> bool {
        Self::read_bool_from_db(db, "treasure::log_biz_enabled", false)
    }

    /// 从数据库 tp_setting 读取 treasure 日志开关，默认 false
    pub fn read_sys_enabled_from_db(db: &Database) -> bool {
        Self::read_bool_from_db(db, "treasure::log_sys_enabled", false)
    }

    fn read_bool_from_db(db: &Database, _param_code: &str, default: bool) -> bool {
        let empty: Vec<rusqlite::types::Value> = vec![];
        let result = db.query_value(
            "SELECT param_value FROM tp_setting WHERE param_code = ?",
            rusqlite::params_from_iter(empty.into_iter()),
        );
        match result {
            Ok(rows) => {
                if let Some(row) = rows.first() {
                    if let Some(val) = row.get("param_value").and_then(|v| v.as_str()) {
                        return val == "1";
                    }
                }
                default
            }
            Err(_) => default,
        }
    }
    
    fn parse_level(s: &str) -> Level {
        match s.to_lowercase().as_str() {
            "trace" => Level::TRACE,
            "debug" => Level::DEBUG,
            "info" => Level::INFO,
            "warn" => Level::WARN,
            "error" => Level::ERROR,
            _ => Level::INFO,
        }
    }
    
    /// 运行时动态修改日志级别，立即生效无需重启
    pub fn set_level(&self, level: Level) -> Result<(), String> {
        let guard = self.reload_handle.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = guard.as_ref() {
            handle.modify(|filter| {
                *filter = EnvFilter::from_default_env().add_directive(level.into());
            }).map_err(|e| e.to_string())?;
            info!(target: "sys", module = "logging", "log level updated");
        }
        Ok(())
    }
    
    pub fn set_level_from_string(&self, level_str: &str) -> Result<(), String> {
        let level = Self::parse_level(level_str);
        self.set_level(level)
    }
}
