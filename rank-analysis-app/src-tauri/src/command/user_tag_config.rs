//! # UserTagConfig 命令模块
//!
//! 用户标签配置的读写与解析命令接口（薄适配层，业务逻辑已委托给 `crate::domain::tags`）。

pub use crate::domain::tags::*;

/// 获取当前所有标签配置。
///
/// 如果配置不存在，会自动加载默认配置。
#[tauri::command]
pub async fn get_all_tag_configs() -> Result<Vec<TagConfig>, String> {
    Ok(load_config().await)
}

/// 保存标签配置到本地。
#[tauri::command]
pub async fn save_tag_configs(configs: Vec<TagConfig>) -> Result<(), String> {
    save_config(configs).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constant::game::QUEUE_SOLO_5X5;
    use crate::lcu::api::match_history::{Game, GamesWrapper, MatchHistory};
    use crate::lcu::api::model::{Participant, Stats};

    fn make_game(champion_id: i32, win: bool, queue_id: i32) -> Game {
        let p = Participant {
            champion_id,
            team_id: 100,
            stats: Stats {
                win,
                ..Default::default()
            },
            ..Default::default()
        };
        Game {
            queue_id,
            participants: vec![p],
            ..Default::default()
        }
    }

    fn make_history(games: Vec<Game>) -> MatchHistory {
        MatchHistory {
            games: GamesWrapper { games },
            ..Default::default()
        }
    }

    fn default_tag(id: &str) -> TagConfig {
        get_default_tags()
            .into_iter()
            .find(|t| t.id == id)
            .unwrap_or_else(|| panic!("默认标签不存在: {}", id))
    }

    #[test]
    fn current_champion_hits_when_injected() {
        let cfg = TagConfig {
            id: "t".into(),
            name: "本命".into(),
            desc: "".into(),
            good: true,
            enabled: true,
            is_default: false,
            condition: TagCondition::CurrentChampion { ids: vec![157] },
        };
        let history = make_history(vec![make_game(157, true, QUEUE_SOLO_5X5)]);
        assert!(cfg.evaluate(&history, QUEUE_SOLO_5X5, Some(157)).is_some());
        assert!(cfg.evaluate(&history, QUEUE_SOLO_5X5, Some(1)).is_none());
        assert!(cfg.evaluate(&history, QUEUE_SOLO_5X5, None).is_none());
    }

    #[test]
    fn merge_appends_missing_defaults_without_touching_user_edits() {
        let mut mine = get_default_tags();
        mine.truncate(2);
        mine[0].enabled = false;
        mine[0].name = "我改过名".to_string();
        let merged = merge_missing_defaults(mine);
        assert!(merged.iter().any(|t| t.id == "default_smurf"));
        let first = merged
            .iter()
            .find(|t| t.id == get_default_tags()[0].id)
            .unwrap();
        assert!(!first.enabled);
        assert_eq!(first.name, "我改过名");
        let len = merged.len();
        assert_eq!(merge_missing_defaults(merged).len(), len);
    }
}
