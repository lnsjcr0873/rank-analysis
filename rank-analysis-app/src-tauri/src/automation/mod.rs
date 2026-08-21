//! 自动化功能模块
//!
//! 提供英雄联盟客户端的自动化操作功能：
//! - 自动接受匹配
//! - 自动开始寻找对局
//! - 自动选择英雄
//! - 自动禁用英雄
//! - 自动换人确认
//! - 自动符文配置

pub mod champ_select;
pub mod manager;
pub mod matchmaking;

pub use champ_select::*;
pub use manager::*;
pub use matchmaking::*;

use crate::config::{extract_bool, get_config, register_on_change_callback, Value};

/// 初始化并启动自动化任务。
pub async fn init_run_automation(app: tauri::AppHandle) {
    let manager = manager::get_automation_manager();
    log::info!("Initializing automation tasks");

    // 决策快照求值：无条件常驻，未开自动化的用户也能看到建议带
    manager.start_task(
        "bp_decision",
        champ_select::start_bp_decision_automation(app.clone()),
    );

    // 检查配置并启动对应的自动化任务
    match get_config("settings.auto.startMatchSwitch").await {
        Ok(value) => {
            log::info!("Auto-start match config value: {:?}", value);
            if let Some(true) = extract_bool(&value) {
                log::info!("Auto-start match is enabled, starting task");
                manager.start_task("start_match", matchmaking::start_match_automation());
            }
        }
        Err(e) => {
            log::error!("Failed to get startMatchSwitch config: {}", e);
        }
    }

    match get_config("settings.auto.acceptMatchSwitch").await {
        Ok(value) => {
            log::info!("Auto-accept match config value: {:?}", value);
            if let Some(true) = extract_bool(&value) {
                log::info!("Auto-accept match is enabled, starting task");
                manager.start_task("accept_match", matchmaking::start_accept_match_automation());
            }
        }
        Err(e) => {
            log::error!("Failed to get acceptMatchSwitch config: {}", e);
        }
    }

    match get_config("settings.auto.banChampionSwitch").await {
        Ok(value) => {
            log::info!("Auto-ban champion config value: {:?}", value);
            if let Some(true) = extract_bool(&value) {
                log::info!("Auto-ban champion is enabled, starting task");
                manager.start_task(
                    "ban_champion",
                    champ_select::start_champion_ban_automation(),
                );
            }
        }
        Err(e) => {
            log::error!("Failed to get banChampionSwitch config: {}", e);
        }
    }

    match get_config("settings.auto.pickChampionSwitch").await {
        Ok(value) => {
            log::info!("Auto-pick champion config value: {:?}", value);
            if let Some(true) = extract_bool(&value) {
                log::info!("Auto-pick champion is enabled, starting task");
                manager.start_task(
                    "pick_champion",
                    champ_select::start_champion_select_automation(),
                );
            }
        }
        Err(e) => {
            log::error!("Failed to get pickChampionSwitch config: {}", e);
        }
    }

    match get_config("settings.auto.tradeConfirmSwitch").await {
        Ok(value) => {
            log::info!("Auto-trade confirm config value: {:?}", value);
            if let Some(true) = extract_bool(&value) {
                log::info!("Auto-trade confirm is enabled, starting task");
                manager.start_task("trade_confirm", champ_select::start_trade_automation());
            }
        }
        Err(e) => {
            log::error!("Failed to get tradeConfirmSwitch config: {}", e);
        }
    }

    match get_config("settings.auto.runeSwitch").await {
        Ok(value) => {
            log::info!("Auto-rune config value: {:?}", value);
            if let Some(true) = extract_bool(&value) {
                log::info!("Auto-rune is enabled, starting task");
                manager.start_task("rune_apply", champ_select::start_rune_automation());
            }
        }
        Err(e) => {
            log::error!("Failed to get runeSwitch config: {}", e);
        }
    }

    log::info!("Automation tasks initialization completed");
}

/// 启动自动化系统。
pub async fn start_automation(app: tauri::AppHandle) {
    log::info!("========== Starting Automation System ==========");
    init_run_automation(app).await;
    log::info!("Registering configuration change callbacks");

    register_on_change_callback(|key: &str, new_value: &Value| {
        log::info!("Config changed: {} = {:?}", key, new_value);

        let manager = match manager::try_get_automation_manager() {
            Some(m) => m,
            None => {
                log::error!("AutomationManager not initialized when config changed!");
                return;
            }
        };

        match key {
            "settings.auto.startMatchSwitch" => {
                if let Some(enabled) = extract_bool(new_value) {
                    if enabled {
                        log::info!("Config: Enabling match automation");
                        manager.start_task("start_match", matchmaking::start_match_automation());
                    } else {
                        log::info!("Config: Disabling match automation");
                        manager.stop_task("start_match");
                    }
                } else {
                    log::warn!("Invalid value for startMatchSwitch: {:?}", new_value);
                }
            }
            "settings.auto.acceptMatchSwitch" => {
                if let Some(enabled) = extract_bool(new_value) {
                    if enabled {
                        log::info!("Config: Enabling accept match automation");
                        manager.start_task(
                            "accept_match",
                            matchmaking::start_accept_match_automation(),
                        );
                    } else {
                        log::info!("Config: Disabling accept match automation");
                        manager.stop_task("accept_match");
                    }
                } else {
                    log::warn!("Invalid value for acceptMatchSwitch: {:?}", new_value);
                }
            }
            "settings.auto.pickChampionSwitch" => {
                if let Some(enabled) = extract_bool(new_value) {
                    if enabled {
                        log::info!("Config: Enabling champion select automation");
                        manager.start_task(
                            "pick_champion",
                            champ_select::start_champion_select_automation(),
                        );
                    } else {
                        log::info!("Config: Disabling champion select automation");
                        manager.stop_task("pick_champion");
                    }
                } else {
                    log::warn!("Invalid value for pickChampionSwitch: {:?}", new_value);
                }
            }
            "settings.auto.banChampionSwitch" => {
                if let Some(enabled) = extract_bool(new_value) {
                    if enabled {
                        log::info!("Config: Enabling champion ban automation");
                        manager.start_task(
                            "ban_champion",
                            champ_select::start_champion_ban_automation(),
                        );
                    } else {
                        log::info!("Config: Disabling champion ban automation");
                        manager.stop_task("ban_champion");
                    }
                } else {
                    log::warn!("Invalid value for banChampionSwitch: {:?}", new_value);
                }
            }
            "settings.auto.tradeConfirmSwitch" => {
                if let Some(enabled) = extract_bool(new_value) {
                    if enabled {
                        log::info!("Config: Enabling trade confirm automation");
                        manager.start_task("trade_confirm", champ_select::start_trade_automation());
                    } else {
                        log::info!("Config: Disabling trade confirm automation");
                        manager.stop_task("trade_confirm");
                    }
                } else {
                    log::warn!("Invalid value for tradeConfirmSwitch: {:?}", new_value);
                }
            }
            "settings.auto.runeSwitch" => {
                if let Some(enabled) = extract_bool(new_value) {
                    if enabled {
                        log::info!("Config: Enabling rune page automation");
                        manager.start_task("rune_apply", champ_select::start_rune_automation());
                    } else {
                        log::info!("Config: Disabling rune page automation");
                        manager.stop_task("rune_apply");
                    }
                } else {
                    log::warn!("Invalid value for runeSwitch: {:?}", new_value);
                }
            }
            _ => {
                log::debug!("Config changed for unmonitored key: {}", key);
            }
        }
    });

    log::info!("========== Automation System Started ==========");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn pick_rule_json(id: &str, champion_id: i32, lock: bool) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "name": "test rule",
            "enabled": true,
            "conditions": [],
            "action": { "champion_id": champion_id, "lock": lock }
        })
    }

    fn ban_rule_json(id: &str, champion_id: i32) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "name": "test ban rule",
            "enabled": true,
            "conditions": [],
            "action": { "champion_id": champion_id }
        })
    }

    #[test]
    fn parse_pick_rules_returns_empty_for_empty_string_value() {
        let v = Value::String(String::new());
        assert!(parse_pick_rules_value(&v).is_empty());
    }

    #[test]
    fn parse_pick_rules_returns_empty_for_null_value() {
        let v = Value::Null;
        assert!(parse_pick_rules_value(&v).is_empty());
    }

    #[test]
    fn parse_pick_rules_handles_value_envelope() {
        let mut map = HashMap::new();
        map.insert(
            "value".to_string(),
            Value::List(vec![serde_json::from_value::<Value>(pick_rule_json(
                "r1", 99, true,
            ))
            .unwrap()]),
        );
        let v = Value::Map(map);
        let rules = parse_pick_rules_value(&v);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].id, "r1");
        assert_eq!(rules[0].action.champion_id, 99);
        assert!(rules[0].action.lock);
    }

    #[test]
    fn parse_pick_rules_handles_bare_list() {
        let item: Value = serde_json::from_value(pick_rule_json("r1", 1, false)).unwrap();
        let v = Value::List(vec![item]);
        let rules = parse_pick_rules_value(&v);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].action.champion_id, 1);
        assert!(!rules[0].action.lock);
    }

    #[test]
    fn parse_ban_rules_returns_empty_for_empty_string_value() {
        let v = Value::String(String::new());
        assert!(parse_ban_rules_value(&v).is_empty());
    }

    #[test]
    fn parse_ban_rules_handles_bare_list() {
        let item: Value = serde_json::from_value(ban_rule_json("b1", 55)).unwrap();
        let v = Value::List(vec![item]);
        let rules = parse_ban_rules_value(&v);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].id, "b1");
        assert_eq!(rules[0].action.champion_id, 55);
    }

    #[test]
    fn parse_rune_rules_handles_value_envelope() {
        let mut map = HashMap::new();
        map.insert(
            "value".to_string(),
            Value::List(vec![
                serde_json::from_value::<Value>(serde_json::json!({
                    "championId": 429, "pageName": "凯莎-常规"
                }))
                .unwrap(),
                serde_json::from_value::<Value>(serde_json::json!({
                    "championId": 103, "pageName": "阿狸-炽热"
                }))
                .unwrap(),
            ]),
        );
        let rules = parse_rune_rules_value(&Value::Map(map));
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].champion_id, 429);
        assert_eq!(rules[0].page_name, "凯莎-常规");
        assert_eq!(rules[1].champion_id, 103);
    }

    #[test]
    fn parse_rune_rules_handles_bare_list_and_trims_name() {
        let item: Value = serde_json::from_value(serde_json::json!({
            "championId": 64, "pageName": "  剑姬-主流  "
        }))
        .unwrap();
        let rules = parse_rune_rules_value(&Value::List(vec![item]));
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].page_name, "剑姬-主流");
    }

    #[test]
    fn parse_rune_rules_skips_invalid_rows() {
        let rows = vec![
            serde_json::json!({ "pageName": "只有页名" }),
            serde_json::json!({ "championId": 1 }),
            serde_json::json!({ "championId": 2, "pageName": "   " }),
            serde_json::json!({ "championId": 0, "pageName": "非法英雄" }),
        ];
        let rules = parse_rune_rules_value(&Value::List(
            rows.into_iter()
                .map(|r| serde_json::from_value::<Value>(r).unwrap())
                .collect(),
        ));
        assert!(rules.is_empty());
    }

    fn action(
        actor_cell_id: i32,
        champion_id: i32,
        completed: bool,
        action_type: &str,
    ) -> crate::lcu::api::champion_select::Action {
        crate::lcu::api::champion_select::Action {
            actor_cell_id,
            id: actor_cell_id,
            champion_id,
            completed,
            is_ally_action: true,
            is_in_progress: false,
            action_type: action_type.to_string(),
        }
    }

    fn session_with(
        actions: Vec<crate::lcu::api::champion_select::Action>,
    ) -> crate::lcu::api::champion_select::SelectSession {
        crate::lcu::api::champion_select::SelectSession {
            my_team: vec![],
            their_team: vec![],
            actions: vec![actions],
            timer: crate::lcu::api::champion_select::Timer::default(),
            local_player_cell_id: 0,
            trades: Vec::new(),
            bench_champions: Vec::new(),
        }
    }

    #[test]
    fn locked_champion_is_picked_from_completed_local_pick() {
        let s = session_with(vec![
            action(0, 429, true, "pick"),
            action(1, 0, false, "pick"),
        ]);
        assert_eq!(my_locked_champion(&s), Some(429));
    }

    #[test]
    fn locked_champion_ignores_ban_and_uncompleted_actions() {
        let s = session_with(vec![action(0, 5, true, "ban"), action(0, 0, false, "pick")]);
        assert_eq!(my_locked_champion(&s), None);
    }

    #[test]
    fn locked_champion_is_none_without_local_actions() {
        let s = session_with(vec![action(3, 429, true, "pick")]);
        assert_eq!(my_locked_champion(&s), None);
    }
}

#[cfg(test)]
mod bp_execution_tests {
    use super::*;
    use crate::bp_decision::types::{BpActionType, BpDecision, BpMode, BpOrigin, BpTarget};

    fn decision(mode: BpMode, time_left: f64, overridden: bool) -> BpDecision {
        BpDecision {
            action_type: BpActionType::Pick,
            target: Some(BpTarget {
                champion_id: 64,
                lock: true,
                origin: BpOrigin::Fallback { pool_size: 1 },
                evidence: None,
            }),
            rejected: vec![],
            mode,
            time_left_secs: time_left,
            execute_at_secs_left: 5.0,
            user_overridden: overridden,
        }
    }

    #[test]
    fn should_lock_only_within_threshold_window() {
        assert!(!should_lock(
            &decision(BpMode::Auto, 20.0, false),
            20.0,
            true
        ));
        assert!(should_lock(&decision(BpMode::Auto, 5.0, false), 5.0, true));
        assert!(should_lock(&decision(BpMode::Auto, 3.5, false), 3.5, true));
        assert!(!should_lock(&decision(BpMode::Auto, 2.9, false), 2.9, true));
        assert!(!should_lock(
            &decision(BpMode::Auto, 4.0, false),
            4.0,
            false
        ));
    }

    #[test]
    fn should_lock_when_real_time_param_is_within_window_even_if_snapshot_is_stale_and_early() {
        assert!(should_lock(&decision(BpMode::Auto, 20.0, false), 4.0, true));
    }

    #[test]
    fn should_not_lock_when_real_time_param_is_early_even_if_snapshot_is_stale_and_at_threshold() {
        assert!(!should_lock(
            &decision(BpMode::Auto, 4.0, false),
            20.0,
            true
        ));
    }

    #[test]
    fn should_not_act_in_advisory_or_after_override() {
        assert!(!should_act(&decision(BpMode::Advisory, 4.0, false)));
        assert!(!should_act(&decision(BpMode::Auto, 4.0, true)));
        assert!(should_act(&decision(BpMode::Auto, 4.0, false)));
    }

    #[test]
    fn should_not_lock_when_rule_says_hover_only() {
        let mut d = decision(BpMode::Auto, 4.0, false);
        d.target.as_mut().unwrap().lock = false;
        assert!(
            !should_lock(&d, 4.0, true),
            "lock=false 的规则只 hover，不自动确定"
        );
    }
}
