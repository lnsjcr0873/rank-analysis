# 战绩面板重构 · 性能基线（Akari 对齐后快照）

> 用途：把"重构前"的可测性能打点成快照；每阶段/每次布局改动跑同一夹具
> （`MatchHistory.data` / `perfBaseline.spec.ts`）对比，作为"有否回归"的唯一依据。
> 夹具不设断言阈值（CI 计时抖动），回归与否以与基线数量级对照为准。
> 本文档是人工落盘侧写：数字来自 2026-09-24 本地一次实际 `vitest run`，非编造。

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

结论：计算侧全量收集级（500~1000 场）也在亚毫秒级，CPU 非瓶颈；布局改动不得让
这些纯函数掉出亚毫秒量级（新增组合筛选/近期表现卡聚合需复用同一批纯函数，勿引入
每渲染一遍就全量重算的副作用）。

## 2. RecordCard 单卡 DOM 密度（折叠态 116px）

| 指标 | 值 |
| --- | --- |
| 折叠态单卡 DOM 节点数（`querySelectorAll('*').length` 3 次均值） | **51 nodes** |
| 既往快照（2026-09-23，旧卡 40px 高） | 39~40 nodes |

对照意义：
- Akari 116px 重组（44px 头像 + MVP + 召唤师技能 + 基石/副系符文 + 迷你 KDA +
  伤害条 + 参团率 + 结果 + 装备 + 元信息行 + 阵容列 + chevron 轨）使折叠卡从 40 节点
  升到 51 节点：+11 节点全部承载"更多一屏可读信息"，是主动换取的信息密度而非回退。
- 挂载耗时在 jsdom 中无绝对意义，列表级滚动卡顿回归用真实客户端（Tauri + 15 场/屏）
  人工走查。

## 3. 布局收敛的隐性收益记录

- 删除 Record `watch(widePane)` 跨断点搬运与 v3 右栏详情（`record-dpane`）：详情统一
  为 MatchHistory 就地展开单源，断点切换不再有"右栏⇄内嵌"的详情搬运链
  （定位→翻页→滚动）。
- 分页 UI 从列表工具栏移到宽屏左栏顶/窄屏内容顶粘条，分页状态与真实翻页实现收敛为
  `recordPagination` 模块桥接，挂载点（双点位）与状态/实现解耦。
- 「展开全部/收起全部」在各断点恒显（不再随宽度移除），批量展开是显式用户动作，
  无后台整页 DOM 爆炸。

## 4. 待后续补充的打点

- 就地展开详情（`MatchDetailInline` 树）节点数、详情 tab 切换耗时。
- 宽屏左栏分页 + 整页 15 场/屏在真实客户端的滚动耗时走查。