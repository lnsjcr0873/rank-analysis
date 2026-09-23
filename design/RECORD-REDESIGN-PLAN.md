# 战绩面板重构计划（Record Panel Redesign）

> 版本：v2.0（与 `design/UI-UX-REDESIGN-PLAN.md` 同一次封版）
> 范围：`rank-analysis-app/src/components/record/*` + `recordAssets` 组合式 + 纯函数层
> 目的：把战绩面板从「折叠卡 + 单向详情」收敛为「折叠/展开双密度 + 双方 10 人阵容列 +
>        迷你 KDA + is-own 高亮」的 P0~P4 分阶段重构，并为每一步配可复现的性能/密度锚。
> 基线对照表：`design/PERF-BASELINE.md`（P0 折叠态 40 节点锚 + 纯函数耗时锚）。

---

## 执行总览

| 阶段 | 交付 | 证据 |
|------|------|------|
| P0 | 状态收敛 + 性能基线夹具 | 纯函数耗时锚 + RecordCard 折叠态 40 节点锚全绿 |
| P1 | RecordCard v2：折叠/wide 双密度 | 双方 10 人阵容列 + 迷你 KDA + is-own 高亮 |
| P2 | RecordCard v2：wide 档节点数 | 阵容列 10 行节点数锚（对照折叠 40 节点） |
| P3 | 纯函数层去副作用 | `matchFilters` / `championPool` / `trendFilteredOf` 自包含 |
| P4 | 收尾 + 开关收敛 | `recordAssetsKey` 组合式 / 密度由全局态驱动 |

---

## P0 · 状态收敛 + 性能基线

### 目标

1. 战绩面板核心状态（筛选 / 英雄池 / 趋势 / 卡片形态）收敛为单一数据通路，不得有
   "宽档写在 A 处、窄档写在 B 处"的双轨漂移。
2. 建立**折叠态单卡 40 节点锚**：任何后续密度改造都以此节点数为对照，防 DOM 密度回归。

### 已落盘实测（2026-09-23 本地 vitest 快照）

```
BASELINE filterMatches.500.noFilter    0.12 ms(1x)
BASELINE filterMatches.500.champion    0.11 ms(1x)
BASELINE filterMatches.500.win         0.06 ms(1x)
BASELINE filterMatches.500.queue       0.18 ms(1x)
BASELINE filterMatches.500.window24h   0.33 ms(1x)
BASELINE filterMatches.1000.win        0.04 ms(1x)
BASELINE aggregateChampionPool.500     0.09 ms(1x)
BASELINE aggregateChampionPool.1000    0.29 ms(1x)
BASELINE trendFilteredOf.500           0.15 ms(1x)
BASELINE trendFilteredOf.1000          0.34 ms(1x)
BASELINE recordcard.collapsed.nodeCount.avg  40.00  nodes
```

> 详见 `design/PERF-BASELINE.md`。数字仅用于对照 PCR / CI 回归，不锁死断言阈值。

### 细节

- 折叠态（`density = collapsed`）单卡 DOM = **40 节点**；这是 P1 阵容列改造的密度基线。
- 纯函数在 500/1000 场量级均为亚毫秒，说明 CPU 不是瓶颈；改造重点是**渲染密度**而非算法。

---

## P1 · RecordCard v2 折叠/wide 双密度

### 形态

- **折叠档（默认）**：战绩核心信息一屏速览，单卡 ~40 节点，保持现状交互成本。
- **wide 档（`density = 'wide'`）**：点击卡面展开为**双方 10 人阵容列**（每边 5 行，
  每行含头像 + is-own 亮点 + 迷你 KDA `k/d/a`），对照折叠档的密度代价半持久曝光。

### 覆盖范围（测试证据）

- `RecordCard.spec.ts`：20 用例全绿，含
  - wide 档双方 10 人阵容列 10 行节点数断言（每行 头像/is-own 亮点/迷你 KDA —— 5 项 x 10 行 = 50 项）
  - 折叠档单卡 40 节点锚
  - is-own 高亮 / 迷你 KDA 组装 / 双密度切换
- `perfBaseline.spec.ts`：2 用例全绿（纯函数耗时锚 + 折叠卡 40 节点锚）

---

## P2 · wide 档节点数锚

wide 档双方 10 人阵容列节点数由 `RecordCard.spec.ts` 的 wide 档测试持续打点
（`recordcard.wide.lineup` 系列），职责归属明确：**node-count 锚属于功能层测试，
耗时锚属于 perfBaseline.spec**。perfBaseline 保持自包含（纯函数 + 折叠卡 40 节点），
不引用其他 spec 的私有夹具。

---

## P3 · 纯函数层自包含

战绩重构所需的纯函数全部收敛在 record 模块内并且可独立测试：

| 模块 | 职责 |
|------|------|
| `matchFilters.ts` | `filterMatches` 纯函数（多家筛选态） |
| `championPool.ts` | `aggregateChampionPool` / `championWinRate` / 阈值筛选 |
| `trendFilteredOf` | 趋势条映射（轻量，与筛选同源） |
| `matchDetailContext.ts` | 详情注入点收敛 |

纯函数无 DOM/无副作用 → `perfBaseline.spec.ts` 可毫秒级耗时打点，不锁阈值只做回归对照。

---

## P4 · 开关收敛 + 状态收敛收尾

1. **密度全局态**：由 `density` prop / `recordAssetsKey` 注入统一驱动折叠/wide，
   消除"宽档写在 A 处、窄档写在 B 处"的双轨。
2. **测试门禁**：`npm run check`（prettier + eslint + vue-tsc + cargo fmt/clippy）+
   全量 vitest（21 files / 267 tests 全绿）为重新部署前置。
3. **交付物落盘**：本文档（本计划）+ `design/PERF-BASELINE.md`（性能基线锚）。

---

## 验收清单（每格对应真实证据）

- [x] P0 折叠态 40 节点锚 → `perfBaseline.spec.ts` `recordcard.collapsed.nodeCount.avg 40.00`
- [x] 纯函数耗时锚 → `perfBaseline.spec.ts`（500/1000 场全部亚毫秒，5 档筛选）
- [x] wide 档双方 10 人阵容列 → `RecordCard.spec.ts`（20 用例全绿）
- [x] perfBaseline 自包含 → 本文件只引用 record 模块纯函数 + RecordCard 折叠档
- [x] 全量门禁 → `npx vitest run`（21 files / 267 tests passed，0 failed）
- [x] 性能基线落盘 → `design/PERF-BASELINE.md`
- [x] 本计划落盘 → 本文档

---

## 运行

```bash
cd rank-analysis-app
npx vitest run src/components/record            # 战绩面板全部用例（21 files）
npx vitest run src/components/record/__tests__/perfBaseline.spec.ts   # 单跑性能锚
```
