# 对局页名册墙（Akari 卡片墙移植）— 设计方案

> - 日期: 2026-10-05
> - 范围: `rank-analysis-app` 的 `/Gaming` 页（对局中）
> - 对标: `LeagueAkari` 的 `ongoing-game` 面板（本机 `D:\lolzhushou\LeagueAkari`）
> - 效果图: `D:\lolzhushou\gaming-roster-prototype.html`（单文件，浏览器直开）
> - 上游计划: `2026-08-11-akari-optimization-design.md` v1.7（方向 A–E 已落地 M4）
> - 存储对齐: `2026-08-18-storage-schema-v2-design.md` §3
> - 查代码: 一律用 `codegraph`，不要 grep

---

## 0. TL;DR

把 rank 的 `/Gaming` 从「一行式名册」升级为「**情报湾 + Akari 情报卡墙**」：
保留 rank 独有的 BP 决策 / 实时建议层，在其下方新增一条全宽 band，
把 Akari 的 240px 情报卡（50 场战绩 · 英雄使用环 · 打野路径 · 21 Tag）移植过来。

| 项 | 结论 |
|---|---|
| 新增代码量 | TS/Vue ~2,400 行 + Rust ~700 行 + 测试 ~1,500 行 |
| 新增 IPC 命令 | 1 个（批量拉 SGP DETAILS） |
| 新增 SQLite 表 | **0 个**（对齐 storage v2） |
| 新增 npm / cargo 依赖 | **0 个** |
| summary 类分析新增网络请求 | **0 个**（数据已在 session 里） |
| frames 类分析新增网络请求 | 最多 `2 打野位 × N 场`，走 SGP + `buffer_unordered(3)` |

---

## 1. 三个改变方案走向的尽调事实

### 事实 1：50 场 summary + 全员 game_detail 已经在手上（零新增 IPC）

`command/session.rs` 每次 `get_session_data` 对每个玩家：

1. 拉 match history **完整 0..49 窗口**（`MATCH_HISTORY_CACHE`，key=puuid，60s）
2. `enrich_game_detail()` 对每一局调 `GameDetail::get_game_detail_by_id`，
   **并发 3**，把 `Game.game_detail`（全 10 人的 `participants` + `participant_identities`）填满
3. `calculate()` 写 `group_rate` 到 `game_detail.participants`（全 10 人）
4. `calculate()` 用 17 分制写 `game.mvp`

即：**10 人 × 50 场的 summary 与全员 stats 全部已经通过 `session-player-update` 事件送到前端。**

> 推论：胜率 / 场均 KDA / 英雄使用环 / 分路分布 / 输出·承伤·经济占比 / 刀分 /
> 伤金转化 / 视野 / 人头率 / 17 分聚合 —— **全部可以纯前端算，零新增 IPC、零新增网络请求。**
> 这是本方案成本低于直觉的根本原因。

### 事实 2：frames 类分析必须走 SGP，且成本被 3 个因素放大

- `SgpFrameParticipantStats` 已完整暴露 `position` / `damage_stats` / `minions_killed` /
  `jungle_minions_killed` / `level` / `total_gold` / `time_enemy_spent_controlled` —— **无需改结构体**
- 但 `position` 与 `damage_stats` 是 **SGP-only**（LCU 路径恒为 `None`/0）
- `get_sgp_match_detail(region, game_id)` **一次一个 gameId，无批量**
- 最坏情况单次 DETAILS = **3 次传输重试 × 2 代 host/token = 6 次网络尝试**
  （`SGP_MAX_RETRIES=2`；401/5xx 触发 `sgp_league_servers::force_refresh()` + token 刷新）
- 单次超时 15s，`SGP_DETAIL_CACHE`（key `{platform}:{game_id}`，cap 500，**无 TTL** → 重复免费）

> 推论：`10 人 × 20 场` 是不可接受的。必须 **只对打野位** 拉、**默认 6 场**、
> `buffer_unordered(3)`、带熔断（照抄 `cdragon/mod.rs:295` 的 `PREFETCH_FAIL_ABORT_THRESHOLD`）。

### 事实 3：rank 的 Rust 17 分制是「单局分」，不能产出 Akari 的「跨局聚合分」

> ⚠️ **本条在 2026-10-05 实施中被修正。** 初版误判为「两者是同一量的两种实现，
> 移植 Akari scoring 会造出第二个 17 分制」。逐行比对后结论相反。

rank 已有两条**互不相同**的 17 分制路径：

| | per-game（单局） | cross-game（跨局聚合） |
|---|---|---|
| 实现 | `command/score.rs::score_participants(&[PlayerScoreInput])` | Akari `aggregate/akari.ts` + `scoring.ts` —— **rank 尚无** |
| 输入 | 单局 10 人（内部按 `team_id` 分组求和） | 一个玩家最近 N 局的 per-game 汇总行 |
| KDA / 胜负 | 该局 `(K+A)/D`、赢=1 输=0 | **跨局** `avgKda` 与连续 `winRate` 斜坡 |
| 伤害/承伤/经济/视野 | 该局内算占比 | **先按局算分再取均值** `avg(score(game_i))` |
| 治疗/补刀/参团 | 该局值 | **聚合值**算分 |
| 现行消费者 | `MatchDetailScoreTab`、`calculate()` 的 MVP/SVP、`scouting` 威胁评级、`backtest` | 无（本次新增，名册墙「17分」徽章） |

**关键结论**：两者数学结构不同，是**同名不同量**，不是重复实现。
把 50 局一次性喂给 `score_participants` 会让其按 `team_id` 跨局求和，结果无意义。
名册墙需要的跨局综合分**必须新增实现**。

### ADR-2（修正）：跨局聚合分在 TS 侧实现 + 跨语言常数钉子

三个选项与取舍：

| 选项 | 结论 |
|---|---|
| A. Rust 加 `compute_aggregate_akari_score` | 公式全在 Rust、零漂移。但需新增 ~150 行**本机无法编译验证**的 Rust（无 linker，见 R9），且每局 ratio 仍在前端算 |
| **B. TS 侧实现（选定）** | 可本地 `npm run test` 完整验证；有先例（`features/gaming/services/lineupScore.ts` 即 TS 侧确定性评分器 + 自带阈值表）。per-game ratio 与 scoring 分层，漂移面小 |
| C. 用 per-game 分近似 | ❌ 名片墙与详情页同名分数含义混乱，不做 |

**选定 B**，并附加两道防线：

1. **命名隔离**：per-game 沿用 `PlayerScore`（Rust 权威）；跨局聚合另立 `aggregateScore`。
   文档与注释显式标注两者是「同名不同量」，禁止互相代入。
2. **跨语言常数钉子**：9 维权重/基线在 `analysis/constants.ts`（TS）与
   `command/score.rs`（Rust）各写一组**字面量相同的断言测试**。任一侧改常数 →
   该侧测试变红 → CI 强制另一侧同步。把「静默分叉」降级为「改常数必被拦」。

后续若钉子摩擦过大，可升级为选项 A（把聚合搬回 Rust），届时 TS 侧只剩 ratio 计算。

### 附带发现：一个真 bug（独立处理，不要混进本方案）

`scouting/mod.rs:362` 调用 `score_participants(&[input])` 传**单元素切片**。
`contribution_ratio(x, x, 1)` 恒为 1.0 ⇒
**6 个 team-relative 维度（17 分里的 11 分）对每个敌人都是常数**，
`threat_level` 实际只由 KDA + 刀分 + 胜负驱动。

修法:传全 10 人 input 向量（`scouting` 手里已有 `game_detail.participants`）。
这是**行为变更**，会让敌方威胁评级明显变化 —— **必须独立 PR，附 before/after 对照**。

---

## 2. 架构决策（ADR）

### ADR-1 分析分层：summary 留前端，frames 下沉 Rust

切分线不是「复杂度」，而是**数据可得性**：

| 层 | 输入 | 归属 | 理由 |
|---|---|---|---|
| summary 聚合 | `Game` + `game_detail.participants`（已在手） | **前端 TS** | 纯函数、零 IO，可直接复用 Akari 的 1,000 行实现 |
| frames 分析 | SGP DETAILS `frames`（必须网络） | **Rust** | 复用 `sgp.rs` 类型 + `score/events.rs`(800行/13测试) 的成熟模式 + `moka` 缓存 + `spawn_blocking` 纪律 |

Akari `analysis/player/` 按此切分：

```
留前端 (≈1,150 行)               下沉 Rust (≈530 行)
  single/summary.ts    111         single/jungle.ts       177
  aggregate/summary.ts  72         single/objectives.ts    73
  aggregate/win-loss.ts 94         single/details.ts       40
  aggregate/positions.ts 28         single/early-deaths.ts  32
  aggregate/team-side.ts 11         aggregate/jungle.ts    207
  aggregate/spells.ts   12
  aggregate/champions.ts 32  ← 去掉 jungle 分支
  scoring.ts            69  ← 移植（ADR-2：跨局聚合分必需）
  single/akari.ts       73  ← **不移植**（per-game 分由 Rust 权威产出）
  aggregate/akari.ts   108  ← 移植（avg(score(game_i)) 结构 Rust 无法产出）
  utils/{math,empty}.ts 50
  types/*.ts           329
  ────────────────────        utils/geometry.ts         52
                             constants.ts 里的营地坐标/分区魔数
```

`utils/geometry.ts`（`detectStartCamp` / `classifyMapZone` / `classifyGankLane`）
**全部依赖 frames**，随之下沉。前端不需要它。

### ADR-2 17 分制的两条路径分离（详见「事实 3」的修正）

per-game 分（`PlayerScore`，Rust 权威，MVP/详情页/回测在用）**不移植、不改写**。
cross-game 聚合分（`aggregateScore`，名册墙徽章）**必须新增**，按「事实 3」的选项 B
在 TS 侧实现，并配跨语言常数钉子。两者是**同名不同量**，命名与注释必须显式区分。

### ADR-3 数据来源与限额

| 数据 | 来源 | 限额 |
|---|---|---|
| 50 场 summary + game_detail | `SessionSummoner.matchHistory`（已有） | 无 |
| 段位 | `SessionSummoner.rank.queueMap`（已有） | 无 |
| 遇见过 / 预组 | `meetTotal` + `preGroupMarkers`（已有，比 Akari 的历史推断更准） | 无 |
| 17 分（徽章展示） | **新增** `aggregateScore`（TS，ADR-2 选项 B） | 无 |
| 英雄熟练度 | `RecentPlayerProfile.currentChampionMastery`（已有，需按人取 profile） | 无 |
| 打野路径 / 前期死亡 / 目标节奏 | **新增** `get_player_timelines` | **只对 2 个打野位 × 默认 6 场** |

设置项（新增，对齐 Akari 语义）：

| key | 默认 | 说明 |
|---|---|---|
| `gaming.rosterWall.enabled` | `true` | 总开关 |
| `gaming.rosterWall.loadCount` | `50` | 每人战绩条数（对齐 Akari `matchHistoryLoadCount`） |
| `gaming.rosterWall.timelineGameCount` | `6` | 打野路径样本场数（Akari 是 20，SGP 成本必须压低） |
| `gaming.rosterWall.showJunglePathing` | `true` | 打野路径总开关 |
| `gaming.rosterWall.showJungleForAll` | `false` | 非打野位也显示（用其最常用打野英雄） |
| `gaming.rosterWall.showChampionUsage` | `'recent'` | `recent \| mastery \| none` |
| `gaming.rosterWall.orderPlayerBy` | `'position'` | `default\|position\|premade\|winrate\|kda\|akari` |
| `gaming.rosterWall.showMatchItemBorder` | `false` | 战绩行描边 |
| `gaming.rosterWall.playerTags` | 见 §5 | 21 个独立布尔，同 Akari 的 `z.looseObject` 校验 |

### ADR-4 布局：新增独立 band，**不动** `.roster`

插入点：`Gaming.vue` **313 行**（`.intel-bay` 闭合）之后、**315 行**（`<!-- ==== 名册 ==== -->`）之前。

理由：

- `.gaming-page` 是普通块容器，新 band 作为直接子元素天然全宽；而 `.roster` 自限
  `max-width: 2600px`，两者不冲突
- `.roster` 的定位是「选人期决策行」（OP.GG 梯度 chip、BP pickState、段位切换）
  —— **产品定位不同，不是同一件东西的两种画法**
- 动 `.roster` 会连带 6 个测试文件（`RosterRow.spec` / `Gaming.roster.spec` 等）与 350 行组件
- 与 `roster.ts:5-8` 记录的设计意图一致：**名册是常驻块，不能变成第二套页面结构**

两者共存，靠密度档互斥展示：

| 视口宽度 | 情报湾 | 名册墙 | `.roster` |
|---|---|---|---|
| ≥ 1400px | ✓ | ✓ | ✓ |
| 900–1400px | ✓ | ✓（3 列） | ✓ |
| < 900px | ✓ | ✗ | ✓（minimal） |

### ADR-5 不新建 SQLite 表，对齐 storage v2

storage v2 §3 已定义 `games.json_payload`（SGP DETAILS 原始，标注「**备用重算**」）+
`participants` + `scores` + `timeline_events`。

> 打野路径是 **纯派生量**，可由 `games.json_payload` 完全重算 ⇒ **不落盘**。
> 若 v2 落地，缓存走 `games` 表的 json_payload；
> v2 未落地期间走 `SGP_DETAIL_CACHE`（无 TTL，已够用）。

明确否决：`meet.db` 新建 `player_timeline` 表 —— 违反 v2「避免各建各表」原则。
`meet.db` 的 `collected_games_v2.game_json` 已存全量 `Game`（含 `game_detail`），
第一版直接扫它做 summary 聚合，零网络（照抄 `scouting::build_games_index` 的全表扫 + 倒排索引）。

### ADR-6 列数公式直接复用 Akari

```
columnsNeed = min(
  first col in [8,7,6,5,4,3] where contentWidth > 240 * (col + 0.25),
  maxTeamSize
)
```

原型已实现并验证（`gaming-roster-prototype.html` 的 `calcCols`），含 resize 重算。
**注意**：原型第一版写死 5 列导致「左右分栏」撑破布局 —— 已修，切勿回退。

---

## 3. Tag 可得性分级（21 个）

移植前必须先分清哪些能算、哪些要额外数据 —— 否则会做出「有 tag 但数据是空的」假实现。

### A 类：零新增数据（15 个）— 纯前端

| Tag | 阈值（沿用 Akari） | 数据 |
|---|---|---|
| 我 | `puuid === myPuuid` | 已有 |
| 预组 A/B/C | `preGroupMarkers` 非空 | 已有（比 Akari 更准） |
| 遇见过 | `meetTotal > 0` | 已有 |
| 连胜 N | `winningStreak >= 3` | 新算 |
| 连跪 N | `losingStreak >= 3` | 新算 |
| 高胜率 | `count >= 16 && winRate >= 0.85` | 新算 |
| 卓越 | `score >= 8 && count >= 8` | 已有 17 分 |
| 17 分 N | `score.toFixed(2)` | 已有 |
| 输出占比 N% | `avgChampionDamagePercentageOfTeam` | 新算 |
| 承伤占比 N% | `avgDamageTakenPercentageOfTeam` | 新算 |
| 经济占比 N% | `avgGoldPercentageOfTeam` | 新算 |
| 刀分 N | `avgCsPerMinute` | 新算 |
| 伤金 N% | `avgDamageGoldEfficiency` | 新算 |
| 视野 N | `avgVisionScore` | 新算 |
| 人头怪 / 伤害型 | `avgKillDamageEfficiency > 1.35 / < 0.65` | 新算 |

### B 类：需 SGP summary 字段（2 个）— SGP 路径才有，否则 tag 隐藏

| Tag | 说明 |
|---|---|
| 单杀 N | `avgSoloKills`，**LCU 路径为 null**（Akari 同此降级） |
| 敌人消失 N | `avgEnemyMissingPings`，同上 |

### C 类：需 SGP frames（4 个）— P4 才有

| Tag | 阈值 | 依赖 |
|---|---|---|
| 极好抓 | `avgEarlyDeaths > 2` | frames + 敌方打野识别 |
| 好抓 | `>= 1.5` | 同上 |
| 难抓 | `< 1` | 同上 |
| 可疑闪现 | `flashOnD > 0 && flashOnF > 0` | frames + 召唤师技能历史 |

### 不可得（1 个）

**隐私 tag** —— Akari 从 `summoners[].privacy`（LCU）取；rank 的 `Summoner` 类型无此字段，
LCU `/lol-summoner/v2/summoners/puuid/{puuid}` 也不返回。**直接不做**，或从 SGP
`/gsm/v1/ledge/...` 单独评估（不在本方案范围）。

---

## 4. 分阶段实施

每阶段独立可发布、独立可验证。**不要合并成一个大 PR。**

### P0 — 修 `scouting` 单元素切片 bug（独立 PR，可选但建议先做）

| 文件 | 改动 |
|---|---|
| `src-tauri/src/scouting/mod.rs` | 新增 `participant_score_in_game()`（队级聚合），循环改为把整局输入喂给 `score_participants`；抽出 `participant_id_of()` |

**已验证 / 未验证**（本机无 MSVC linker，见 R9）：

| 项 | 状态 | 手段 |
|---|---|---|
| 语法有效 + 格式合规 | ✅ | `cargo fmt --check` 退出 0 |
| 测试能真正捕获该 bug | ✅ | 把 `score_dimensions`/`linear`/`contribution_ratio` 精确移植为 JS，验证修复前两人同为 `4.0166`（相等 ⇒ 旧实现必然挂）、修复后 `5.0166 > 2.0166` |
| 5 人排序单调性断言 | ✅ | 同上数值验证：修复后 `4.73 ≥ 3.30 ≥ 2.02 ≥ 2.02 ≥ 2.02`，首尾严格递减；修复前 5 人全同 |
| 类型 / 字段名 | ✅ | 逐个回源核对（`Stats` 而非 `ParticipantStats`、`GameDetail` 三字段、`GameDetailPlayer` 七字段、`Stats` 11 字段均存在且 derive `Default`） |
| 编译 / clippy / 测试执行 | ❌ | 需 CI |

> 数值验证直接抓出了两个我自己写错的断言：① 首版夹具给 p1/p2 设了不同 `kills`，
> 而 KDA **不是** team-relative ⇒ 修复前两人就不相等 ⇒ 测试**抓不到 bug**；
> ② 首版断言「严格递减」过强 —— `linear(ratio,1,2,3)` 在 ratio ≤ 1.0 时一律 0 分，
> 低占比者并列在 0 分地板上。已改为「除 dmg 外全同」+「单调不增 + 首尾严格递减」。

验收：`cargo test` 绿（**依赖 CI**）；附 `get_threat_ratings` 对同 5 个敌人 before/after 对照表（会变）。
**这是行为变更，单独 PR，changelog 标注。**

### P1 — Rust：批量 timeline 管道（无 UI）

| 文件 | 类型 | 内容 |
|---|---|---|
| `src-tauri/src/lcu/api/sgp.rs` | 改 | 导出 `fetch_match_detail` 已有的缓存命中路径；加 `Arc<Semaphore>` 全局 SGP 并发闸（对齐 `LCU_SEMAPHORE` 的 20，但 SGP 用 4） |
| `src-tauri/src/timeline/mod.rs` | **新** | 纯函数：`jungle_pathing()` / `early_deaths()` / `objectives()`（移植 Akari 530 行） |
| `src-tauri/src/timeline/geometry.rs` | **新** | `detect_start_camp` / `classify_map_zone` / `classify_gank_lane` + 营地坐标常量 |
| `src-tauri/src/timeline/constants.rs` | **新** | `ANALYSIS_MINUTES=14` / `KILL_WEIGHT=5` / `EARLY_LIMIT=15min` |
| `src-tauri/src/command/timeline.rs` | **新** | `get_player_timelines(region, game_ids: Vec<i64>) -> HashMap<i64, Option<PlayerTimeline>>` |
| `src-tauri/src/main.rs` | 改 | `generate_handler!` 加 **1 行** |

`get_player_timelines` 契约（照抄 `get_sgp_ranks_by_puuids` 的三条不变式）：

```rust
/// 批量拉取 SGP DETAILS 并做逐玩家帧级分析
/// - 单局失败 => 该局 None，整个批次不失败
/// - 缓存命中直接返回，不发请求
/// - 并发上限 buffer_unordered(3) + 全局 Semaphore(4)
#[tauri::command]
pub async fn get_player_timelines(
    region: String,
    game_ids: Vec<i64>,
) -> HashMap<i64, Option<PlayerTimeline>>;
```

`PlayerTimeline` = `{ game_id, puuid→analysis map, framesAnalyzed, degraded: Option<String> }`。
`degraded` 非空 = SGP 不可用 / 无帧 / `position` 为 None（LCU 路径）。

**验收**：
- `timeline/*_tests.rs` ≥ 12 个单测（含 `mapId !== 11` 降级、无 frames 降级、非打野降级）
- `score/golden.rs` 同构：造一份 `timeline/golden.rs` 金标准 corpus
- 熔断测试：连续 N 次 5xx 后短路返回全 None
- ⚠️ `cargo` 本机可能不可用（见 akari-optimization v1.4 备注），需确认 CI 覆盖

### P2 — TS：summary 分析引擎（无 UI）

新目录 `src/features/gaming/analysis/`：

| 文件 | 移植来源 | 行数 |
|---|---|---|
| `types.ts` | `analysis/player/types/{single,aggregated,helpers}.ts` | ~300 |
| `constants.ts` | `analysis/player/constants.ts`（只留 summary 相关） | ~40 |
| `utils.ts` | `analysis/player/utils/{math,empty}.ts` | ~60 |
| `matchBasic.ts` | `data-adapter/match-history/match-basic.ts` | ~55 |
| `participant.ts` | `data-adapter/match-history/participants.ts` 的**精简子集**（只读 rank 的 `Participant`/`ParticipantStats`） | ~150 |
| `singleSummary.ts` | `analysis/player/single/summary.ts` | ~115 |
| `aggregateSummary.ts` | `analysis/player/aggregate/summary.ts` | ~75 |
| `winLoss.ts` | `analysis/player/aggregate/win-loss.ts` | ~95 |
| `positions.ts` | `aggregate/positions.ts` + `team-side.ts` + `spells.ts` | ~55 |
| `champions.ts` | `aggregate/champions.ts`（去 jungle） | ~35 |
| `akariAggregate.ts` | 移植 `aggregate/akari.ts`（**不做薄壳** —— avg(score(game_i)) 结构 Rust 无法产出，见 ADR-2） | ~110 |
| `index.ts` | `analysis/player/index.ts` 编排 | ~140 |

`src/features/gaming/services/playerAnalysis.ts`（新，~250 行）：
从 `SessionSummoner[]` → `AggregatedAnalysis[]`，带 moka 等价的模块 LRU（key = puuid + 数据签名）。
**纯本地计算**：`computeAggregatedSummary` / `winLoss` / `positions` / `champions` /
`aggregateScore` 全部是纯函数，零 IO。跨局聚合分直接由 per-game ratio 算出，
**不经过任何 IPC**（这一点与初版方案不同，见 ADR-2）。

**验收**：
- 每个文件配 sibling `*.spec.ts`（仓库主流 colocated 风格）
- **直接搬 Akari 的 6 个测试文件的用例**（`akari.test` / `win-loss.spec` / `champions.spec` /
  `geometry.spec` / `math.spec` + `match-history-fixtures.test`）—— 有现成金标准
- 覆盖率：utils 90%+ / services 70%+（对齐 CLAUDE.md）
- ⚠️ **不可移植**：`analysis/player/index.ts` 里的 **MobX reaction 缓存**机制
  （Akari 用 `previous.map[gameId]` 判断 details 有无变化来跳过昂贵 timeline 计算）
  在 rank 无对应物。改为**纯函数 + 上层按 gameId 集合 memo**

### P3 — Rust：frames 分析接线（把 P1 的纯函数接上真实路径）

| 文件 | 改动 |
|---|---|
| `command/timeline.rs` | 调 `sgp::fetch_match_detail` + `timeline::*` 纯函数 + puuid 对齐 |
| — | ⚠️ **SGP `participantId` ≠ LCU `participantId`**，一律按 puuid 对齐（照 `score/mod.rs:44-54`） |

**验收**：真实 SGP 响应结构联调；`degraded` 路径全覆盖测试。

### P4 — 名册墙 UI（最大的一块）

新目录 `src/components/gaming/roster-wall/`：

| 文件 | 复刻 Akari | 行数 |
|---|---|---|
| `RosterWall.vue` | `OngoingGamePanel.vue` | ~180 |
| `RosterWall.styles.css` | 同上（>200 行必须外置 + 结构金丝雀） | ~250 |
| `TeamBlock.vue` | `OngoingGameTeam.vue` | ~70 |
| `TeamBlock.styles.css` | | ~60 |
| `PlayerCard.vue` | `PlayerInfoCard.vue` | ~120 |
| `PlayerCard.styles.css` | | ~300 |
| `PlayerCardHeader.vue` | `PlayerInfoCardHeader.vue` | ~110 |
| `PlayerCardStats.vue` | `PlayerInfoCardStats.vue`（三栏 + IQR + 分路） | ~140 |
| `PlayerCardChampions.vue` | `PlayerInfoCardChampionUsage.vue`（环 + 星） | ~90 |
| `PlayerCardHistory.vue` | `PlayerInfoCardMatchHistory.vue` | ~130 |
| `PlayerCardJungle.vue` | `PlayerInfoCardJunglePathing.vue` + `GankMap.vue` | ~200 |
| `playerTags.ts` | `player-card-tags/` 全部（21 个定义） | ~700 |
| `PlayerTagChip.vue` | `TagsArea.vue` | ~80 |
| `constants.ts` | `ongoing-game-panel/constants.ts`（含 `PREMADE_TEAM_COLORS` 12 色） | ~110 |

`Gaming.vue` / `Gaming.styles.css`：插入 band + `columnsNeed` + 密度档。
设置项接入 `features/settings/stores/setting`。

**设计系统禁令（CODE_QUALITY.md，硬约束）**：
- 禁硬编码 hex/rgba → 一律走 `styles/tokens.css` 语义 token。
  ⚠️ **Akari 的 21 个 tag 色板是硬编码色**（`#37246c` / `#7e2c85` / …），
  必须映射到 `--brand*` / `--win*` / `--loss*` / `--warn*` + 新增 `--tag-N` 语义层，**不得直接搬**
- z-index 只用 5 档（`--z-content/sticky/dock/modal/toast`）
- 最小字号 10px（`--font-size-2xs`）。⚠️ Akari tag 用 11px、`pc-sub` 用 9.5px 需上调
- 动画只 `--dur-*` / `--ease-expo`
- `--brand*` 金色只留给结论/激活/关键强调，**胜负数据必须 `--win` / `--loss`**
- 切角：容器 `--clip-corner-md/sm`，控件 `--clip-notch`，**一屏只用一档容器切角**，
  且不得与 border-radius 混用
- **新页面沉浸横幅一律用 `components/ui/PageStage.vue`**，不手写 hero 区块

**i18n**：仓库**无 i18n 框架**，全部硬编码中文。禁止引入 `$t()`。

**验收**：
- `views/__tests__/Gaming.rosterWall.spec.ts` —— **结构金丝雀**：锁定
  `<style scoped src="./RosterWall.styles.css">` 引用 + 关键选择器存在（防样式静默丢失）
- `RosterWall.spec.ts` / `PlayerCard.spec.ts` ≥ 60% 覆盖
- 复用 `components/record/TrendBar.vue`（226 行，`TrendCell` 8 标量设计）作为战绩行组件 ——
  **不要重写**，它已有 MVP 点与死亡格指示
- 复用 `components/ui/StatChip.vue` / `ChargeRing.vue` / `VerdictBanner.vue`

### P5 — 打野路径卡 + 设置项

| 文件 | 内容 |
|---|---|
| `PlayerCardJungle.vue` | 74px 峡谷缩略图 + 帧热力格（上/中/下 红黄蓝，`KILL_WEIGHT=5`）+ 首刷/Lv3/Lv4 |
| 峡谷底图 | `assetPrefix + '/map/11'`（需在 `command/asset.rs` 补 map11 供给，先例：`cherry-augments`） |
| 设置 | §3 ADR-3 的 9 个 key |

**降级纪律（对齐 `score/mod.rs` 的 `timeline_available`）**：
SGP 不可用 / 无帧 / `position` 为 None ⇒ **显示「无数据」而不是空白或编造**。

**验收**：C 类 4 个 tag 生效；降级路径全覆盖测试。

### P6 — 收尾

- 密度三档（`full 375 / normal / minimal`）对齐现有 `rosterDensity` 判据
- 性能：卡片 `content-visibility: auto` + `containIntrinsicSize: 375px`（Akari 同款）
- 段位补拉：`useMatchPlayerRanks`（跨区 SGP / 本区 LCU，30min Rust 缓存）
- 门禁全绿 + 覆盖率不回退（`vitest.config.ts` 的 global threshold 会 fail build）

---

## 5. 文件清单汇总

### 新增（24 个）

```
src/features/gaming/analysis/           12 个 ts + 12 个 spec
src/features/gaming/services/playerAnalysis.ts + spec
src/components/gaming/roster-wall/      13 个 vue/css/ts + spec
src-tauri/src/timeline/                 mod.rs / geometry.rs / constants.rs + *_tests.rs
src-tauri/src/command/timeline.rs
docs/superpowers/specs/2026-10-05-gaming-roster-wall-design.md   ← 本文件
```

### 改动（8 个）

```
src/views/Gaming.vue                     插入 band（~15 行）
src/views/Gaming.styles.css             band 容器样式（~25 行）
src/views/__tests__/Gaming.roster.spec.ts  加 band 选择器断言
src/features/settings/stores/setting.ts  9 个 key
src-tauri/src/lcu/api/sgp.rs             全局 SGP 并发闸
src-tauri/src/lcu/api/asset.rs           map11 底图供给
src-tauri/src/main.rs                    generate_handler! +1 行
src-tauri/src/scouting/mod.rs            （P0，独立 PR）
```

**不动**：`RosterRow.vue` 及其 6 个测试、`features/gaming/roster.ts`、
所有 `components/record/*`、`command/score.rs` 的评分语义。

---

## 6. 风险登记

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| R1 | SGP 请求放大 6× × 200 次 | 页面卡死 / 令牌被打爆 | `buffer_unordered(3)` + `Semaphore(4)` + 熔断（抄 `cdragon/mod.rs:295`）+ 默认 6 场 + **只对打野位** + 懒加载（卡片进视口才拉） |
| R2 | `SGP_DETAIL_CACHE` cap 500 无 TTL，可能挤掉战绩页缓存 | 详情页变慢 | 考虑独立 cache 实例 + 独立容量；或 P1 就用 cap 200 的专用 cache |
| R3 | `position`/`damage_stats` SGP-only | LCU 路径静默无数据 | `degraded` 显式字段 + 「无数据」占位，**绝不编造**（仓库既有纪律） |
| R4 | 卡内 50 场 × 10 人 = 500 行 DOM | 滚动掉帧 | `content-visibility:auto` + `containIntrinsicSize`；Akari 用 `NVirtualList`（itemSize 36）—— rank 侧用同等虚拟滚动或默认只渲染 5 行 + 展开 |
| R5 | release profile `lto=true` + `codegen-units=1` | Rust 改动编译极慢 | P1 的 Rust 改动尽量一次成型；接受迭代变慢 |
| R6 | 21 tag 色板与 `CODE_QUALITY` 硬编码禁令冲突 | 门禁 fail | 先建 `--tag-*` 语义 token 层，再搬；Akari 的 9px 字号需上调到 10px |
| R7 | `.roster` 与新 band 视觉重复 | 信息冗余 | ADR-4 的密度档互斥表；band 定位为「历史画像」、`.roster` 定位为「本局决策」 |
| R8 | `scouting` 修复后威胁评级大幅变化 | 用户感知「变聪明了」 | 独立 PR + before/after 对照 + changelog |
| R9 | **本机 Rust 不可编译**（实测 2026-10-05）：`cargo 1.98.1` 已安装，但 `link.exe` 缺失（VS 2022 目录存在却**未装 C++ workload**，无 vcvars64.bat）。`cargo test` / `cargo check` **均失败**——proc-macro 与 build-script 必须链接，故 `check` 也过不去。仅 `cargo fmt` 可用（不需要链接器） | Rust 部分无法本地验证 | ① 用 `cargo fmt --check` 把住语法与格式；② 用等价语言精确移植评分公式做**数值双向验证**（见下）；③ 类型/字段名逐个回源核对；④ 剩余交 CI 兜底（仓库既有约定，见 akari-optimization v1.4/v1.6）。**若需本地跑 Rust 门禁**：装 VS 2022 Build Tools 的 C++ workload（约 2–7 GB，系统级改动，需用户决策） |
| R10 | Akari analysis 有 15 个测试文件可搬 | 移植引入回归 | 逐文件搬测试，不重写；`Date.now()` 在 `win-loss` 里被直接调用 → 需注入时钟 |

---

## 7. 门禁

```bash
cd rank-analysis-app
npm run check      # prettier + eslint + vue-tsc + cargo fmt + clippy -Dwarnings
npm run test       # vitest（global coverage threshold 会 fail build）
cd src-tauri && cargo test
```

**额外人工门禁**（`npm run check` 查不出来的）：
1. `npm run tauri dev` 真机走查：选人期 → InProgress → 结束三阶段
2. 跨区（SGP）vs 本区（LCU）**两条路径各走一遍**，确认 `degraded` 表现
3. 网络断开 → 确认卡片降级不崩、不空、不编造
4. CHERRY（斗魂 1–8 小队）确认分组与 `CHERRY-` teamIdentifier 兼容

---

## 8. 待你拍板的 3 个点

1. **`.roster` 的去留** —— ADR-4 选的是「共存 + 密度档互斥」。
   若你认为两套名册冗余，替代方案是 `.roster` 仅在 `ChampSelect` 阶段渲染
   （改动更小，但要动 `RosterRow` 的 6 个测试）。

2. **打野路径默认场数** —— 建议 6（成本/收益平衡）。
   Akari 是 20，但它主要走 LCU `game-timelines`（本地，不是 SGP 网络）。若你更看重样本量可给 10，
   代价是首屏多 ~80 次 SGP 请求。

3. **是否先做 P0 的 `scouting` 修 bug** —— 会改变现有威胁评级输出。
   建议做（否则敌方威胁评级本来就是坏的，新 band 的评分会与之矛盾），但要独立 PR。

---

## 10. 实现状态（2026-10-07）

分支 `feat/gaming-roster-wall`。P0 / P2 / P4 / P6 已完成并提交；P1 / P3 / P5 待做。
P1/P3/P5 依赖 Rust 侧，而本机缺 MSVC `link.exe`（proc-macro / build-script 均需链接），
编译与测试一律交 GitHub Actions，**不要在本机装 Build Tools**。

| 里程碑 | 状态 | 提交 | 规模 | 备注 |
|---|---|---|---|---|
| P0 修 `scouting` 队级聚合 | ✅ | `c5d9b38` | +169/−10 | 本机无 linker，编译与测试执行由 CI 兜底；已用等价实现做数值双向验证 |
| P2 TS summary 分析引擎 | ✅ | `acecb5a` `28ab2ac` `5f7a960` `0fc16e0` `f3b78e5` | ~2,000 | 8 模块 + 接入层，207 测试 |
| P4 名册墙 UI + 接线 | ✅ | `aba20c3` `2ca225a` `d3b97ca` | ~2,400 | 9 组件 + 3 feature 模块 + 接线测试 51 例；结构金丝雀 4 组 |
| P6 对局详情弹窗 | ✅ | `518b5e0` | +230/−27 | 复用 `getGameById` + `MatchDetailInline`，零新增后端 command |
| P1 Rust 批量 timeline 管道 | ✅ | `a7a1cfc` `ff7a5c5` `c12f429` `0ad722d` `d4847da` `037f4c0` `fea4bf0` `50297fc` `c234913` | ~900 | 4 文件 + 80 测试；CI 全绿（750 Rust 测试） |
| P3 Rust frames 分析 | ⬜ | — | ~500 | 打野路径 / 前期死亡 / 目标节奏 |
| P5 打野路径卡 + 9 设置项 | ⬜ | — | ~350 | 依赖 P1+P3 |

### P4 已交付模块

| 文件 | 职责 |
|---|---|
| `features/gaming/roster-wall/playerTags.ts` | 21 个 Tag 语义定义 + KDA IQR 离群判定 + Tag 阈值 |
| `features/gaming/roster-wall/columns.ts` | 列数公式单点实现（复刻 Akari 并补 gap 折算） |
| `features/gaming/roster-wall/member.ts` | `RosterWallMember` 展示模型（session + 分析结果 → 视图） |
| `components/gaming/roster-wall/PlayerTagChip.vue` | 8 语义色调族 + 条件 detail popover |
| `components/gaming/roster-wall/PlayerCardHeader.vue` | 头像/等级/昵称/段位双芯片 + 4 个头部 Tag |
| `components/gaming/roster-wall/PlayerCardStats.vue` | 胜率 / 跨局 KDA（IQR 离群染色）/ 分路 |
| `components/gaming/roster-wall/PlayerCardChampions.vue` | 英雄使用环，环色按该英雄胜率 |
| `components/gaming/roster-wall/PlayerCardHistory.vue` | 最近对局列表（折叠 5 行）+ 对局详情弹窗 |
| `components/gaming/roster-wall/PlayerCard.vue` | 240×375px 固定卡外壳（Akari 契约） |
| `components/gaming/roster-wall/TeamBlock.vue` | 队伍块 + 「无画像」空态卡 |
| `components/gaming/roster-wall/RosterWall.vue` | 上下堆叠容器 + ResizeObserver 实测列宽 |

### P1 已交付模块

| 文件 | 职责 |
|---|---|
| `timeline/constants.rs` | `ANALYSIS_MINUTES=14` / `EARLY_LIMIT_MS` / `KILL_WEIGHT` / 脏数据熔断阈值 / `Degraded` 枚举 |
| `timeline/geometry.rs` | 地图区域分桶 + 营地识别（`Camp`） |
| `timeline/mod.rs` | 纯函数分析：清野路径 / 前期死亡 / 资源节奏 |
| `timeline/tests.rs` | 26 例 |
| `command/timeline.rs` | `get_player_timelines` + 批量/限流/熔断 |

### P1 期间修正的实现细节（后续接手须知）

**最重要的一条：营地靠 `monster_type` 识别，不靠像素坐标。**
原计划是「移植 Akari 的营地坐标常量表」，但那套坐标一旦记错（版本间地形微调
也会漂移）不会报错、只会让路径推断整体失真，且极难从测试里看出来。改为读帧事件
自带的 `monster_type`/`monster_sub_type`（语义标识）——**读数据**而非**猜几何**。
坐标只用于粗粒度分桶（半场/三条路/河道），阈值放宽。

其余 5 条：

| # | 问题 | 后果 | 修法 |
|---|---|---|---|
| 1 | **常量表键漏归一化**：`normalize_event_type` 把 `CHAMPION_KILL` 归一成 `championkill`，而表里写的是 `champion_kill` | **不报任何错**，所有击杀都识别不出；`early_deaths` 恒 0、路径恒空、脏数据熔断永不触发 | 键改归一化形式 + 新增「键必须归一化」的幂等断言 |
| 2 | 坐标前置校验只看**事件**坐标 | 有 `participant_frames` 但事件不带坐标的合法帧（**线上常见形态**）被整局误判降级 | 两个来源都看，任一可信即通过 |
| 3 | `GameDetail.participant_identities` 元素类型是 `model::ParticipantIdentity` | P0 提交时就编不过（本机无 linker，直到本次 CI 才暴露） | 修 P0 夹具 |
| 4 | clippy `-D warnings`：`assertions_on_constants` / `for_kv_map` | CI 直接失败 | const 块 + `values_mut()` |
| 5 | **`Game` 域模型有两套形状**（P2 时期踩过，P1 又踩） | fixture 写错时静默全量剔除 | 见 P2/P4 节的同款记录 |

> 关于第 1 条的教训：**静默失效比崩溃危险**。这类"归一化后与常量表比对"的模式
> 必须配一条幂等断言（对每个键跑一遍归一化函数，要求结果不变），
> 否则常量表和归一化函数任何一侧的改动都会静默生效。

---

## 10.1 CI 验证闭环（本机无 linker 时的做法）

本机缺 MSVC `link.exe`（proc-macro/build-script 均需链接），`cargo check/clippy/test`
全部失败。仓库的 `quality-checks.yml` 留了 `workflow_dispatch`，注释写明
「便于在 fork 上直接跑完整门禁」，闭环：

```powershell
git push fork <branch>
gh workflow run quality-checks.yml --ref <branch> --repo lnsjcr0873/rank-analysis
gh run watch <run-id> --repo lnsjcr0873/rank-analysis --exit-status
gh run view <run-id> --repo lnsjcr0873/rank-analysis --log-failed   # 读错误
```

**必须带 `--repo`**：`gh` 会把仓库解析成 `origin`（上游），对非管理员账号返回 403。

Rust 侧一轮约 5~8 分钟（要装 toolchain + 编译 Tauri 全量依赖）。P1 用了 7 轮收敛。

### P4/P6 期间踩到的坑（后续接手须知）

1. **`Game` 域模型有两套形状**，写 fixture 前必须分清：
   - puuid **只在** `participantIdentities[].player.puuid`，`Participant` 上没有 puuid；
   - `gameType` 口径是 `'MATCHED_GAME'`（对齐后端 `sgp.rs` / `db.rs`），不是 `'MATCHED'`。
   两者任一写错，`shouldIncludeGame` / `normalizeGame` 会**全量剔除**，
   结果是名册墙对所有人显示「无画像」——且不报错，只是静默降级。
2. **`useSessionSync` 的 `sessionData` 是模块级 `reactive` 单例**
   （`composables/useSessionSync.ts`）。同一测试文件内多次挂载会共享状态，
   用例之间会串数据。故每个用例用自增 tag 生成唯一 puuid/昵称，
   让「串数据」当场变成昵称断言失败而不是静默通过。
3. **列数公式不能照抄 Akari**：Akari 的 `columnsNeed` **不含 gap 折算**，
   短宽度下会多算一列。本实现在 `columns.ts` 里补了 gap 项，并用
   「宽度恰好卡在边界」的用例把这条修正钉住。
4. **档位门禁必须用响应式宽度**：读裸 `window.innerWidth` 的 computed
   在缩放窗口时不会重算，名册墙该消失时不消失。用本文件既有的 `viewportWidth`。
5. **`.pcard` / `.rw-team` 才是真实 class 名**（`.rw-card` / `.rw-team--ally` 是错的）。
6. **naive-ui `NModal` 的 `@close` 只在组件自己关闭时触发**，程序化置
   `show=false` 不走它。清理选中态要用 `watch(showDetail)`，否则残留引用
   让 10 张卡各长期攥一份完整对局数据。

### P2 已交付模块

| 文件 | 职责 |
|---|---|
| `analysis/constants.ts` | 9 维权重与基线、PvE 队列白名单 |
| `analysis/utils.ts` | `noZero` / `avg*` / `standardize` / CV / IQR |
| `analysis/types.ts` | 类型契约（含 `AggregateScore` vs `PlayerScore` 同名不同量警示） |
| `analysis/gameAdapter.ts` | rank `Game` → 归一化；字段改名与「缺失≠0」在此层收敛 |
| `analysis/singleSummary.ts` | 单局占比/比率；**理应贡献比的唯一产地** |
| `analysis/aggregateSummary.ts` | 跨局汇总、胜负（时钟注入）、teamSide、spells |
| `analysis/aggregateScore.ts` | 跨局 9 维综合分（ADR-2 的 TS 侧产出） |
| `analysis/positions.ts` | 分路分布、斗魂三分桶、英雄分桶 |
| `analysis/index.ts` | `analyzePlayerProfile` 编排入口（含 PvE 过滤、倒序截断） |
| `services/playerAnalysis.ts` | 指纹缓存、降级批量、时钟透传 |

### P2 期间修正的实现细节（后续接手须知）

1. **`SessionSummoner` 顶层没有 `puuid`**，它在 `summoner.puuid`。按顶层写会全量 typecheck 失败。
2. **TS `Participant` 接口未声明 `timeline`**（Rust `model.rs` 有且经 IPC 透传）。
   本目录沿用 `services/ai/shared/snapshot.ts` 既有的 cast 约定。
   全仓已积累 4 处 `as unknown as` 绕行 —— **建议后续独立重构把该字段补进共享类型**。
3. **rank 的 `ParticipantStats` 没有** `totalDamageShieldedOnTeammates`、`soloKills`、
   敌方消失信号 ⇒ 相关占比/均值**删掉而非补 0**。
4. **Akari `aggregate/win-loss.ts` 直接调 `Date.now()`** ⇒ 本实现改为 `nowMs` 注入，
   测试可完整复现。
5. **Akari 用 MobX reaction 判断「details 有无变化」来跳过昂贵 timeline 计算**，
   rank 无对应物 ⇒ P2 只做纯函数；到 P1/P3 时需要在此层之上另加 memo。

### 已验证的关键不变量

| 不变量 | 验证手段 |
|---|---|
| TS 跨局分与 Rust 单局分**共用同一套权重** | 单局场景下两者总分必须相等（期望值 2.6244744，独立按 Rust 公式手算）；改任一侧权重即红 |
| 理应贡献比**只看队内相对份额** | 整队同倍放大不变；只放大**敌方**时不变而 `RatioToMax` 变；只放大**队友**时会变 |
| 5v5 均衡局每人恰好 1.0 / 独吞时 5.0 | 单测 |
| 降级纪律不产生 `NaN`/`Infinity` | 单人队、队总为 0、时长为 0、视野缺失、小数数为 0 四类构造 |
| 筛选口径排除 PvE | `PVE_QUEUE_IDS`（450/300/900/1000/700）+ 非 `MATCHED_GAME` |
| **先倒序再截断**（否则留下最旧的 N 局） | 单测 |
| 分路 `null` 跳过而非计入 `NONE` | 单测 |
| 斗魂队伍数判不出时**不猜默认值** | 单测（曾用 8/2 硬编码，已否掉） |
| 缓存指纹**不含 `championId`** | 单测（否则选人期每秒重算 10 人画像） |
| 单玩家失败不影响其余玩家 | 单测（畸形数据 + 批处理） |

### P2 期间发现的既有缺口（未在本次修复）

| 缺口 | 影响 | 建议 |
|---|---|---|
| TS `Participant` 缺 `timeline` 声明 | 4 处 cast 绕行 | 独立重构补进 `types/domain/match.ts` |
| `get_threat_ratings` 的 `recent_performance` 此前只由 KDA+刀分+胜负驱动 | 威胁评级区分度不足 | **P0 已修**（`c5d9b38`） |

---

## 11. 参考：Akari 对标文件索引

| Akari 文件 | 行数 | 去向 |
|---|---|---|
| `src/shared/data-adapter/analysis/player/` | 1,517（生产） | 拆：前端 ~1,000 / Rust ~530 |
| `src/shared/data-adapter/match-history/participants.ts` | 372 | 精简移植 ~150 |
| `src/renderer-shared/components/ongoing-game-panel/` | ~2,000 | UI 复刻 ~1,700 |
| `.../player-info-card/player-card-tags/` | ~1,000 | 移植 ~700（改色板） |
| `src/renderer-shared/components/jungle-pathing-analysis/` | ~600 | 移植 GankMap + 偏好汇总 ~200 |
| `src/shared/data-adapter/analysis/team/index.ts` | 53 | 移植（队伍 tag） |
| `src/shared/i18n/*/renderer/ongoing-game.yaml` | 217 键 | **不移植**（rank 无 i18n） |
