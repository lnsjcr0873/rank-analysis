# 战绩面板重构计划（Record Panel Redesign）

> 版本：v3.0（P0~P4 基础重构封版后追加「运动中的 Akari 布局对齐」阶段）
> 范围：`rank-analysis-app/src/components/record/*` + `src/views/Record.vue` +
>       `recordPagination` 桥接 + 纯函数层
> 目的：把战绩面板收敛为「116px 收起卡 + 卡下就地展开 + 宽窄双点位分页 + @1064
>       紧凑/抽屉」的 LeagueAkari 对齐形态；设计语言保持奥术金工。
> 基线对照表：`design/PERF-BASELINE.md`（折叠态 51 节点锚 + 纯函数耗时锚）。

---

## 执行总览

| 阶段 | 交付 | 状态 |
|------|------|------|
| P0 | 状态收敛 + 性能基线夹具（纯函数耗时锚 + 折叠卡 40 节点锚） | ✅ 完成 |
| P1 | RecordCard 折叠/wide 双密度（10 人阵容列 + 迷你 KDA + is-own） | ✅ 完成 |
| P2 | wide 档节点数锚（节点锚归功能层，耗时锚归 perfBaseline） | ✅ 完成 |
| P3 | 纯函数层去副作用（`matchFilters` / `championPool` / `trendFilteredOf`） | ✅ 完成 |
| P4 | 开关收敛 + 状态收敛收尾（`density` 全局驱动、门禁、交付物落盘） | ✅ 完成 |
| L1 | RecordCard → Akari **116px** 收起卡架构（保留测试 class，节点锚 40→51） | ✅ 完成 |
| L2 | 详情统一「卡下就地展开」：拆 v3 右栏 `record-dpane`/`focusMode`/`v2Wide` 双范式 | ✅ 完成 |
| L3 | 分页双点位：宽屏左栏顶 / 窄屏内容顶粘条，状态迁 `recordPagination` 模块桥接 | ✅ 完成 |
| L4 | PlayerBar → **112px** 身份区 + 刷新钮 emit `refresh` → `refreshTick` 重拉 | ✅ 完成 |
| L5 | Record / MatchHistory 测试适配 + 文档落盘 + commit/push | ✅ 完成 |

---

## 阶段 L · LeagueAkari 布局对齐（v3 追加）

> 对齐参考：`LeagueAkari/src/renderer-shared/components/match-card/`（116px 高、
> shadow-win/loss 全卡光晕、avatar41 + 名字 6.2em）。逐项执行与证据如下。

### L1 · RecordCard 116px 收起卡

- 折叠卡基高 116px（`rc-d-legacy` 覆盖保留旧 48px grid 分支），胜/败头像描边
  全卡配色（`.record-card-win/-loss`），44px 头像 + MVP 徽章 + 符文/技能列 +
  迷你 KDA `k/d/a` + 伤害条与伤害数值 + 参团率 + 胜负结果徽章 + 7 装备槽 +
  `date · 模式 · 时长 · 相对时间 · 地图` 元信息行 + 阵容列（密度 3 档控制）+
  chevron 轨。
- 保留全部既有测试 class（`record-card-cs/spell/group-rate/result-label/
  lineup-team/…`），吸附于 index=1 的卡片新增 `.record-card-meta` 锚点。
- 节点锚：折叠态 40 → **51**（`recordcard.collapsed.nodeCount.avg 51.00`）。
- 证据：`RecordCard.spec.ts`（20 用例）+ `perfBaseline.spec.ts`（2 用例）全绿。

### L2 · 详情「卡下就地展开」单源

- 删除 MatchHistory `v2Wide` prop 与跨断点承接 watcher；`open` emit 重语义为
  「选中同步」（null=取消），父级 `openGameId` 单源承接非空 id → 定位所在页、
  就地展开、平滑滚动（已在展开集合的 id 守卫跳过，防 resize/回环抖动）。
- Record.vue 拆除 v3 右侧详情栏（`record-dpane`/`stepDetail` 右栏渲染/`focusMode`
  吞页），`selectedGame` 派生消失；键盘 ←/→/Esc 改走 `openGameId`，各断点行为一致。
- 「展开全部/收起全部」恒显；`toggleDetail` 多开/单选语义在就地展开上统一。
- 证据：`MatchHistory.data.spec.ts` 24 用例全绿（含 openGameId 承接/守卫、多开）。

### L3 · 分页双点位（`recordPagination` 桥接）

- 分页 UI 从列表工具栏移除，收敛为模块级桥接（`recordPagination.ts`）：
  状态 `{page,pageCount,noMoreMatches,perPage,total}` 只读派发，真实 next/prev
  由 MatchHistory 挂载时注册、卸载时解绑，未绑定调用安全 no-op。
- 双挂载点：宽屏（>=1064）左栏顶 `MatchHistoryPagination`（UserSidePanel 上方）；
  窄屏内容区顶粘工具条同组件 `floating` 变体（与左栏抽屉触发钮同栏）。
- 证据：`MatchHistoryPagination.spec.ts`（4 用例）+ `Record.responsive.spec.ts`
  （4 用例，窄窗抽屉/顶粘条联动）+ `MatchHistory.data.spec.ts` 分页读数改走桥接。

### L4 · PlayerBar 112px 身份区

- 页头由 60px 紧凑条升级为 112px 身份区：头像 64px + 等级角标、昵称 `#tag` +
  复制、段位（单双排 tier 徽章 + 紧凑文案）、近 20 场 `W/L`、备注/标签行；
  右侧大区标签 + 刷新钮（emit `refresh`）。
- Refresh 链路：`PlayerBar refresh → Record refreshTick++ → MatchHistory
  watch(refreshTick) → getHistoryMatch(name)` 重拉最近 50 场。

### L5 · 收尾

- 全量门禁：`npm run typecheck` + `npx vitest run`（178 files / 1760 tests）+
  prettier + eslint 全绿。
- 交付物落盘：本文档 + `design/PERF-BASELINE.md`（51 节点锚）。

---

## 验收清单（每格对应真实证据）

- [x] P0 折叠态 40 节点锚 → `perfBaseline.spec.ts` 打点
- [x] 纯函数耗时锚 → `perfBaseline.spec.ts`（500/1000 场全部亚毫秒，5 档筛选）
- [x] wide 档双方 10 人阵容列 → `RecordCard.spec.ts`（20 用例全绿）
- [x] L1 116px 收起卡 → 折叠态节点锚 **51**（`recordcard.collapsed.nodeCount.avg 51.00`）
- [x] L2 就地展开单源 → `open emit` 重语义 + `openGameId` 承接 watcher + Record 拆右栏
- [x] L3 双点位分页 → `recordPagination.ts` 桥接 + `MatchHistoryPagination.vue` 双形态
- [x] L4 112px 身份区 + 刷新链路 → `PlayerBar.vue` emit `refresh` + `refreshTick` watcher
- [x] 全量门禁 → `npx vitest run`（178 files / 1760 tests passed，0 failed）
- [x] 性能基线落盘 → `design/PERF-BASELINE.md`（51 节点锚）

---

## 运行

```bash
cd rank-analysis-app
npx vitest run src/components/record            # 战绩面板全部用例
npx vitest run src/components/record/__tests__/perfBaseline.spec.ts   # 单跑性能锚
npx vitest run src/views/__tests__/Record.responsive.spec.ts          # 响应式断点
```