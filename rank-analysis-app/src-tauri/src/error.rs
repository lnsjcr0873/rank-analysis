//! 类型化错误体系（T11 首批）。
//!
//! 替代高频命令的 `Result<T, String>`：前端按 `code` 分支处理，
//! 不再对错误文案做字符串猜测。
//!
//! # 序列化形状
//! 固定 `{"code": "...", "message": "..."}`（自定义 Serialize / Deserialize，
//! Tauri command 的错误 JSON 即此形状传前端；`message` 字段保留，前端既有
//! `catch (e) → e?.message` 读取路径不受影响）。`message` 取 thiserror Display：
//! - 单元变体（LcuNotRunning / TokenExpired）→ 固定描述，由 `code` 分支驱动 UI 动作
//! - 数据变体 → 携带原始细节（上游状态码 / 原始错误文案）
//!
//! # 变体
//! - `LcuNotRunning`: 客户端未运行或无法定位
//! - `TokenExpired`: LCU 认证（token/port）过期或拿不到有效凭证
//! - `UpstreamHttp { status, hint }`: 外部服务（OP.GG / LMS 等）非 2xx
//! - `NotFound { what }`: 资源不存在
//! - `Unsupported(String)`: 不支持的操作 / 非法参数
//! - `Internal(String)`: 内部错误（兜底）
//!
//! 后续批次迁移清单（仍为 `Result<T, String>`，按前端调用频次排序）：
//! - get_fandom 系：update_fandom_data / get_aram_balance / get_champion_patch_note
//! - opgg 查询系：get_champion_meta / get_lane_counters / get_opgg_status / get_champion_intel
//! - rank 系：get_rank_by_name / get_rank_by_puuid / get_ranks_by_puuids / get_win_rate_by_*
//! - get_match_history_by_name / get_game_by_id
//! - sgp / cloud_sync / replay / launcher / system 等

use serde::ser::SerializeStruct;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// 高频命令的类型化错误（见模块文档的序列化形状与变体说明）。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AppError {
    /// 客户端未运行或无法定位（用户动作：启动客户端）
    #[error("英雄联盟客户端未运行或无法连接")]
    LcuNotRunning,

    /// LCU 认证过期 / 拿不到有效凭证（用户动作：重登客户端或提权重启）
    #[error("LCU 认证信息已过期或无效")]
    TokenExpired,

    /// 外部服务（OP.GG / LMS 等）返回非 2xx
    #[error("上游请求失败 (HTTP {status}): {hint}")]
    UpstreamHttp { status: u16, hint: String },

    /// 资源不存在（如 puuid 查不到召唤师）
    #[error("未找到: {what}")]
    NotFound { what: String },

    /// 不支持的操作 / 非法参数（如 OP.GG 模式不在白名单、索引越界）
    #[error("不支持: {0}")]
    Unsupported(String),

    /// 内部错误（兜底）
    #[error("内部错误: {0}")]
    Internal(String),
}

impl AppError {
    /// 错误码（wire 的 `code` 字段，前端分支依据）。
    pub fn code(&self) -> &'static str {
        match self {
            AppError::LcuNotRunning => "LCU_NOT_RUNNING",
            AppError::TokenExpired => "TOKEN_EXPIRED",
            AppError::UpstreamHttp { .. } => "UPSTREAM_HTTP",
            AppError::NotFound { .. } => "NOT_FOUND",
            AppError::Unsupported(_) => "UNSUPPORTED",
            AppError::Internal(_) => "INTERNAL",
        }
    }

    /// 把 **LCU 层**旧 String 错误归一为类型化错误。
    ///
    /// 依据 `lcu/util/http.rs` + `token.rs::AuthError::Display` 的既定文案：
    /// - `LCU认证失败: 未找到英雄联盟客户端进程` → `LcuNotRunning`
    /// - 其余含"认证"的（`LCU认证失败: ...管理员...` / `请求失败或认证失效`）→ `TokenExpired`
    ///   （客户端在运行但拿不到可用凭证；已知宽松点：提权场景也归此码，
    ///   message 由调用方另带原始文案时可自行细化）
    pub fn from_lcu_string(s: String) -> Self {
        if s.contains("未找到英雄联盟客户端进程") {
            AppError::LcuNotRunning
        } else if s.contains("认证") {
            AppError::TokenExpired
        } else {
            AppError::Internal(s)
        }
    }

    /// 把 **外部 HTTP 层 / 参数校验**旧 String 错误归一为类型化错误。
    ///
    /// - `external GET non-2xx: {status} {hint}`（http.rs 外部 GET）→ `UpstreamHttp`
    /// - `invalid opgg mode: ...` / 索引越界等参数类 → `Unsupported`
    /// - 其余 → `Internal`（原文保留在 detail）
    pub fn from_upstream_string(s: String) -> Self {
        if let Some(rest) = s.strip_prefix("external GET non-2xx: ") {
            let (status, hint) = match rest.split_once(' ') {
                Some((st, h)) => (st.parse::<u16>().unwrap_or(0), h.to_string()),
                None => (0, rest.to_string()),
            };
            return AppError::UpstreamHttp { status, hint };
        }
        if s.starts_with("invalid opgg mode") {
            return AppError::Unsupported(s);
        }
        AppError::Internal(s)
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", self.to_string())?;
        s.end()
    }
}

/// wire 形状 `{"code", "message"}`（见模块文档）。
#[derive(Deserialize)]
struct AppErrorWire {
    code: String,
    #[serde(default)]
    message: String,
}

impl<'de> Deserialize<'de> for AppError {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let w = AppErrorWire::deserialize(d)?;
        Ok(match w.code.as_str() {
            "LCU_NOT_RUNNING" => AppError::LcuNotRunning,
            "TOKEN_EXPIRED" => AppError::TokenExpired,
            // wire 形状固定 code/message，status 不单独携带——
            // 反解时置 0，提示文案取 message（有损往返，仅用于测试/调试回读）
            "UPSTREAM_HTTP" => AppError::UpstreamHttp {
                status: 0,
                hint: w.message,
            },
            "NOT_FOUND" => AppError::NotFound { what: w.message },
            "UNSUPPORTED" => AppError::Unsupported(w.message),
            _ => AppError::Internal(w.message),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 每个变体的 wire 形状：恰好 {"code", "message"} 两字段，值可预期。
    #[test]
    fn serde_shape_per_variant() {
        assert_eq!(
            serde_json::to_value(AppError::LcuNotRunning).unwrap(),
            json!({"code": "LCU_NOT_RUNNING", "message": "英雄联盟客户端未运行或无法连接"})
        );
        assert_eq!(
            serde_json::to_value(AppError::TokenExpired).unwrap(),
            json!({"code": "TOKEN_EXPIRED", "message": "LCU 认证信息已过期或无效"})
        );
        let upstream = AppError::UpstreamHttp {
            status: 429,
            hint: "Too Many Requests".into(),
        };
        assert_eq!(
            serde_json::to_value(upstream).unwrap(),
            json!({"code": "UPSTREAM_HTTP", "message": "上游请求失败 (HTTP 429): Too Many Requests"})
        );
        assert_eq!(
            serde_json::to_value(AppError::NotFound {
                what: "召唤师".into()
            })
            .unwrap(),
            json!({"code": "NOT_FOUND", "message": "未找到: 召唤师"})
        );
        assert_eq!(
            serde_json::to_value(AppError::Unsupported("mode: x".into())).unwrap(),
            json!({"code": "UNSUPPORTED", "message": "不支持: mode: x"})
        );
        assert_eq!(
            serde_json::to_value(AppError::Internal("boom".into())).unwrap(),
            json!({"code": "INTERNAL", "message": "内部错误: boom"})
        );
    }

    /// code() 与 wire code 一致，且六个变体互不相同。
    #[test]
    fn codes_are_stable_and_unique() {
        let errs = [
            AppError::LcuNotRunning,
            AppError::TokenExpired,
            AppError::UpstreamHttp {
                status: 0,
                hint: String::new(),
            },
            AppError::NotFound {
                what: String::new(),
            },
            AppError::Unsupported(String::new()),
            AppError::Internal(String::new()),
        ];
        let codes: Vec<&str> = errs.iter().map(|e| e.code()).collect();
        assert_eq!(
            codes.len(),
            codes
                .into_iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
        );
    }

    /// 往返：单元变体无损；数据变体 code 保持（UpstreamHttp.status 有损置 0）。
    #[test]
    fn round_trip() {
        for e in [
            AppError::LcuNotRunning,
            AppError::TokenExpired,
            AppError::NotFound { what: "x".into() },
            AppError::Unsupported("x".into()),
            AppError::Internal("x".into()),
        ] {
            let s = serde_json::to_string(&e).unwrap();
            let back: AppError = serde_json::from_str(&s).unwrap();
            assert_eq!(back, e);
        }
        let upstream = AppError::UpstreamHttp {
            status: 429,
            hint: "Too Many Requests".into(),
        };
        let s = serde_json::to_string(&upstream).unwrap();
        let back: AppError = serde_json::from_str(&s).unwrap();
        assert_eq!(back.code(), "UPSTREAM_HTTP");
        // status 有损：反解后为 0，仅 hint（取 message）保留
        match back {
            AppError::UpstreamHttp { status, hint } => {
                assert_eq!(status, 0);
                assert!(hint.contains("429"));
            }
            _ => panic!("expected UpstreamHttp"),
        }
    }

    /// 未知 code 归 Internal（前向兼容：后端新增变体时旧客户端不崩）。
    #[test]
    fn unknown_code_falls_back_to_internal() {
        let back: AppError =
            serde_json::from_str(r#"{"code":"SOMETHING_NEW","message":"m"}"#).unwrap();
        assert_eq!(back, AppError::Internal("m".into()));
    }

    /// LCU 层分类：未运行 / 认证 / 其余兜底。
    #[test]
    fn from_lcu_string_classification() {
        assert_eq!(
            AppError::from_lcu_string("LCU认证失败: 未找到英雄联盟客户端进程".into()),
            AppError::LcuNotRunning
        );
        assert_eq!(
            AppError::from_lcu_string("请求失败或认证失效".into()),
            AppError::TokenExpired
        );
        assert_eq!(
            AppError::from_lcu_string(
                "LCU认证失败: 检测到客户端进程但无权读取（疑似游戏以管理员身份运行）".into()
            ),
            AppError::TokenExpired
        );
        assert_eq!(
            AppError::from_lcu_string("读取响应失败: io".into()),
            AppError::Internal("读取响应失败: io".into())
        );
    }

    /// 外部层分类：non-2xx 提状态码 / 参数类 Unsupported / 其余兜底。
    #[test]
    fn from_upstream_string_classification() {
        assert_eq!(
            AppError::from_upstream_string("external GET non-2xx: 429 Too Many Requests".into()),
            AppError::UpstreamHttp {
                status: 429,
                hint: "Too Many Requests".into()
            }
        );
        assert_eq!(
            AppError::from_upstream_string("invalid opgg mode: x (expected ranked|aram)".into()),
            AppError::Unsupported("invalid opgg mode: x (expected ranked|aram)".into())
        );
        assert_eq!(
            AppError::from_upstream_string("external JSON 反序列化失败: x".into()),
            AppError::Internal("external JSON 反序列化失败: x".into())
        );
    }
}
