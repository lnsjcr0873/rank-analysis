use crate::command::user_tag::RankTag;
use crate::constant::game::{QUEUE_FLEX, QUEUE_SOLO_5X5};
use crate::domain::tags::model::{
    MatchFilter, MatchRefresh, Operator, StreakType, TagCondition, TagConfig,
};
use crate::lcu::api::match_history::MatchHistory;

impl TagConfig {
    /// 评估标签条件。
    pub fn evaluate(
        &self,
        match_history: &MatchHistory,
        current_mode: i32,
        current_champion: Option<i32>,
    ) -> Option<RankTag> {
        if !self.enabled {
            return None;
        }

        let context = EvalContext {
            history: match_history,
            current_mode,
            current_champion,
        };

        if context.evaluate_node(&self.condition) {
            let display_name = self.format_name(match_history);
            Some(RankTag {
                good: self.good,
                tag_name: display_name,
                tag_desc: self.desc.clone(),
            })
        } else {
            None
        }
    }

    /// 格式化标签名称。
    fn format_name(&self, match_history: &MatchHistory) -> String {
        if self.name.contains("{N}") {
            let streak = get_current_streak(match_history);
            let n_cn = number_to_chinese(streak.abs());
            return self.name.replace("{N}", &n_cn);
        }
        self.name.clone()
    }
}

/// 条件评估上下文。
pub struct EvalContext<'a> {
    pub history: &'a MatchHistory,
    pub current_mode: i32,
    pub current_champion: Option<i32>,
}

impl EvalContext<'_> {
    pub fn evaluate_node(&self, condition: &TagCondition) -> bool {
        match condition {
            TagCondition::And { conditions } => conditions.iter().all(|c| self.evaluate_node(c)),
            TagCondition::Or { conditions } => conditions.iter().any(|c| self.evaluate_node(c)),
            TagCondition::Not { condition } => !self.evaluate_node(condition),

            TagCondition::CurrentQueue { ids } => ids.iter().any(|id| {
                crate::constant::game::queue_ids_same_group(*id as u32, self.current_mode as u32)
            }),
            TagCondition::CurrentChampion { ids } => {
                if let Some(curr) = self.current_champion {
                    ids.contains(&curr)
                } else {
                    false
                }
            }

            TagCondition::History { filters, refresh } => self.evaluate_history(filters, refresh),
        }
    }

    pub fn evaluate_history(&self, filters: &[MatchFilter], refresh: &MatchRefresh) -> bool {
        let recent_limit = filters
            .iter()
            .filter_map(|f| match f {
                MatchFilter::Recent { count } => Some((*count).max(0) as usize),
                _ => None,
            })
            .min();
        let all_games = &self.history.games.games;
        let base = match recent_limit {
            Some(n) => &all_games[..n.min(all_games.len())],
            None => &all_games[..],
        };
        let games_iter = base.iter().filter(|g| {
            for f in filters {
                if !match_filter(g, f) {
                    return false;
                }
            }
            true
        });

        let games: Vec<_> = games_iter.collect();

        match refresh {
            MatchRefresh::Count { op, value } => op.check(games.len() as f64, *value),
            MatchRefresh::Average { metric, op, value } => {
                let vals: Vec<f64> = games
                    .iter()
                    .map(|g| extract_game_metric(g, metric))
                    .filter(|v| v.is_finite())
                    .collect();
                if vals.is_empty() {
                    return false;
                }
                let total: f64 = vals.iter().sum();
                op.check(total / vals.len() as f64, *value)
            }
            MatchRefresh::Sum { metric, op, value } => {
                let total: f64 = games
                    .iter()
                    .map(|g| extract_game_metric(g, metric))
                    .filter(|v| v.is_finite())
                    .sum();
                op.check(total, *value)
            }
            MatchRefresh::Max { metric, op, value } => {
                let max_val = games
                    .iter()
                    .map(|g| extract_game_metric(g, metric))
                    .fold(f64::MIN, f64::max);
                if games.is_empty() {
                    return false;
                }
                op.check(max_val, *value)
            }
            MatchRefresh::Min { metric, op, value } => {
                let min_val = games
                    .iter()
                    .map(|g| extract_game_metric(g, metric))
                    .fold(f64::MAX, f64::min);
                if games.is_empty() {
                    return false;
                }
                op.check(min_val, *value)
            }
            MatchRefresh::Streak { min, kind } => {
                let mut current_streak = 0;
                for g in games {
                    let win = extract_game_metric(g, "win") > 0.5;

                    match kind {
                        StreakType::Win => {
                            if win {
                                current_streak += 1;
                            } else {
                                break;
                            }
                        }
                        StreakType::Loss => {
                            if !win {
                                current_streak += 1;
                            } else {
                                break;
                            }
                        }
                    }
                }
                current_streak >= *min
            }
            MatchRefresh::DistinctChampions { op, value } => {
                if games.is_empty() {
                    return false;
                }
                let distinct: std::collections::HashSet<i32> = games
                    .iter()
                    .filter_map(|g| g.participants.first().map(|p| p.champion_id))
                    .collect();
                op.check(distinct.len() as f64, *value)
            }
            MatchRefresh::Ratio {
                metric,
                game_op,
                game_value,
                op,
                value,
            } => {
                if games.is_empty() {
                    return false;
                }
                let hits = games
                    .iter()
                    .filter(|g| game_op.check(extract_game_metric(g, metric), *game_value))
                    .count();
                op.check(hits as f64 / games.len() as f64, *value)
            }
        }
    }
}

pub fn match_filter(game: &crate::lcu::api::match_history::Game, filter: &MatchFilter) -> bool {
    if game.participants.is_empty() {
        return false;
    }
    let p = &game.participants[0];

    match filter {
        MatchFilter::Queue { ids } => ids.iter().any(|id| {
            crate::constant::game::queue_ids_same_group(game.queue_id as u32, *id as u32)
        }),
        MatchFilter::Champion { ids } => ids.contains(&p.champion_id),
        MatchFilter::Stat { metric, op, value } => {
            let v = extract_game_metric(game, metric);
            op.check(v, *value)
        }
        MatchFilter::Recent { .. } => true,
    }
}

pub fn extract_game_metric(game: &crate::lcu::api::match_history::Game, metric: &str) -> f64 {
    if game.participants.is_empty() {
        return 0.0;
    }
    let stats = &game.participants[0].stats;

    match metric {
        "kills" => stats.kills as f64,
        "deaths" => stats.deaths as f64,
        "assists" => stats.assists as f64,
        "kda" => {
            if stats.deaths == 0 {
                (stats.kills + stats.assists) as f64
            } else {
                (stats.kills + stats.assists) as f64 / stats.deaths as f64
            }
        }
        "win" if stats.win => 1.0,
        "win" => 0.0,
        "gold" => stats.gold_earned as f64,
        "cs" => stats.total_minions_killed as f64,
        "damage" => stats.total_damage_dealt_to_champions as f64,
        "damageTaken" => stats.total_damage_taken as f64,
        "gameDuration" => game.game_duration as f64,
        "damageShare" => {
            if game.game_detail.participants.is_empty() {
                return f64::NAN;
            }
            stats.damage_dealt_to_champions_rate as f64 / 100.0
        }
        "participation" => {
            if game.game_detail.participants.is_empty() {
                return f64::NAN;
            }
            let team_id = game.participants[0].team_id;
            let is_cherry = game.game_mode == "CHERRY";
            let my_subteam = game.participants[0].stats.player_subteam_id;
            let team_kills: i32 = game
                .game_detail
                .participants
                .iter()
                .filter(|p| {
                    if is_cherry && my_subteam > 0 {
                        p.stats.player_subteam_id == my_subteam
                    } else {
                        p.team_id == team_id
                    }
                })
                .map(|p| p.stats.kills)
                .sum();
            if team_kills == 0 {
                0.0
            } else {
                (stats.kills + stats.assists) as f64 / team_kills as f64
            }
        }
        _ => 0.0,
    }
}

pub fn get_current_streak(match_history: &MatchHistory) -> i32 {
    let mut s = 0;
    let mut is_win = None;
    for g in &match_history.games.games {
        if ![QUEUE_SOLO_5X5, QUEUE_FLEX].contains(&g.queue_id) {
            continue;
        }

        if g.participants.is_empty() {
            continue;
        }
        let win = g.participants[0].stats.win;

        if is_win.is_none() {
            is_win = Some(win);
        }
        if Some(win) != is_win {
            break;
        }
        s += 1;
    }
    match is_win {
        Some(true) => s,
        Some(false) => -s,
        None => 0,
    }
}

pub fn number_to_chinese(num: i32) -> String {
    let chinese_digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    if (0..10).contains(&num) {
        return chinese_digits[num as usize].to_string();
    }
    format!("{}", num)
}
