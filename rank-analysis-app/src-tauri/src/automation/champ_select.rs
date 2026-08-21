use std::sync::Arc;
use std::time::Duration;
use tokio::time::interval;

use crate::config::{extract_bool, get_config, Value};
use crate::constant::game::CHAMPSELECT;
use crate::lcu::api::champion_select::get_champion_select_session;
use crate::lcu::api::phase::get_phase;
use crate::opgg::data::OpggSnapshot;

/// 默认执行阈值：剩余降到该秒数时执行锁定。
pub const DEFAULT_EXECUTE_AT_SECS_LEFT: f64 = 5.0;

/// 剩余不足该秒数时放弃本次自动执行，避免半吊子状态。
pub const MIN_EXECUTE_SECS: f64 = 3.0;

/// bench 换人冷却：锁定后决策变化引发的换人至少间隔这么久，
/// 防止「双维推荐在多个目标间震荡」时把 LCU 的换人窗口刷穿。
pub const BENCH_SWAP_COOLDOWN: Duration = Duration::from_secs(30);

/// 上次 bench 换人的时刻（None = 未换过/已离场重置）。执行侧粘性状态，
/// 离开选人阶段由 [`reset_execution_state`] 清空。
static LAST_BENCH_SWAP: std::sync::OnceLock<std::sync::Mutex<Option<std::time::Instant>>> =
    std::sync::OnceLock::new();

/// 取 bench 换人冷却状态：不存在时惰性创建。
pub fn last_bench_swap() -> &'static std::sync::Mutex<Option<std::time::Instant>> {
    LAST_BENCH_SWAP.get_or_init(|| std::sync::Mutex::new(None))
}

/// 符文页规则：英雄 ID → 目标页名。
#[derive(Debug, Clone, PartialEq)]
pub struct RuneRule {
    pub champion_id: i32,
    pub page_name: String,
}

/// 已应用的符文切换（None = 本局未应用/已离场重置）。
///
/// 记录 `(champion_id, page_id)`：同一个英雄在同一次选人里只切一次，
/// 避免 `pages` 列表在 LCU 侧偶发抖动时反复 PUT。
static LAST_RUNE_APPLIED: std::sync::OnceLock<std::sync::Mutex<Option<(i32, i64)>>> =
    std::sync::OnceLock::new();

pub fn last_rune_applied() -> &'static std::sync::Mutex<Option<(i32, i64)>> {
    LAST_RUNE_APPLIED.get_or_init(|| std::sync::Mutex::new(None))
}

/// 自动选择英雄任务。
pub async fn start_champion_select_automation() {
    log::info!("Starting champion select automation");
    let mut ticker = interval(Duration::from_secs(1));

    loop {
        ticker.tick().await;

        let cur_phase = match get_phase().await {
            Ok(phase) => phase,
            Err(e) => {
                log::error!("Get phase error: {}", e);
                continue;
            }
        };

        if cur_phase != CHAMPSELECT {
            // 离场即重置执行侧粘性状态（bench 换人冷却），防止跨局生效
            reset_execution_state();
            continue;
        }

        log::info!("In champion select phase, starting champion selection");
        if let Err(e) = start_select_champion().await {
            log::error!("Select champion error: {}", e);
        }
    }
}

/// 纯函数：将 config::Value 解析为 PickRule 列表。
pub fn parse_pick_rules_value(value: &Value) -> Vec<crate::command::rule_config::PickRule> {
    use crate::command::rule_config::PickRule;
    let json = match serde_json::to_value(value) {
        Ok(j) => j,
        Err(e) => {
            log::warn!("Failed to bridge pickRules config Value -> JSON: {}", e);
            return vec![];
        }
    };
    let inner = json.get("value").cloned().unwrap_or(json);
    if !inner.is_array() {
        return vec![];
    }
    serde_json::from_value::<Vec<PickRule>>(inner).unwrap_or_else(|e| {
        log::warn!("Failed to parse pickRules from config: {}", e);
        vec![]
    })
}

/// 纯函数：将 config::Value 解析为 BanRule 列表。
pub fn parse_ban_rules_value(value: &Value) -> Vec<crate::command::rule_config::BanRule> {
    use crate::command::rule_config::BanRule;
    let json = match serde_json::to_value(value) {
        Ok(j) => j,
        Err(e) => {
            log::warn!("Failed to bridge banRules config Value -> JSON: {}", e);
            return vec![];
        }
    };
    let inner = json.get("value").cloned().unwrap_or(json);
    if !inner.is_array() {
        return vec![];
    }
    serde_json::from_value::<Vec<BanRule>>(inner).unwrap_or_else(|e| {
        log::warn!("Failed to parse banRules from config: {}", e);
        vec![]
    })
}

/// 从配置中读取 pickRules 列表。
pub async fn load_pick_rules() -> Vec<crate::command::rule_config::PickRule> {
    match get_config("settings.auto.pickRules").await {
        Ok(v) => parse_pick_rules_value(&v),
        Err(_) => vec![],
    }
}

/// 从配置中读取 banRules 列表。
pub async fn load_ban_rules() -> Vec<crate::command::rule_config::BanRule> {
    match get_config("settings.auto.banRules").await {
        Ok(v) => parse_ban_rules_value(&v),
        Err(_) => vec![],
    }
}

/// 执行英雄选择操作。
pub async fn start_select_champion() -> Result<(), String> {
    let select_session = get_champion_select_session().await?;
    let Some(decision) = crate::bp_decision::store::read() else {
        log::debug!("No BP decision snapshot yet, skipping this tick");
        return Ok(());
    };
    if decision.action_type != crate::bp_decision::types::BpActionType::Pick {
        return Ok(());
    }
    apply_bp_decision(&select_session, &decision).await
}

/// 自动确认英雄交易请求（P1-2）。
pub async fn start_trade_automation() {
    log::info!("Starting trade automation");
    let mut ticker = interval(Duration::from_secs(2));

    loop {
        ticker.tick().await;

        let cur_phase = match get_phase().await {
            Ok(phase) => phase,
            Err(e) => {
                log::error!("Get phase error: {}", e);
                continue;
            }
        };
        if cur_phase != CHAMPSELECT {
            continue;
        }

        let session = match crate::lcu::api::champion_select::get_champion_select_session().await {
            Ok(s) => s,
            Err(e) => {
                log::error!("Trade check session error: {}", e);
                continue;
            }
        };
        for trade in &session.trades {
            if trade.state == "AVAILABLE" && trade.cell_id != session.local_player_cell_id {
                log::info!(
                    "BP trade auto-accept: trade={} from_cell={} champion={}",
                    trade.id,
                    trade.cell_id,
                    trade.champion_id
                );
                if let Err(e) = crate::lcu::api::champion_select::accept_trade(trade.id).await {
                    log::warn!("BP trade accept failed (可能已处理): {}", e);
                }
            }
        }
    }
}

/// 退出选人阶段后重置执行侧粘性状态（冷却计时器等），避免跨局失效。
pub fn reset_execution_state() {
    let mut guard = last_bench_swap().lock().unwrap_or_else(|e| e.into_inner());
    *guard = None;
    let mut applied = last_rune_applied()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    *applied = None;
}

/// 自动禁用英雄任务。
pub async fn start_champion_ban_automation() {
    log::info!("Starting champion ban automation");
    let mut ticker = interval(Duration::from_secs(1));

    loop {
        ticker.tick().await;

        let cur_phase = match get_phase().await {
            Ok(phase) => phase,
            Err(e) => {
                log::error!("Get phase error: {}", e);
                continue;
            }
        };

        if cur_phase != CHAMPSELECT {
            continue;
        }

        log::info!("In champion select phase, starting champion ban");
        if let Err(e) = start_ban_champion().await {
            log::error!("Ban champion error: {}", e);
        }
    }
}

/// 自动符文（P1-3）：依据「英雄 → 符文页」映射自动切换。
pub async fn start_rune_automation() {
    log::info!("Starting rune page automation");
    let mut ticker = interval(Duration::from_secs(2));

    loop {
        ticker.tick().await;

        let cur_phase = match get_phase().await {
            Ok(phase) => phase,
            Err(e) => {
                log::error!("Get phase error: {}", e);
                continue;
            }
        };
        if cur_phase != CHAMPSELECT {
            continue;
        }

        if let Err(e) = apply_rune_page_if_needed().await {
            log::debug!("Rune page check error (非致命): {}", e);
        }
    }
}

/// 纯函数：从 `config::Value` 解析符文规则列表。
pub fn parse_rune_rules_value(value: &Value) -> Vec<RuneRule> {
    let json = match serde_json::to_value(value) {
        Ok(j) => j,
        Err(e) => {
            log::warn!("Failed to bridge runeRules config Value -> JSON: {}", e);
            return vec![];
        }
    };
    let inner = json.get("value").cloned().unwrap_or(json);
    let Some(rows) = inner.as_array() else {
        return vec![];
    };
    let mut rules = Vec::new();
    for row in rows {
        let Some(champion_id) = row.get("championId").and_then(|v| v.as_i64()) else {
            continue;
        };
        let Some(page_name) = row.get("pageName").and_then(|v| v.as_str()) else {
            continue;
        };
        let page_name = page_name.trim().to_string();
        if page_name.is_empty() || champion_id <= 0 {
            continue;
        }
        rules.push(RuneRule {
            champion_id: champion_id as i32,
            page_name,
        });
    }
    rules
}

pub async fn load_rune_rules() -> Vec<RuneRule> {
    match get_config("settings.auto.runeRules").await {
        Ok(v) => parse_rune_rules_value(&v),
        Err(_) => vec![],
    }
}

/// 锁定英雄已确定时按规则切符文页；不可用（无规则/页面不匹配/已切过）静默跳过。
pub async fn apply_rune_page_if_needed() -> Result<(), String> {
    let session = crate::lcu::api::champion_select::get_champion_select_session().await?;
    let Some(my_champion) = my_locked_champion(&session) else {
        return Ok(());
    };

    let rules = load_rune_rules().await;
    if rules.is_empty() {
        return Ok(());
    }
    let Some(rule) = rules.iter().find(|r| r.champion_id == my_champion) else {
        return Ok(());
    };

    let pages = crate::lcu::api::perks::get_perk_pages().await?;
    let Some(page) = crate::lcu::api::perks::find_page_by_name(&pages, &rule.page_name) else {
        log::info!(
            "Rune rule for champion {} wants page '{}' but no such page exists",
            my_champion,
            rule.page_name
        );
        return Ok(());
    };

    {
        let guard = last_rune_applied()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if *guard == Some((my_champion, page.id)) {
            return Ok(());
        }
    }

    let current_id = crate::lcu::api::perks::get_current_perk_page_id().await?;
    if current_id == page.id {
        let mut guard = last_rune_applied()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *guard = Some((my_champion, page.id));
        return Ok(());
    }

    log::info!(
        "Rune page switch: champion {} -> page {} ('{}', was {})",
        my_champion,
        page.id,
        page.name,
        current_id
    );
    crate::lcu::api::perks::set_current_perk_page(page.id).await?;
    let mut guard = last_rune_applied()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    *guard = Some((my_champion, page.id));
    Ok(())
}

/// 我方已锁定英雄：本地玩家格子的已完成 pick 动作。
pub fn my_locked_champion(
    session: &crate::lcu::api::champion_select::SelectSession,
) -> Option<i32> {
    session.actions.iter().flatten().find_map(|a| {
        if a.actor_cell_id == session.local_player_cell_id
            && a.action_type == "pick"
            && a.completed
            && a.champion_id > 0
        {
            Some(a.champion_id)
        } else {
            None
        }
    })
}

/// 根据分路信息推断该用哪份 OP.GG 数据。
pub fn opgg_mode_for(my_position: Option<crate::command::rule_config::Position>) -> &'static str {
    if my_position.is_some() {
        "ranked"
    } else {
        "aram"
    }
}

/// 从配置读取一个英雄 ID 列表，兼容 `{ "value": [...] }` 与裸数组两种历史形态。
pub async fn load_champion_pool(key: &str) -> Vec<i32> {
    let to_ids = |list: &Vec<Value>| -> Vec<i32> {
        list.iter()
            .filter_map(|v| match v {
                Value::Integer(i) => Some(*i as i32),
                _ => None,
            })
            .collect()
    };
    match get_config(key).await {
        Ok(Value::Map(m)) => match m.get("value") {
            Some(Value::List(list)) => to_ids(list),
            _ => vec![],
        },
        Ok(Value::List(list)) => to_ids(&list),
        _ => vec![],
    }
}

pub async fn load_pick_pool() -> Vec<i32> {
    load_champion_pool("settings.auto.pickChampionSlice").await
}

pub async fn load_ban_pool() -> Vec<i32> {
    load_champion_pool("settings.auto.banChampionSlice").await
}

/// 相位执行时刻（剩余秒数）, `settings.auto.executeAtSecs` 可调（P1-2）。
pub async fn load_execute_at_secs() -> f64 {
    const FLOOR: f64 = 3.0;
    const CEIL: f64 = 35.0;
    let extract = |v: &Value| -> Option<f64> {
        match v {
            Value::Integer(i) => Some(*i as f64),
            Value::Float(f) => Some(*f),
            Value::Map(m) => m.get("value").and_then(|inner| match inner {
                Value::Integer(i) => Some(*i as f64),
                Value::Float(f) => Some(*f),
                _ => None,
            }),
            _ => None,
        }
    };
    match get_config("settings.auto.executeAtSecs").await {
        Ok(v) => extract(&v)
            .map(|n| n.clamp(FLOOR, CEIL))
            .unwrap_or(DEFAULT_EXECUTE_AT_SECS_LEFT),
        Err(_) => DEFAULT_EXECUTE_AT_SECS_LEFT,
    }
}

/// BP 决策快照的常驻求值任务。
pub async fn start_bp_decision_automation(app: tauri::AppHandle) {
    use crate::bp_decision::{evaluate, store, types::BpMode};
    use tauri::Manager;

    log::info!("Starting BP decision evaluation (always-on)");
    let mut ticker = interval(Duration::from_secs(2));

    let mut opgg_cache: Option<(String, Option<Arc<OpggSnapshot>>)> = None;

    loop {
        ticker.tick().await;

        let cur_phase = match get_phase().await {
            Ok(p) => p,
            Err(_) => continue,
        };
        if cur_phase != CHAMPSELECT {
            store::reset();
            opgg_cache = None;
            continue;
        }

        let session = match get_champion_select_session().await {
            Ok(s) => s,
            Err(e) => {
                log::debug!("BP decision: no champ select session: {}", e);
                continue;
            }
        };
        let my_summoner = match crate::lcu::api::summoner::Summoner::get_my_summoner().await {
            Ok(s) => s,
            Err(e) => {
                log::debug!("BP decision: cannot resolve my summoner: {}", e);
                continue;
            }
        };

        let my_position = crate::rule_engine::detect_my_position(&session, &my_summoner.puuid);
        let opgg_mode = opgg_mode_for(my_position);
        let snapshot = match &opgg_cache {
            Some((cached_mode, cached_snapshot)) if cached_mode == opgg_mode => {
                cached_snapshot.clone()
            }
            _ => {
                let snap = crate::command::opgg::ensure_opgg_snapshot(
                    &app.state::<crate::state::AppState>(),
                    opgg_mode,
                )
                .await
                .ok()
                .map(|(snap, _stale)| snap);
                opgg_cache = Some((opgg_mode.to_string(), snap.clone()));
                snap
            }
        };

        let pick_rules = load_pick_rules().await;
        let ban_rules = load_ban_rules().await;
        let pick_pool = load_pick_pool().await;
        let ban_pool = load_ban_pool().await;

        let pick_on = switch_enabled("settings.auto.pickChampionSwitch").await;
        let ban_on = switch_enabled("settings.auto.banChampionSwitch").await;

        let pending = evaluate::find_my_pending_action(&session);
        let pending_is_ban = pending
            .map(|p| p.action_type == crate::bp_decision::types::BpActionType::Ban)
            .unwrap_or(false);
        let mode = if (pending_is_ban && ban_on) || (!pending_is_ban && pick_on) {
            BpMode::Auto
        } else {
            BpMode::Advisory
        };

        let ctx = evaluate::BpContext {
            session: &session,
            my_puuid: &my_summoner.puuid,
            pick_rules: &pick_rules,
            ban_rules: &ban_rules,
            pick_pool: &pick_pool,
            ban_pool: &ban_pool,
            snapshot: snapshot.as_deref(),
            mode,
            execute_at_secs_left: load_execute_at_secs().await,
            last_hovered: store::last_hovered(),
        };
        let mut decision = evaluate::evaluate_bp_decision(&ctx);
        if let (Some(d), Some(p)) = (decision.as_mut(), pending) {
            d.user_overridden = d.user_overridden || store::is_overridden(p.action_id);
        }
        record_pending_for(decision.as_ref(), my_position, &session);
        store::write(decision);
    }
}

pub fn position_key(p: crate::command::rule_config::Position) -> &'static str {
    use crate::command::rule_config::Position;
    match p {
        Position::Top => "TOP",
        Position::Jungle => "JUNGLE",
        Position::Middle => "MIDDLE",
        Position::Bottom => "BOTTOM",
        Position::Utility => "UTILITY",
    }
}

pub fn record_pending_for(
    decision: Option<&crate::bp_decision::types::BpDecision>,
    my_position: Option<crate::command::rule_config::Position>,
    session: &crate::lcu::api::champion_select::SelectSession,
) {
    use crate::backtest::store::{record_pending_suggestion, PendingSuggestion};
    use crate::bp_decision::types::BpActionType;
    let Some(decision) = decision else { return };
    let Some(target) = decision.target.as_ref() else {
        return;
    };
    if decision.action_type != BpActionType::Pick {
        return;
    }
    let Some(position) = my_position else { return };
    let enemy = session
        .their_team
        .iter()
        .find(|p| {
            p.champion_id != 0
                && crate::rule_engine::parse_position(&p.assigned_position) == Some(position)
        })
        .map(|p| p.champion_id);
    let suggested_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    record_pending_suggestion(&PendingSuggestion {
        suggested_at_ms,
        suggestion_champion_id: target.champion_id,
        position: position_key(position).to_string(),
        enemy_champion_id: enemy,
        game_id: None,
    });
}

pub const BAN_HOVER_ENABLED: bool = false;

pub fn should_act(d: &crate::bp_decision::types::BpDecision) -> bool {
    d.mode == crate::bp_decision::types::BpMode::Auto && !d.user_overridden
}

pub fn should_lock(
    d: &crate::bp_decision::types::BpDecision,
    time_left_secs: f64,
    is_in_progress: bool,
) -> bool {
    let Some(t) = d.target.as_ref() else {
        return false;
    };
    is_in_progress
        && t.lock
        && time_left_secs <= d.execute_at_secs_left
        && time_left_secs >= MIN_EXECUTE_SECS
}

pub async fn apply_bp_decision(
    session: &crate::lcu::api::champion_select::SelectSession,
    decision: &crate::bp_decision::types::BpDecision,
) -> Result<(), String> {
    use crate::bp_decision::{evaluate, store, types::BpActionType};

    if decision.action_type == BpActionType::Pick && should_act(decision) {
        let locked = session
            .actions
            .iter()
            .flatten()
            .find(|a| {
                a.actor_cell_id == session.local_player_cell_id
                    && a.action_type == "pick"
                    && a.completed
                    && a.champion_id > 0
            })
            .map(|a| a.champion_id);
        if let Some(locked_id) = locked {
            if let Some(target) = decision.target.as_ref() {
                if target.champion_id != locked_id
                    && session.bench_champions.contains(&target.champion_id)
                {
                    let can_swap = {
                        let mut guard = last_bench_swap().lock().unwrap_or_else(|e| e.into_inner());
                        match *guard {
                            Some(at) if at.elapsed() >= BENCH_SWAP_COOLDOWN => {
                                *guard = Some(std::time::Instant::now());
                                true
                            }
                            Some(_) => false,
                            None => {
                                *guard = Some(std::time::Instant::now());
                                true
                            }
                        }
                    };
                    if can_swap {
                        log::info!(
                            "BP bench swap: locked {} -> target {}",
                            locked_id,
                            target.champion_id
                        );
                        crate::lcu::api::champion_select::swap_bench_champion(target.champion_id)
                            .await?;
                    }
                    return Ok(());
                }
            }
        }
    }

    let Some(pending) = evaluate::find_my_pending_action(session) else {
        return Ok(());
    };

    if decision.action_type != pending.action_type {
        return Ok(());
    }

    if evaluate::detect_override(pending.champion_id, store::last_hovered()) {
        store::mark_overridden(pending.action_id);
    }
    if store::is_overridden(pending.action_id) || !should_act(decision) {
        return Ok(());
    }

    let Some(target) = decision.target.as_ref() else {
        return Ok(());
    };
    let action_type = match pending.action_type {
        BpActionType::Ban => "ban",
        BpActionType::Pick => "pick",
    };

    // ---- hover 同步 ----
    let hover_allowed = pending.action_type == BpActionType::Pick || BAN_HOVER_ENABLED;
    if hover_allowed && pending.champion_id != target.champion_id {
        log::info!(
            "BP hover sync: {} -> {}",
            pending.champion_id,
            target.champion_id
        );
        match crate::lcu::api::champion_select::patch_session_action(
            pending.action_id,
            target.champion_id,
            action_type.to_string(),
            false,
        )
        .await
        {
            Ok(()) => store::set_last_hovered(Some(target.champion_id)),
            Err(e) => log::warn!("BP hover sync failed (continuing to lock check): {}", e),
        }
    }

    // ---- 到点执行 ----
    let timer = &session.timer;
    let (lock_now, real_time_left): (bool, Option<f64>) = if timer.is_infinite {
        (pending.is_in_progress && target.lock, None)
    } else {
        let time_left = crate::bp_decision::evaluate::phase_secs_left(timer);
        if time_left <= 0.0 {
            if pending.is_in_progress {
                log::warn!(
                    "BP timer unusable (time_left={:.1}), skip auto lock",
                    time_left
                );
            }
            (false, Some(time_left))
        } else {
            (
                should_lock(decision, time_left, pending.is_in_progress),
                Some(time_left),
            )
        }
    };
    if lock_now {
        log::info!(
            "BP execute: {} {} at {}",
            action_type,
            target.champion_id,
            real_time_left
                .map(|t| format!("{:.1}s left", t))
                .unwrap_or_else(|| "infinite timer".to_string())
        );
        crate::lcu::api::champion_select::patch_session_action(
            pending.action_id,
            target.champion_id,
            action_type.to_string(),
            true,
        )
        .await?;
    }
    Ok(())
}

pub async fn switch_enabled(key: &str) -> bool {
    matches!(
        get_config(key).await.map(|v| extract_bool(&v)),
        Ok(Some(true))
    )
}

pub async fn start_ban_champion() -> Result<(), String> {
    let select_session = get_champion_select_session().await?;
    let Some(decision) = crate::bp_decision::store::read() else {
        log::debug!("No BP decision snapshot yet, skipping this tick");
        return Ok(());
    };
    if decision.action_type != crate::bp_decision::types::BpActionType::Ban {
        return Ok(());
    }
    apply_bp_decision(&select_session, &decision).await
}
