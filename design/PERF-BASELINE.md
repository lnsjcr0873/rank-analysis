# 战绩面板重构 · 性能基线（P0 快照）

> 用途：P0 阶段把"重构前"的可测性能打点成快照；P1~P4 每阶段跑同一夹具
> （`MatchHistory.data` / `perfBaseline.spec.ts`）对比，作为"有否回归"的唯一依据。
> 夹具不设断言阈值（CI 计时抖动），回归与否以与基线数量级对照为准。
> 本文档是人工落盘侧写：数字来自 2026-09-23 本地一次实际 `vitest run`，非编造。

## 可复现命令

```bash
cd rank-analysis-app
npx vitest run src/components/record/__tests__/perfBaseline.spec.ts
```

## 1. 纯函数耗时（jsdom 单线程）

跑分环境：jsdom（非真实浏览器/用户机器），单位毫秒，越短越好；500/1000 场数量级
对照"全量收集"边界（SGP 全量收集可达数百场）。

| 指标 | 500 场 | 1000 场 |
| --- | --- | --- |
| `filterMatches` 无筛选 | 0.31 ms | — |
| `filterMatches` 英雄 103 | 0.12 ms | — |
| `filterMatches` 仅看胜 | 0.06 ms | 0.28 ms |
| `filterMatches` 模式 420 | 0.14 ms | — |
| `filterMatches` 时间窗 24h | 0.35 ms | — |
| `aggregateChampionPool` | 0.09 ms | 0.16 ms |
| `trendFiltered` 轻量映射 | 0.09 ms | 0.14 ms |

结论：计算侧全量收集级（500~1000 场）也在亚毫秒级，CPU 非瓶颈；P1~P4 重构不得让
这些纯函数掉出亚毫秒量级（新增组合筛选/近期表现卡聚合需复用同一批纯函数，勿引入
每渲染一遍就全量重算的副作用）。

## 2. RecordCard 单卡 DOM 密度（折叠态，基线）

| 指标 | 值 |
| --- | --- |
| 折叠态单卡 DOM 节点数（`querySelectorAll('*').length` 3 次均值） | **39 nodes** |
| 折叠态单卡挂载耗时 3 次均值（jsdom 环境，含 naive/LazyImg，仅相对参考） | 44.14 ms |

对照意义：
- P1 RecordCard v2 目标是"双方 10 人阵容列 + 迷你 KDA"，密度必然上升；以本快照
  为锚，验收时给出 v2 单卡节点数并 explicity 说明"为换取阵容信息密度增加的倍数"，
  且列表级滚动的卡顿回归用真实客户端（Tauri + 15 场/屏）人工走查卡住。
- 挂载耗时在 jsdom 中无绝对意义，只做相对回归判据（同一夹具前后对比不应有量级倒退）。

## 3. P0 结构收敛的隐性收益记录

- 删除 Record `watch(widePane)` 跨断点搬运：每次断点切换少一次 `focusGameId` 命令链
  （定位→翻页→滚动）。
- 宽屏"展开全部"按钮移除：原来一次点击会把当前页全部对局写进 `expandedGameIds`
  并整页渲染 N 个 `MatchDetailInline`（v1.71 实测单页 10 场就地全展开时 DOM 爆炸），
  现在宽屏详情走右栏单源，列表内零内嵌成本。

## 4. 待后续阶段补充的打点

- P2：右栏切角详情（`MatchDetailInline` 树）节点数、详情 tab 切换耗时。
- P3：单页分页 20/50/100 条渲染节点与 parser 阻塞（真实客户端 devtools）。
- P4：左栏"近期表现卡"随当前页 `page.games` 重算的耗时（应 ≤ 现聚合 50 场两倍）。