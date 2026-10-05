/**
 * 名册墙「历史画像」分析常量。
 *
 * 移植自 Akari `shared/data-adapter/analysis/player/constants.ts`，**只保留 summary 层**
 * （打野/帧级相关常量随之下沉 Rust，见 docs/superpowers/specs/2026-10-05-gaming-roster-wall-design.md ADR-1）。
 *
 * ⚠️ **跨语言同步契约**：本文件的 9 维权重与基线必须与 Rust
 * `src-tauri/src/command/score.rs` 的同名常量**逐项一致**。两侧各有断言测试
 * （本目录 `constants.spec.ts` / Rust 侧 `score_constants_pin_tests.rs`），
 * 任一侧改动必被自己的测试拦下，从而强制另一侧同步。
 *
 * 唯一有意分歧：`WIN_RATE_BASELINE` 服务于**跨局**胜率斜坡，Rust 的
 * `score_participants` 只有单局路径（单局 winRate ∈ {0,1}，斜坡退化为 0/1 满分），
 * 故 Rust 侧无对应常量。详见 `aggregateScore.ts` 的同名说明。
 */

/* ------------------------------------------------------------------ *
 * 跨局「活跃 session」窗口（winLoss.ts 用）
 * ------------------------------------------------------------------ */

/**
 * 判定「本局是否属于当前连续 session」的门槛：最近一场必须在 4 小时内才开始累加。
 *
 * 意图：把「今天打了 8 连胜」与「上周打了 8 连胜」区分开，前者才算活跃连胜。
 */
export const ACTIVE_SESSION_LATEST_WINDOW_MS = 4 * 60 * 60 * 1000

/**
 * 判定「同属一个 session」时相邻两场的最大间隔：超过 8 小时即切段。
 */
export const ACTIVE_SESSION_GAP_MS = 8 * 60 * 60 * 1000

/* ------------------------------------------------------------------ *
 * 9 维权重与基线（与 Rust score.rs 逐项一致，见文件头同步契约）
 * ------------------------------------------------------------------ */

/** KDA 起评分线：`kda - 2` 的部分才计分 */
export const KDA_BASELINE = 2

/** KDA 分数斜率：`sqrt(kda - 2) * 3/7`，kda ≥ 6.1 时封顶 */
export const KDA_SLOPE = 3 / 7

/** KDA 维度满分 */
export const FULL_SCORE_KDA = 1

/** 胜率起评分线（仅跨局聚合用；单局 winRate ∈ {0,1} 时该斜坡退化为 0/1） */
export const WIN_RATE_BASELINE = 0.5

/** 胜率维度满分 */
export const FULL_SCORE_WIN = 1

/** 输出伤害维度满分 */
export const FULL_SCORE_DAMAGE = 3

/** 承伤维度满分 */
export const FULL_SCORE_TAKEN = 2

/** 治疗起评分线：达队均承伤 0.2 倍即开始计分 */
export const HEAL_RATIO_MIN = 0.2

/** 多人队伍（≥3 人）治疗满分线：达队均承伤 1.4 倍 */
export const HEAL_RATIO_MAX = 1.4

/** 单人/双人队伍治疗满分线：达队均承伤 1.0 倍（对应 Rust `team_size >= 3` 的分支） */
export const HEAL_RATIO_SOLO_MAX = 1.0

/** 治疗维度满分 */
export const FULL_SCORE_HEAL = 2

/** 补刀起评分线：5 刀/分 */
export const CS_MIN_PER_MIN = 5

/** 补刀满分线：10 刀/分 */
export const CS_MAX_PER_MIN = 10

/** 补刀维度满分 */
export const FULL_SCORE_CS = 2

/** 经济维度满分 */
export const FULL_SCORE_GOLD = 2

/** 参团率起评分线：0.3 */
export const PARTICIPATION_MIN = 0.3

/** 参团维度满分（参团率 1.0 即满分） */
export const FULL_SCORE_PARTICIPATION = 2

/** 视野维度满分 */
export const FULL_SCORE_VISION = 2

/**
 * 「理应贡献比」起评分线。
 *
 * 该比值 = `本人值 / 队总值 / (1/队伍人数)`，即 1.0 表示「恰好与队均一样」。
 * 伤害 / 承伤 / 视野共用这条基线。
 */
export const RATIO_MIN = 1.0

/** 伤害 / 承伤 / 视野满分线：达 2 倍理应贡献 */
export const RATIO_MAX = 2.0

/** 经济满分线：达 1.5 倍理应贡献（比伤害更早满分，因经济离散度更高） */
export const RATIO_MAX_GOLD = 1.5

/** 跨局综合分满分（9 维之和） */
export const AGGREGATE_SCORE_MAX =
  FULL_SCORE_KDA +
  FULL_SCORE_WIN +
  FULL_SCORE_DAMAGE +
  FULL_SCORE_TAKEN +
  FULL_SCORE_HEAL +
  FULL_SCORE_CS +
  FULL_SCORE_GOLD +
  FULL_SCORE_PARTICIPATION +
  FULL_SCORE_VISION

/* ------------------------------------------------------------------ *
 * 跨局综合分档位（对应 Akari outstanding / extraordinary 两个 tag）
 * ------------------------------------------------------------------ */

/** 「卓越」阈值：总分 ≥ 6.5 且样本 ≥ 5 局 */
export const OUTSTANDING_THRESHOLD = 6.5
export const OUTSTANDING_MIN_COUNT = 5

/** 「非凡」阈值：总分 ≥ 8 且样本 ≥ 8 局 */
export const EXTRAORDINARY_THRESHOLD = 8
export const EXTRAORDINARY_MIN_COUNT = 8

/* ------------------------------------------------------------------ *
 * 筛选口径（analysis 入口丢局时用，与 Akari `isPveOrNonMatchedGame` 对齐）
 * ------------------------------------------------------------------ */

/**
 * PvE 队列白名单排除：以下队列的「胜率/参团/输出占比」与竞技不可比，
 * 混入 50 场窗口会污染画像（Akari 同此排除，故大乱斗玩家在名册墙上无画像）。
 */
export const PVE_QUEUE_IDS = new Set([
  450, // 极地大乱斗 ARAM
  300, // 无限火力 Nexus Blitz
  900, // 末日机器人 Doom Bots
  1000, // 无限乱斗 Odyssey
  700 // 激斗模式 Strawberry
])
