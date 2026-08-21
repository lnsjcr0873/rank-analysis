use crate::constant::game::{QUEUE_FLEX, QUEUE_IDS, QUEUE_SOLO_5X5};
use crate::domain::tags::model::{
    MatchFilter, MatchRefresh, Operator, StreakType, TagCondition, TagConfig,
};

/// 获取默认标签配置列表。
pub fn get_default_tags() -> Vec<TagConfig> {
    let ranked_filter = MatchFilter::Queue {
        ids: vec![QUEUE_SOLO_5X5, QUEUE_FLEX],
    };

    vec![
        TagConfig {
            id: "default_streak_win".to_string(),
            name: "{N}连胜".to_string(),
            desc: "最近胜率较高的大腿玩家哦".to_string(),
            good: true,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![ranked_filter.clone()],
                refresh: MatchRefresh::Streak {
                    min: 3,
                    kind: StreakType::Win,
                },
            },
        },
        TagConfig {
            id: "default_streak_loss".to_string(),
            name: "{N}连败".to_string(),
            desc: "最近连败的玩家哦".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![ranked_filter.clone()],
                refresh: MatchRefresh::Streak {
                    min: 3,
                    kind: StreakType::Loss,
                },
            },
        },
        TagConfig {
            id: "default_casual".to_string(),
            name: "娱乐".to_string(),
            desc: "排位比例较少".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::And {
                conditions: vec![
                    TagCondition::CurrentQueue {
                        ids: vec![QUEUE_SOLO_5X5, QUEUE_FLEX],
                    },
                    TagCondition::History {
                        filters: vec![MatchFilter::Queue {
                            ids: QUEUE_IDS
                                .iter()
                                .filter(|&id| *id != 420 && *id != 440)
                                .cloned()
                                .collect(),
                        }],
                        refresh: MatchRefresh::Count {
                            op: Operator::Gt,
                            value: 5.0,
                        },
                    },
                ],
            },
        },
        TagConfig {
            id: "default_feeder".to_string(),
            name: "峡谷慈善家".to_string(),
            desc: "死亡数较多的玩家".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![
                    ranked_filter.clone(),
                    MatchFilter::Stat {
                        metric: "deaths".to_string(),
                        op: Operator::Gte,
                        value: 10.0,
                    },
                ],
                refresh: MatchRefresh::Count {
                    op: Operator::Gte,
                    value: 5.0,
                },
            },
        },
        TagConfig {
            id: "default_carry".to_string(),
            name: "Carry".to_string(),
            desc: "近期比赛多次Carry".to_string(),
            good: true,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![
                    ranked_filter.clone(),
                    MatchFilter::Stat {
                        metric: "kda".to_string(),
                        op: Operator::Gte,
                        value: 6.0,
                    },
                ],
                refresh: MatchRefresh::Count {
                    op: Operator::Gte,
                    value: 5.0,
                },
            },
        },
        TagConfig {
            id: "default_special_smolder".to_string(),
            name: "小火龙".to_string(),
            desc: "该玩家使用小火龙场次较多".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![
                    ranked_filter.clone(),
                    MatchFilter::Champion { ids: vec![901] },
                ],
                refresh: MatchRefresh::Count {
                    op: Operator::Gte,
                    value: 5.0,
                },
            },
        },
        TagConfig {
            id: "default_smurf".to_string(),
            name: "炸鱼嫌疑".to_string(),
            desc: "近期排位胜率与 KDA 异常偏高，仅供参考".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::And {
                conditions: vec![
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Count {
                            op: Operator::Gte,
                            value: 10.0,
                        },
                    },
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Average {
                            metric: "win".to_string(),
                            op: Operator::Gte,
                            value: 0.75,
                        },
                    },
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Average {
                            metric: "kda".to_string(),
                            op: Operator::Gte,
                            value: 5.0,
                        },
                    },
                ],
            },
        },
        TagConfig {
            id: "default_champion_pool_narrow".to_string(),
            name: "专精".to_string(),
            desc: "近 20 场只玩 3 个以内英雄".to_string(),
            good: true,
            enabled: true,
            is_default: true,
            condition: TagCondition::And {
                conditions: vec![
                    TagCondition::History {
                        filters: vec![MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::DistinctChampions {
                            op: Operator::Lte,
                            value: 3.0,
                        },
                    },
                    TagCondition::History {
                        filters: vec![MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Count {
                            op: Operator::Gte,
                            value: 10.0,
                        },
                    },
                ],
            },
        },
        TagConfig {
            id: "default_hot_streak_form".to_string(),
            name: "手热".to_string(),
            desc: "近 10 场排位胜率显著高于近 20 场，状态上升".to_string(),
            good: true,
            enabled: true,
            is_default: true,
            condition: TagCondition::And {
                conditions: vec![
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 10 }],
                        refresh: MatchRefresh::Average {
                            metric: "win".to_string(),
                            op: Operator::Gte,
                            value: 0.7,
                        },
                    },
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Average {
                            metric: "win".to_string(),
                            op: Operator::Lte,
                            value: 0.55,
                        },
                    },
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Count {
                            op: Operator::Gte,
                            value: 15.0,
                        },
                    },
                ],
            },
        },
        TagConfig {
            id: "default_cold_form".to_string(),
            name: "低谷".to_string(),
            desc: "近 10 场排位胜率显著低于近 20 场，仅供参考".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::And {
                conditions: vec![
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 10 }],
                        refresh: MatchRefresh::Average {
                            metric: "win".to_string(),
                            op: Operator::Lte,
                            value: 0.3,
                        },
                    },
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Average {
                            metric: "win".to_string(),
                            op: Operator::Gte,
                            value: 0.45,
                        },
                    },
                    TagCondition::History {
                        filters: vec![ranked_filter.clone(), MatchFilter::Recent { count: 20 }],
                        refresh: MatchRefresh::Count {
                            op: Operator::Gte,
                            value: 15.0,
                        },
                    },
                ],
            },
        },
        TagConfig {
            id: "default_int_risk".to_string(),
            name: "伤害贡献低".to_string(),
            desc: "近 20 场中伤害占比极低的场次偏多，仅供参考".to_string(),
            good: false,
            enabled: true,
            is_default: true,
            condition: TagCondition::History {
                filters: vec![MatchFilter::Recent { count: 20 }],
                refresh: MatchRefresh::Ratio {
                    metric: "damageShare".to_string(),
                    game_op: Operator::Lt,
                    game_value: 0.05,
                    op: Operator::Gte,
                    value: 0.3,
                },
            },
        },
    ]
}

pub fn merge_missing_defaults(mut tags: Vec<TagConfig>) -> Vec<TagConfig> {
    let existing: std::collections::HashSet<String> = tags.iter().map(|t| t.id.clone()).collect();
    tags.extend(
        get_default_tags()
            .into_iter()
            .filter(|d| !existing.contains(&d.id)),
    );
    tags
}

pub fn condition_has_current_queue(c: &TagCondition) -> bool {
    match c {
        TagCondition::CurrentQueue { .. } => true,
        TagCondition::And { conditions } | TagCondition::Or { conditions } => {
            conditions.iter().any(condition_has_current_queue)
        }
        TagCondition::Not { condition } => condition_has_current_queue(condition),
        _ => false,
    }
}

pub fn migrate_casual_ranked_only(tags: &mut [TagConfig]) -> bool {
    let mut changed = false;
    for t in tags.iter_mut() {
        if t.id == "default_casual" && !condition_has_current_queue(&t.condition) {
            let inner = t.condition.clone();
            t.condition = TagCondition::And {
                conditions: vec![
                    TagCondition::CurrentQueue {
                        ids: vec![QUEUE_SOLO_5X5, QUEUE_FLEX],
                    },
                    inner,
                ],
            };
            changed = true;
        }
    }
    changed
}
