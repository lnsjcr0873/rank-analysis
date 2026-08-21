use serde::{Serialize, Serializer};
use thiserror::Error;

/// 应用程序全局错误枚举
#[derive(Error, Debug)]
pub enum AppError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Network error: {0}")]
    Reqwest(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("YAML error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("API Request failed: {0}")]
    ApiRequest(String),

    #[error("LCU API Error: {0}")]
    Lcu(String),

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Business logic error: {0}")]
    Business(String),

    #[error("System error: {0}")]
    System(String),
}

/// 实现 Serialize 以便可以通过 Tauri 命令返回给前端
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

/// 定义应用结果类型别名
pub type AppResult<T> = Result<T, AppError>;

/// 便捷宏，用于快速返回业务错误
#[macro_export]
macro_rules! app_err {
    ($($arg:tt)*) => {
        $crate::error::AppError::Business(format!($($arg)*))
    };
}
