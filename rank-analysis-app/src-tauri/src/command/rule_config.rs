//! 规则引擎使用的数据类型：位置、条件、动作、规则。
//!
//! 与前端 `src/types/rules.ts` 保持同构。

use serde::{Deserialize, Serialize};

// 顺序与 LCU assignedPosition 字符串顺序一致：top/jungle/middle/bottom/utility
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Position {
    Top,
    Jungle,
    Middle,
    Bottom,
    Utility,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum RuleCondition {
    Position { value: Position },
    AllyChampionsContains { ids: Vec<i32> },
    AllyChampionsNotContains { ids: Vec<i32> },
    EnemyChampionsContains { ids: Vec<i32> },
    EnemyChampionsNotContains { ids: Vec<i32> },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PickAction {
    pub champion_id: i32,
    /// 缺省视为锁定执行（秒选锁定）；历史/外部导入的旧规则可能没有该字段，
    /// 缺失时不得让整条规则反序列化失败（那会让用户所有 Pick 规则瞬间消失）。
    #[serde(default = "default_lock_true")]
    pub lock: bool,
}

/// `PickAction.lock` 缺失时的默认值：锁定执行。
fn default_lock_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct BanAction {
    pub champion_id: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PickBanRule<A> {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub conditions: Vec<RuleCondition>,
    pub action: A,
}

pub type PickRule = PickBanRule<PickAction>;
pub type BanRule = PickBanRule<BanAction>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn position_round_trip() {
        let p = Position::Middle;
        let s = serde_json::to_string(&p).unwrap();
        assert_eq!(s, r#""middle""#);
        let back: Position = serde_json::from_str(&s).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn condition_position_round_trip() {
        let c = RuleCondition::Position {
            value: Position::Top,
        };
        let s = serde_json::to_string(&c).unwrap();
        assert!(s.contains(r#""type":"Position""#));
        let back: RuleCondition = serde_json::from_str(&s).unwrap();
        assert_eq!(back, c);
    }

    #[test]
    fn condition_ally_contains_round_trip() {
        let c = RuleCondition::AllyChampionsContains { ids: vec![157, 99] };
        let back: RuleCondition =
            serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(back, c);
    }

    #[test]
    fn condition_enemy_not_contains_round_trip() {
        let c = RuleCondition::EnemyChampionsNotContains { ids: vec![89] };
        let back: RuleCondition =
            serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(back, c);
    }

    #[test]
    fn pick_action_round_trip() {
        let a = PickAction {
            champion_id: 157,
            lock: true,
        };
        let s = serde_json::to_string(&a).unwrap();
        let back: PickAction = serde_json::from_str(&s).unwrap();
        assert_eq!(back.champion_id, 157);
        assert!(back.lock);
    }

    #[test]
    fn ban_action_round_trip() {
        let a = BanAction { champion_id: 89 };
        let s = serde_json::to_string(&a).unwrap();
        let back: BanAction = serde_json::from_str(&s).unwrap();
        assert_eq!(back.champion_id, 89);
    }

    #[test]
    fn pick_rule_round_trip_full() {
        let r = PickRule {
            id: "r1".to_string(),
            name: "中路防刺客".to_string(),
            enabled: true,
            conditions: vec![
                RuleCondition::Position {
                    value: Position::Middle,
                },
                RuleCondition::EnemyChampionsContains { ids: vec![238] },
            ],
            action: PickAction {
                champion_id: 1,
                lock: false,
            },
        };
        let s = serde_json::to_string(&r).unwrap();
        let back: PickRule = serde_json::from_str(&s).unwrap();
        assert_eq!(back, r);
    }

    #[test]
    fn pick_rule_missing_lock_field_defaults_to_locked() {
        // 历史/外部导入的旧规则可能省略 lock 字段——缺失时必须反序列化成功
        // 且按「锁定执行」处理，而非整条规则消失（parse_pick_rules_value 返回空）。
        let json = r#"{
            "id": "r-legacy",
            "name": "旧规则",
            "enabled": true,
            "conditions": [],
            "action": { "champion_id": 157 }
        }"#;
        let r: PickRule = serde_json::from_str(json).unwrap();
        assert_eq!(r.action.champion_id, 157);
        assert!(r.action.lock, "缺失 lock 应默认为 true（锁定执行）");
    }

    #[test]
    fn ban_rule_serializes_without_lock_field() {
        let r = BanRule {
            id: "b1".to_string(),
            name: "克制 ADC".to_string(),
            enabled: true,
            conditions: vec![RuleCondition::Position {
                value: Position::Bottom,
            }],
            action: BanAction { champion_id: 89 },
        };
        let s = serde_json::to_string(&r).unwrap();
        assert!(
            !s.contains("lock"),
            "BanAction must not serialize a lock field, got: {s}"
        );
    }
}
