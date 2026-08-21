//! # Akari 评分数学公式
//!
//! 包含 9 维指标归一化、贡献比折算与区间线性映射等纯数学函数。

/// KDA 维基准与评分斜率（Akari constants）：baseline=2，满分 1 分。
pub const KDA_BASELINE: f64 = 2.0;
pub const KDA_SLOPE: f64 = 3.0 / 7.0;

pub const FULL_SCORE_KDA: f64 = 1.0;
pub const FULL_SCORE_WIN: f64 = 1.0;
pub const FULL_SCORE_DAMAGE: f64 = 3.0;
pub const FULL_SCORE_TAKEN: f64 = 2.0;
pub const FULL_SCORE_HEAL: f64 = 2.0;
pub const FULL_SCORE_CS: f64 = 2.0;
pub const FULL_SCORE_GOLD: f64 = 2.0;
pub const FULL_SCORE_PARTICIPATION: f64 = 2.0;
pub const FULL_SCORE_VISION: f64 = 2.0;

/// 线性维的「理应贡献比」区间：ratio ∈ [min, max] → [0, 满分]。
pub const RATIO_MIN_DAMAGE: f64 = 1.0;
pub const RATIO_MAX_DAMAGE: f64 = 2.0;
pub const RATIO_MIN_TAKEN: f64 = 1.0;
pub const RATIO_MAX_TAKEN: f64 = 2.0;
/// 治疗基准：达到队均承伤的 20% 起算，满 2 倍基准满分。
pub const HEAL_RATIO_MIN: f64 = 0.2;
pub const HEAL_RATIO_MAX: f64 = 1.4;
/// 补刀：5 补刀/分 起算，10 补刀/分 满分。
pub const CS_MIN_PER_MIN: f64 = 5.0;
pub const CS_MAX_PER_MIN: f64 = 10.0;
/// 经济：达到人均等分起算，1.5 倍人均满分。
pub const RATIO_MIN_GOLD: f64 = 1.0;
pub const RATIO_MAX_GOLD: f64 = 1.5;
/// 参团：30% 起算，100% 满分。
pub const KP_MIN: f64 = 0.3;
pub const KP_MAX: f64 = 1.0;
/// 视野：人均等分起算，2 倍人均满分。
pub const RATIO_MIN_VISION: f64 = 1.0;
pub const RATIO_MAX_VISION: f64 = 2.0;

/// 保留 2 位小数。
#[inline]
pub fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// 区间线性映射：val 从 [min, max] 映射到 [0, full]，超出部分 clamp。
///
/// 当 `min >= max` 时（如退化输入）输出 0。
pub fn linear(val: f64, min: f64, max: f64, full: f64) -> f64 {
    if max <= min || full <= 0.0 {
        return 0.0;
    }
    if val <= min {
        return 0.0;
    }
    if val >= max {
        return full;
    }
    ((val - min) / (max - min)) * full
}

/// 队伍「理应贡献比」：`val * team_size / team_total`。
///
/// 队总和为 0 时返回 0（避免除零）。
pub fn contribution_ratio(val: f64, team_total: f64, team_size: usize) -> f64 {
    if team_total <= 0.0 || team_size == 0 {
        0.0
    } else {
        (val * team_size as f64) / team_total
    }
}

/// KDA 分：`clamp(sqrt(max(kda - 2, 0)) * 3 / 7, 0, 1)`。
pub fn kda_score(kda: f64) -> f64 {
    if kda <= KDA_BASELINE {
        0.0
    } else {
        ((kda - KDA_BASELINE).sqrt() * KDA_SLOPE).clamp(0.0, FULL_SCORE_KDA)
    }
}

/// 胜负分：赢 1 / 输 0。
pub fn win_score(win: bool) -> f64 {
    if win {
        FULL_SCORE_WIN
    } else {
        0.0
    }
}

/// 伤害分：理应贡献比 ∈ [1.0, 2.0] → [0, 3]。
pub fn damage_score(dmg: f64, team_dmg: f64, team_size: usize) -> f64 {
    let ratio = contribution_ratio(dmg, team_dmg, team_size);
    linear(ratio, RATIO_MIN_DAMAGE, RATIO_MAX_DAMAGE, FULL_SCORE_DAMAGE)
}

/// 承伤分：理应贡献比 ∈ [1.0, 2.0] → [0, 2]。
pub fn damage_taken_score(taken: f64, team_taken: f64, team_size: usize) -> f64 {
    let ratio = contribution_ratio(taken, team_taken, team_size);
    linear(ratio, RATIO_MIN_TAKEN, RATIO_MAX_TAKEN, FULL_SCORE_TAKEN)
}

/// 治疗分：`heal / (队总承伤 / team_size)` ∈ [0.2, 1.4] → [0, 2]。
pub fn heal_score(heal: f64, team_taken: f64, team_size: usize) -> f64 {
    if team_taken <= 0.0 || team_size == 0 {
        return 0.0;
    }
    let team_avg_taken = team_taken / team_size as f64;
    let ratio = heal / team_avg_taken;
    linear(ratio, HEAL_RATIO_MIN, HEAL_RATIO_MAX, FULL_SCORE_HEAL)
}

/// 补刀分：补刀/分 ∈ [5.0, 10.0] → [0, 2]。时长不足 1 分钟记 0。
pub fn cs_score(cs: i32, duration_secs: i64) -> f64 {
    if duration_secs < 60 || cs <= 0 {
        return 0.0;
    }
    let minutes = duration_secs as f64 / 60.0;
    let cs_per_min = cs as f64 / minutes;
    linear(cs_per_min, CS_MIN_PER_MIN, CS_MAX_PER_MIN, FULL_SCORE_CS)
}

/// 经济分：理应贡献比 ∈ [1.0, 1.5] → [0, 2]。
pub fn gold_score(gold: i32, team_gold: i64, team_size: usize) -> f64 {
    let ratio = contribution_ratio(gold as f64, team_gold as f64, team_size);
    linear(ratio, RATIO_MIN_GOLD, RATIO_MAX_GOLD, FULL_SCORE_GOLD)
}

/// 参团分：kp=(击杀+助攻)/队总击杀 ∈ [0.3, 1.0] → [0, 2]。
pub fn participation_score(kills: i32, assists: i32, team_kills: i32) -> f64 {
    if team_kills <= 0 {
        return 0.0;
    }
    let kp = (kills + assists) as f64 / team_kills as f64;
    linear(kp, KP_MIN, KP_MAX, FULL_SCORE_PARTICIPATION)
}

/// 视野分：理应贡献比 ∈ [1.0, 2.0] → [0, 2]。
pub fn vision_score(vision: i32, team_vision: i32, team_size: usize) -> f64 {
    let ratio = contribution_ratio(vision as f64, team_vision as f64, team_size);
    linear(ratio, RATIO_MIN_VISION, RATIO_MAX_VISION, FULL_SCORE_VISION)
}
