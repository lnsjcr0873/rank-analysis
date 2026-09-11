//! # LCU 游戏阶段 API
//!
//! 对应 `lol-gameflow/v1/gameflow-phase`，返回当前阶段（如 ChampSelect、InProgress、EndOfGame 等）；带短时缓存。
//! WebSocket 事件可直接更新缓存，避免重复 HTTP 请求。

use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use crate::lcu::util::http::{auth_fingerprint, lcu_get_unthrottled};

#[derive(Debug, Clone)]
struct PhaseCache {
    last_phase: String,
    /// 产生该缓存时的 LCU 认证 (token 前缀, port)：客户端重启后端口/令牌变化，
    /// 沿用旧认证窗口内的缓存会返回上一局客户端的陈旧阶段（最长 2s）。
    auth_fingerprint: Option<(String, String)>,
    cached_at: Option<std::time::Instant>,
}

impl PhaseCache {
    fn new() -> Self {
        Self {
            last_phase: String::new(),
            auth_fingerprint: None,
            cached_at: None,
        }
    }

    /// 缓存是否仍可信：2 秒内且产生缓存时的认证未变。
    ///
    /// 拿不到当前认证（客户端未运行/刚退出）时直接不可信（debug3-C5）——
    /// 此前 `_ => true` 只信时间窗，客户端退出 2 秒内频繁 get_phase 会返回
    /// 最后一次缓存阶段（"InProgress" 幽灵），前端被踢入对局残留页。
    fn is_valid(&self, now_auth: &Option<(String, String)>) -> bool {
        let Some(cached_at) = self.cached_at else {
            return false;
        };
        if cached_at.elapsed() > Duration::from_millis(2000) {
            return false;
        }
        match (&self.auth_fingerprint, now_auth) {
            (Some(a), Some(b)) => a == b,
            // 无当前认证 = 客户端不在，任何缓存都不可信
            _ => false,
        }
    }
}

static PHASE_CACHE: LazyLock<Mutex<PhaseCache>> = LazyLock::new(|| Mutex::new(PhaseCache::new()));

/// 对已毒化的 Mutex 恢复：取回内部值继续使用。
///
/// phase 缓存被自动化/监控/会话流水线高频共享，任何一处持锁 panic 都会让
/// 后续 `lock().unwrap()` 级联中毒；这里与 lcu/util/http.rs 同款兜底。
fn lock_or_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// LCU gameflow 已知阶段白名单（见 `crate::constant::game::{...}`）。
///
/// WS 事件 data 若携带未知字符串（协议外/损坏帧），拒绝写入缓存，
/// 避免 `get_phase` 在 2s 窗口内返回毒化阶段（debug4-2 纵深防御；
/// URI 校验本身在 `listener.rs::handle_event` 已存在）。
fn is_known_phase(phase: &str) -> bool {
    use crate::constant::game;
    matches!(
        phase,
        game::MATCHMAKING
            | game::CHAMPSELECT
            | game::READYCHECK
            | game::INPROGRESS
            | game::ENDOFGAME
            | game::LOBBY
            | game::GAMESTART
            | game::NONE
            | game::RECONNECT
            | game::WAITINGFORSTATS
            | game::PREENDOFGAME
            | game::WATCHINPROGRESS
            | game::TERMINATEDINERROR
    )
}

/// 更新 phase 缓存（供 WebSocket 事件调用）。
///
/// 未知阶段值直接拒绝并告警，不污染缓存。
pub fn update_phase_cache(phase: String) {
    if !is_known_phase(&phase) {
        log::warn!("Phase cache 拒绝未知阶段值: {phase:?}（疑似污染/协议外帧）");
        return;
    }
    let fingerprint = auth_fingerprint();
    let mut cache = lock_or_recover(&PHASE_CACHE);
    cache.last_phase = phase;
    cache.auth_fingerprint = fingerprint;
    cache.cached_at = Some(std::time::Instant::now());
    log::debug!("Phase cache updated via WebSocket: {}", cache.last_phase);
}

/// 主动失效 phase 缓存（客户端退出/认证轮换感知时调用）。
///
/// `get_phase` 无认证时已不再信任缓存（见 `is_valid`），此函数供明确知道
/// "旧阶段已死"的调用方（token 层认证失败、退出钩子）立即清掉，避免等 2s 窗口。
pub fn invalidate_phase_cache() {
    let mut cache = lock_or_recover(&PHASE_CACHE);
    cache.cached_at = None;
    cache.auth_fingerprint = None;
    log::debug!("Phase cache invalidated");
}

/// 获取当前游戏流程阶段（2 秒内且认证未变时使用缓存）。
pub async fn get_phase() -> Result<String, String> {
    // 认证指纹在锁外取（auth_fingerprint 内部有自己的锁，避免嵌套）
    let now_auth = auth_fingerprint();
    {
        let cache = lock_or_recover(&PHASE_CACHE);
        if cache.is_valid(&now_auth) {
            return Ok(cache.last_phase.clone());
        }
    }

    // 获取新的阶段（使用 unthrottled 保证探针与状态检测不被批量请求限流队列阻塞）
    let uri = "lol-gameflow/v1/gameflow-phase";
    let phase = match lcu_get_unthrottled::<String>(uri).await {
        Ok(p) => p,
        Err(e) => {
            // LCU 已死/不可达：缓存若残留旧阶段就是"幽灵对局"，立即失效，
            // 下次 get_phase 直接走 Err，不再返回陈旧 InProgress。
            invalidate_phase_cache();
            return Err(e);
        }
    };
    // 更新缓存
    {
        let mut cache = lock_or_recover(&PHASE_CACHE);
        cache.last_phase = phase.clone();
        cache.auth_fingerprint = now_auth;
        cache.cached_at = Some(std::time::Instant::now());
    }

    Ok(phase)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fp() -> Option<(String, String)> {
        Some(("tok".to_string(), "1234".to_string()))
    }

    #[test]
    fn cache_without_auth_is_never_valid() {
        // debug3-C5：客户端未运行时（无认证指纹），任何缓存都不可信——
        // 此前 `_ => true` 只信时间窗，退出 2 秒内返回幽灵 InProgress。
        let mut c = PhaseCache::new();
        c.last_phase = "InProgress".to_string();
        c.auth_fingerprint = fp();
        c.cached_at = Some(std::time::Instant::now());
        assert!(!c.is_valid(&None));
    }

    #[test]
    fn cache_with_same_auth_is_valid_within_window() {
        let mut c = PhaseCache::new();
        c.last_phase = "ChampSelect".to_string();
        c.auth_fingerprint = fp();
        c.cached_at = Some(std::time::Instant::now());
        assert!(c.is_valid(&fp()));
    }

    #[test]
    fn cache_rejects_changed_auth() {
        let mut c = PhaseCache::new();
        c.last_phase = "ChampSelect".to_string();
        c.auth_fingerprint = fp();
        c.cached_at = Some(std::time::Instant::now());
        let other = Some(("newtok".to_string(), "5678".to_string()));
        assert!(!c.is_valid(&other));
    }

    #[test]
    fn known_phases_cover_gameflow_set() {
        // 白名单必须覆盖 gameflow 全部合法阶段（debug4-2）
        for p in [
            "Matchmaking",
            "ChampSelect",
            "ReadyCheck",
            "InProgress",
            "EndOfGame",
            "Lobby",
            "GameStart",
            "None",
            "Reconnect",
            "WaitingForStats",
            "PreEndOfGame",
            "WatchInProgress",
            "TerminatedInError",
        ] {
            assert!(is_known_phase(p), "{p} 应为已知阶段");
        }
        assert!(!is_known_phase(""));
        assert!(!is_known_phase("some random chat text"));
        assert!(!is_known_phase("champselect"));
    }

    #[test]
    fn update_rejects_unknown_phase() {
        // 未知值不得污染缓存：写入后缓存仍不可信（cached_at 为 None）
        update_phase_cache("恶意污染文本".to_string());
        let cache = lock_or_recover(&PHASE_CACHE);
        assert!(!cache.is_valid(&fp()));
    }

    #[test]
    fn invalidate_clears_cache() {
        {
            let mut cache = lock_or_recover(&PHASE_CACHE);
            cache.last_phase = "InProgress".to_string();
            cache.auth_fingerprint = fp();
            cache.cached_at = Some(std::time::Instant::now());
        }
        invalidate_phase_cache();
        let cache = lock_or_recover(&PHASE_CACHE);
        assert!(!cache.is_valid(&fp()));
        assert!(!cache.is_valid(&None));
    }
}
