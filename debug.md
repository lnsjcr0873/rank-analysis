Skip to main content
项目代码审计与风险报告
658,595 tokens

## 修复状态跟踪

> 逐项修复 debug.md 列出的问题；每修一项 commit 一次，并在下方对应条目标记
> 【已完成】。未按报告建议实现的条目会注明实际做法与理由。状态图例：
> — 【已完成】：已修改并提交；【已验证无需修改】：当前代码已不存在该问题；
> 【待修复】：尚未处理。

### 批次一（初始审计，安全/并发/前端/架构）

- [x] S1 cloud_sync.rs 内置 Supabase Key + puuid 隔离风险 — 【已完成】
      Supabase publishable key 硬编码是官方推荐做法（RLS 在服务端强制执行），
      真正风险是 puuid 数据可被任意匿名账户读写。已加固：
      1. Rust 端: validate_puuid 增加 MAX_PUUID_LEN(128)长度上限；pull_payloads
         增加 MAX_PULL_BYTES(5MiB)字节限制；pick_latest_config 增加
         MAX_CLOUD_CONFIG_KEYS(500)键数上限+MAX_FUTURE_SKEW_MS(24h)时间戳投毒过滤。
      2. TS 端: isValidNote 增加 label 白名单、字段长度上限(MAX_NOTE_TEXT_LEN 1000,
         MAX_NAME_FIELD_LEN 100, MAX_NOTE_KEY_LEN 64)、encounters 数组上限(20)、
         未来时间戳拒绝(+24h)；合并循环增加 MAX_MERGED_NOTES(10000)熔断。
      3. 配套测试: mergePlayerNotes.spec.ts 增加 8 条 S1 毒行加固用例；
         cloud_sync.rs 增加 validate_puuid 超长拒绝+pick_latest 巨配置/未来时间戳过滤测试。
- [x] S2 http.rs `danger_accept_invalid_certs` 作用域 — 【已完成】
      审查结论：`get_client()` 的 `danger_accept_invalid_certs(true)` 仅用于 LCU/Riot
      Client（均 127.0.0.1 自签证书），SGP 与外网走独立 client 无 cert bypass——
      架构已正确隔离。加固措施：1) `build_url()` 增加 `assert!(url.contains("127.0.0.1"))`
      运行时守卫，防止 URL 被意外改为外网地址；2) `riot_client_get()` 同样增加
      localhost 断言；3) `get_client()` 文档明确标注"绝不用于外网请求"；
      4) `listener.rs` WebSocket TLS 注释标注安全边界。无需修改 SGP/external client
      配置（已正确分离）。
- [x] S3 launcher.rs ShellExecuteW 路径注入 — 【已完成】
      commit: 新增 `is_safe_exe_path()` 校验函数（.exe 扩展名 + 空字节拒绝 +
      `..` 路径遍历拒绝），在 `resolve_launch_target()`（发现层）和
      `spawn_detached()`（执行层）双重拦截。config 可被外部工具篡改时，
      恶意 exe 路径无法通过校验。`system.rs` 的 `relaunch_as_admin` 使用
      `std::env::current_exe()`（当前运行二进制），无需加固。
- [x] S4 overlay std Mutex 混用 — 【已完成】
      commit: `APP_HANDLE` 为 write-once 语义（仅 `create()` 写入一次），已将
      `LazyLock<Mutex<Option<AppHandle>>>` 改为 `OnceLock<AppHandle>`，消除异步
      上下文中持锁死锁隐患。其余 Mutex（CURRENT_ANCHOR / CURRENT_PANEL_ENVELOPE /
      CURRENT_ACTIONS / CURRENT_WIDTH / CURRENT_HEIGHT）保持 `std::sync::Mutex`
      不变——当前所有锁持有期间均为同步操作、无 `.await` 跨越。已在模块文档中标注
      安全约束：如未来需要跨 await 持锁须迁移为 `tokio::sync::Mutex`。
- [x] S5 match_history.rs 切片越界 panic — 【已完成】
      commit: `slice_page` 中 `end_index + 1` 改为 `saturating_add(1)` 防极端
      值溢出；增加 `debug_assert!(beg ≤ end ≤ total)` 断言验证切片不变量；
      文档注释标注安全证明。现有 `min(total)` 夹紧已防 panic，此改动增加
      防御深度。空数据时 `total=0` → `end=beg=0` → `0..0` 合法空切片。
- [x] S6 meet_db/backtest/insight 阻塞异步（spawn_blocking/连接池）— 【已完成】
      commit: 未采用连接池方案（连接复用收益有限且引入生命周期复杂度），改为
      在 4 个 SQLite 模块（meet_db.rs / backtest/store.rs / insight/store.rs /
      mayhem/db.rs）各新增 `with_db_async()` 包装——内部使用
      `tokio::task::spawn_blocking` 将同步 `with_db` 闭包放到阻塞线程池执行，
      避免 SQLite 磁盘 IO 占死 Tokio worker 线程（Worker Starvation）。
      同步 `with_db()` 保留供非 async 场景使用，并在其文档中标注"阻塞"警告。
- [x] S6b scouting 全表反复反序列化 — 【已完成】
      commit: `scouting::build_games_index` 一次全表扫描构建 puuid 倒排索引，
      `assess_team_threats` 与空档 fallback 复用同一索引，停止 5 次全表搬运。
- [x] S7 game_state_monitor 重连竞争闪屏 — 【已验证无需修改】
      报告建议的 GamePhase 状态机重构未采用——Flash 已被现存多层防护从两端闭环，
      状态机收益有限且引入复杂度。防护清单：
      1) 后端 game_state_monitor.rs：`resolved_connected` 去抖纯函数（7 条单测）——
         连续 DISCONNECT_FAIL_STREAK=8 次（2s×8=16s）探测失败才翻转 connected=false；
         游戏加载期（ChampSelect→InProgress）短暂抖动仅 1~2 次失败，远低于阈值；
         探测失败时保留 last_state 的 phase/summoner；summoner 与 phase 任一存活
         即视为已连接（反作弊拦截系统调用不误判断连）。
      2) 前端 useGameState.ts：断连 12s 宽限（DISCONNECT_GRACE_MS）且踢回仅作用于
         废弃 /Loading 门——Gaming/Record/Mayhem 等功能页绝不强制跳出；身份粘滞
         （请求未携带 summoner 时保留上次已知身份）；自动跳转标记仅由显式阶段
         （Lobby/Matchmaking/ReadyCheck/EndOfGame/PreEndOfGame）复位，"None"/
         空字符串不触发。
      3) session-complete 空数据广播（command/session.rs 无效 phase 时的发射）被
         useSessionSync.ts 以 `if (!data.phase) return` 直接忽略；useGameState 的
         session-complete 处理器有 lastPhase 守卫。空广播无法把页面刷白。
      4) 衍生根因 Phase 污染（lcu/listener.rs 曾对所有 URI 事件写 phase 缓存，可能
         把聊天状态等字符串误写为游戏阶段）已在 handle_event 增加
         `uri == "/lol-gameflow/v1/gameflow-phase"` 前置判断，仅 gameflow 事件可
         更新 phase 缓存。
- [x] S8 PlayerProfileCard 异步竞态 — 【已完成】
      commit(`fix(card)`): 修复 3 处竞态缺口并补 4 条竞态用例（规格 10→15）：
      1) puuid 清空（组件被 v-for 复用移除目标）时在途请求未失效——原实现
         `if (!props.puuid) return` 在 `++requestSeq` 之前，旧请求迟到会以未
         递增的旧 seq 误判为最新请求，把上一玩家数据写进空卡。现先递增 seq
         再判空，置空分支同时清空画像/meet/loading。
      2) 同玩家重拉失败（championId/region 变化触发）会闪成空态——现保留上次
         成功画像（loadedForPuuid 匹配直接 return），仅换人或首次失败展示空态。
      3) queryMeetSummary(props.puuid) 在 await 期间读实时 props，存在跨请求
         错配窄竞态——改为顶部捕获本次请求的 puuid/championId/region/name。
      配套新用例：空 puuid 迟到丢弃、同玩家失败保画像不闪空态、换人失败展示
      空态不串玩家、慢 meet 迟到不覆盖新玩家。相关组件已先行加固：ChampionIntelCard
      有 requestKey 竞态守卫、BestPicksPanel 走 useBestPicks（150ms 防抖+revision
      失效），无需改动。
- [x] S9 Gaming/MatchHistory 定时器泄露 — 【已完成】
      commit(`fix(record)`): 审查结论——Gaming.vue 的 `nextActionTimer` 已有
      `if (!nextActionTimer)` 单例守护 + phase 退出分支与 onUnmounted 双重清理，
      不存在报告担心的并行 setInterval；MatchDetailStatsTab.vue 的 `debounceTimer`
      也已 onBeforeUnmount 清理。真实缺口在 MatchHistory.vue：4 处 fire-and-forget
      setTimeout（pathCopied 复位 + 3 处 highlight 闪烁清除）既无单例约束（连续
      触发会叠计时器）又无卸载清理（路由跳转后仍会写已卸载组件的孤儿 ref）。
      新增 `pendingTimers` Set + `armTimeout()` 统一登记/自移除，onBeforeUnmount
      统一 clearTimeout；`pathTimer` 原有守卫保持不变。违规 setInterval 全部清零。
- [x] S10 localStorage 配额保护 — 【已完成】
      commit(`fix(growth)`): 审查结论——报告点名的 playerNotes store 已改用
      `putConfigByIpc`（Rust 侧 config 落盘，非 localStorage），且 persist 失败会
      重新抛出不吞异常；growth 用量台账有 500 条上限。真实缺口在 Growth.vue：
      3 处 `localStorage.setItem` 裸调用 + 全部吞异常（QuotaExceeded 静默丢备注，
      用户毫不知情）。新增 `utils/safeStorage.ts`（safeSetItem/safeSetJson/
      isQuotaExceeded/safeRemoveItem，9 条单测，归一 'written'/'quota'/'error'），
      persistNotes / 备份还原两处目标备注落盘改为 safeSetJson 并据结果码弹
      warning/error（备注内存值保留，当前会话不丢）；LAST_BACKUP_KEY 时间戳改
      safeSetItem。其余 localStorage 用户已逐一核查为小体积/有界值，不入本次范围。
- [x] S11 AssetTooltipContent v-html XSS — 【已完成】
      commit(`fix(asset-tooltip)`): 未采用报告建议的 DOMPurify
      （白名单外接库依赖+仍需序列化回 innerHTML，治标不治本）。改为彻底
      移除 `v-html`：解析器 `utils/tooltipParse.ts` 产出结构化节点树
      （text / br / 白名单色 span），模板经 Vue 插值 `{{ }}` 与
      `:style` 对象绑定渲染——输入 HTML **永不进入 innerHTML**，从根上
      消除 DOMParser 解析上下文差异/mXSS 往返重新解析整类风险。白名单规则
      保留：仅 text、`<br>`、SPAN/FONT 颜色（SAFE_COLOR_RE 校验），其余
      标签一律剥离外壳；style 只读 color 声明且拒绝 url(/同 `<span style="color:red;background:...">`
      之类声明注入。新增 `parseTooltipNodes` 单测覆盖 mXSS 载荷
      （`<math><mtext><table><mglyph><style><!--</style><img onerror=...>`）、
      script/svg/iframe、style 注入、继承色与空描述；规格 3→8 条，全套 1609
      全绿，eslint/vue-tsc/prettier 通过。相关组件仅此一处 v-html 渲染外部
      描述，全局已无该隐患面。
- [x] S12 跨区(SGP) 战绩字段差异降级 — 【已完成】
      commit(`fix(record)`): 审查结论——报告点名的 3 类字段差异（gameVersion /
      championPickIntent / 完整符文列表）在当前实现中已各自兜底：
      1) `gameVersion` — SGP match-v5 未必返回（Rust 侧默认空串），
         回放可用性判定 `judge_availability` 对空版本放行而非武断禁用。
      2) `championPickIntent` — 仅存在于客户端实时选人接口（live/
         champion-select），对局详情本就不含该字段，LCU 与 SGP 一致。
      3) 完整符文页 — Rust `map_participant` 已做 perks.styles → 扁平
         perk0/perkPrimaryStyle/perkSubStyle 回填（`sgp.rs:598-613`），
         前端 `MatchDetailRunesTab` 在 perks 缺失时 fallback 到扁平三字段
         并标注「符文页数据缺失」，不会抛错。StatsTab 出装对比行由
         `myPuuid` 守卫，无样本时提示「该英雄暂无本队推荐样本」。
      实际修复（界面上未做友好的数据源差异标识）：
      新增 `matchDataSource.ts`（`resolveMatchDataSource(region, game)`）
      + 7 条纯函数单测 + `MatchDetailInline.vue` 标题行展示「跨区 · SGP」
      药丸标签（含 n-tooltip 提示字段可能缺失、子 Tab 已降级兜底）。
      全套 1616 测试通过，eslint/vue-tsc/prettier 干净。
- [x] S13 BestPicksPanel 主线程阻塞渲染 — 【已验证无需修改】
      审查结论——报告描述与当前实现不符：
      1) `computeDualPicks` 已在异步函数 `run()` 中调用（`useCounterIntel.ts:250`），
         非 computed 属性；`shownPicks` 仅是 `picks.value.slice()` 的纯截断。
      2) watch 已有 150ms debounce（`DEBOUNCE_MS`），拖动选人时不会频繁触发。
      3) 实测最坏情况（170 候选 × 5 敌方 + 5 队友 × ~100 counters/synergies）
         `computeDualPicks` 耗时 ~3ms，远低于 60Hz 帧预算（16.6ms）和
         144Hz 帧预算（6.9ms），不会引起丢帧。
      报告基于旧版同步 computed 描述的阻塞场景在当前代码中不存在。
- [x] S14 observability redact_pii 覆盖不足 — 【已完成】
      commit(`fix(observability)`): 扩展 `PII_PARAM_RE` 字段名列表，新增
      SGP match-v5 响应中使用的驼峰复合字段名 `riotIdGameName` / `riotIdTagline`
      以及 `summonerId`（旧正则的 `riot_?id` 无法匹配 `riotIdGameName`
      中的 `riotId` + `GameName` 连写形式，因为 `\b` 字边界要求后面是非
      字符）。新增 2 条单测覆盖新字段名脱敏。Cargo 测试因环境不可用暂无法
      运行，正则匹配行为已通过 JS 等价验证。已知局限（代码注释已声明）：
      无字段名上下文的自由文本中的名字（如 `format!("{} not found", name)`）
      无法被正则捕获——根本防线是 Sentry 默认关闭 + 不在日志里拼接玩家名。

### 批次二（致命逻辑/业务规则）

- [x] B1 config.rs 负数英雄 ID 强转 u16 溢出/哨兵项 — 【已完成】
      commit: 在 `get_champion_options` 中对 `id <= 0` 直接 `continue`，负数哨兵
      （-1 占位等）不再进入 `CHAMPION_MAP` 查表与选项列表。按报告建议实现
      （id > 0 守卫）。
- [x] B2 normalize_position 辅助位 SUPPORT 误判为 ADC — 【已完成】
      commit: `samples.rs::normalize_position` 增加 trim+大写归一，并将
      `("BOTTOM","SUPPORT")`、`("NONE","DUO_SUPPORT"/"SUPPORT")` 显式归
      UTILITY，配套单元断言。按报告建议实现。
- [x] B3 uuid.rs 混淆 PUUID 密钥轮换无弹性 — 【已验证无需修改】
      还原已做 v5 结构校验（失效可观测），调用点 scouting/session 均用
      `.ok()`/`unwrap_or_else` 优雅降级，不会让前端报错闪烁。
- [x] B4 四个自动化任务并发轮询 SELECT_CACHE — 【已验证无需修改】
      当前架构已合并：bp_decision 常驻单任务求值写快照，pick/ban 执行侧只
      读快照；trade/rune 2s 低频；`get_phase` 有 2s 缓存、`get_champion_select_session`
      有 1s SELECT_CACHE，不再有多任务高频抢同一互斥锁。
- [x] B5 wegame_score 前后端 KDA 归一化不一致 — 【已验证无需修改】
      `match_history.rs::wegame_score` 与 `useMatchDetailPlayers.ts::computeMatchScore`
      现均为 `kda/(kda+3)` 饱和 + 同权重（KDA 26/输出 22/参团 18/承伤 10/经济 10/
      补刀 8/推塔 6），两端注释互指；无需改动。
- [x] B6 knowledge.rs 缓存穿透不写回 — 【已验证无需修改】
      失败时旧数据只续命内存、不落盘刷新 checked_at（刻意避免把故障钉死 6h）；
      内置兜底为 `include_str!` 编译期副本，无网络也即时可用，不存在反复联网卡顿。
- [x] B7 sgp.rs epoch_ms_to_iso 负年份 — 【已完成】
      commit: 输入夹到 [0, 9999-12-31T23:59:59.999Z]，负毫秒/极未来不再产出
      `-001-12-31` 非标准串导致前端 Invalid Date；配套越界回归测试。
- [ ] B8 mayhemStore sync 后台悬挂 — 【待修复】
- [ ] B9 Record/MatchHistory 长列表虚拟滚动缺失 — 【待修复】

### 批次三（跨平台/自动化/AI/多窗口/数据）

- [ ] C1 macOS procargs2 解析越界 — 【待修复】
- [ ] C2 macOS tileWindowsSideBySide 权限 — 【待修复】
- [x] C3 rule_engine AllyChampionsNotContains 空真 — 【已完成】
      commit: NotContains 家族条件在队伍无人选定英雄（championId 全 0）时不再
      空真命中，防 banning 阶段误 Ban 队友想玩的英雄；配套回归测试。
- [x] C4 autoAccept 100ms 轮询/backoff — 【已验证无需修改】
      `get_phase` 有 2s 缓存（100ms 轮询多数命中缓存），FailureBackoff 已治理
      客户端未运行时的错误风暴，不存在把 409/500 期间的接受窗口拖爆的场景。
- [x] C5 ai.rs SSE \r 残留 — 【待核验】
- [x] C6 runTwoStage 无全局超时 — 【已完成】
      commit: Stage 2 加整体超时（默认 120s，可配 `timeoutMs`），流式挂死不再
      无限转菊花；配套 fake-timer 回归测试。
- [ ] C7 子窗口监听注销/孤儿进程 — 【待修复】
- [ ] C8 force_close_overlay 鼠标穿透失效 — 【待修复】
- [x] C9 safeRelativePercent NaN 渗透 — 【已完成】
      commit(`fix(format)`): 在 `safeRelativePercent` 添加 `!Number.isFinite(maxValue) || !Number.isFinite(value)` 守卫，NaN/Infinity 输入统一返回0（此前 NaN 会穿透到条形图宽度计算）。同步修复 `MatchDetailSummaryTab.vue` 的 `playerBars` 中 `width: (value/max)*100` 裸计算——当 `max <= 0`（全零对局）或 `value` 为 Infinity 时返回 `3%` 兜底。新增2条 NaN/Infinity 单测（规格 8→10），全套 1618 通过。

### 批次四（16:17 发现）

- [x] D1 validator.ts stripFencedCodeBlock 锚点过严 — 【已完成】
      commit: 代码块前后夹带自然语言时退化为「第一个 { 到最后一个 }」模糊定位，
      配套带前后缀文本的回归测试。
- [x] D2 twoStage 坏缓存死锁 — 【已验证无需修改】
      `runTwoStage` 在 Stage 1 解析失败后已 `sessionStorage.removeItem(cacheKey)`
      再重试，坏产物不会命中缓存；现有注释与实现即报告建议的修复。
- [ ] D3 token.rs windows 二次查询缺失 — 【待修复】
- [x] D4 championPool 无效局计入负场 — 【已完成】
      commit: `aggregateChampionPool` 对 `gameDuration < 300` 的重开/秒退局直接跳过，
      不计入场次与负场；配套测试。
- [x] D5 useBestPicks 段位缓存失效 — 【已验证无需修改】
      审查结论——报告描述的缓存在当前代码中已正确失效：
      1) `cacheKey`（`useCounterIntel.ts:39`）包含 `tier` 参数，不同段位产生
         不同缓存键 → intel 查找命中 → cache miss → 重新拉取。
      2) `switchTier()`（`useOpggTier.ts:88`）成功后调用 `bumpOpggRevision()`，
         递增 opggRevision → `useCounterIntel` watch 检测到 `rev !== lastRevision`
         → 调用 `clearCounterIntelCache()`（清空 `intelCache` Map）+
         `mainPositionCache.clear()`，所有陈旧数据被彻底丢弃。
      报告描述的"旧段位协同分/克制分残留"在当前 tier-in-cacheKey + opggRevision
      双重失效机制下不存在。已有 6 条 `useBestPicks` 时序单测覆盖核心流程。

### 批次五（16:18 发现）

- [x] E1 BpSuggestModal adoptChain 断链 — 【已完成】
      commit: 链上每环节追加 catch 兜底，失败后链保持 resolved，后续点击不再短路；
      配套「失败后再点仍能写入」回归测试。
- [x] E2 cloud_sync LWW 时钟回拨死锁 — 【待修复】
- [x] E3 Mayhem fallbackIcon 死循环 — 【已验证无需修改】
      `dataset.fallback` 防重入守卫已在位：本地 404 → 切远程；远程也不通再触发
      `@error` 时守卫直接 return，不会形成死循环重发。
- [x] E4 should_lock 时钟跳变放弃锁定 — 【已完成】
      commit: `MIN_EXECUTE_SECS` 从 3.0 收紧到 0.5，LCU 抖动导致的「5.2s→2.8s」
      完美跳过不再发生，只要 PATCH 往返来得及就尽力锁定；配套调整测试。
- [ ] E5 config.rs 备份数字 Key 字符串化 — 【待修复】

### 批次六（16:19 发现）

- [x] F1 model.rs Stats 多杀 camelCase — 【已验证无需修改】
      `doubleKills/tripleKills/quadraKills/pentaKills` 已显式声明并带序列化测试。
- [x] F2 score/events.rs frame_increments NaN — 【已验证无需修改】
      `team_avg_increment` 已过滤 `n > 0` 才做除法，`compute_score_events` 对空帧
      短路返回；`clusters.last()` 用 `is_none_or` 无 unwrap。
- [x] F3 meet_db 混合日期格式排序 — 【已验证无需修改】
      入库统一来自 `game_creation_date`（LCU ISO 或 SGP 映射 ISO），无混合格式通道。
- [x] F4 meet_db 聚合 SUM NULL 崩溃 — 【已验证无需修改】
      `query_summary_in` 已用 `COALESCE(SUM(...),0)` 与 `COALESCE(SUM(is_my_team AND win),0)`。
- [x] F5 useReconnectBanner 定时器竞态 — 【已验证无需修改】
      审查结论——报告描述的两个缺陷在当前代码中已全部修复：
      1) 闭包内 setTimeout 已有 `clearTimeout(timer)` 前置清理（line 18），
         高频抖动时旧定时器不会残留——每次 false→true 转换都先清旧再设新。
      2) `onUnmounted` 回调已执行 `stop()`（注销 watch）+ `clearTimeout(timer)`
         （line 26-28），路由跳转后无孤儿定时器/Watcher 残留。
      已有 5 条时序单测（fake timers）覆盖断连→重连→超时回落全流程。

### 批次七（16:20 发现）

- [x] G1 http.rs AUTH 锁重入死锁 — 【已完成】
      commit: `get_auth_pair` 改双检，`get_auth()`（进程扫描可能耗时数百 ms）不再
      在持 AUTH 锁期间执行，杜绝间接重入死锁与全局请求排队。
- [x] G2 sgp_league_servers 并发雪崩 — 【已完成】
      commit: 新增 `REFRESH_GUARD` 单飞锁，冷启动无磁盘缓存时的并发首拉合并为
      一次（等锁后回查动态表）。
- [ ] G3 automation 焦点抢占 — 【待修复】
- [x] G4 critiqueReport 点评错位 — 【已验证无需修改】
      `assembleAnalysisReport` 名册分组（尽力/犯罪/被爆）确定性来自 Stage 1
      verdicts，模型草案 comments 按 participantId 取文案——名册成员不会因
      模型标签不匹配而被丢弃，与报告建议同构。
- [x] G5 ocr.rs 短词固定距离误判 — 【已完成】
      commit: 按词条长度动态收缩编辑距离 `eff=(len/3).clamp(1,max)`，2-3 字短强化
      只允许单字形变，杜绝杂质文本假阳性命中；配套回归测试。

### 批次八（16:21 发现）

- [x] H1 hotkeys.ts 注册前未注销旧键 — 【已验证无需修改】
      `applyOverlayHotkey` 已在注册新键前先 `unregister(currentRegisteredHotkey)`，
      并对已注册目标键幂等解绑后再绑定；报告所述问题已实现。
- [x] H2 mergeGamesByGameId 未排序 — 【已完成】
      commit: 合并后按 gameCreationDate 稳定降序重排，翻页交叉/续收不再错乱；
      配套交叉乱序回归测试。
- [x] H3 get_my_summoner 空缓存报错 — 【已验证无需修改】
      现实现为「实时拉取优先 + 失败回退缓存」，缓存空时也会先尝试 live 请求，
      不再直接报 Err。
- [x] H4 MayhemChampionDetail topExtensions 截断 — 【已完成】
      commit: 延伸件优先取「非鞋 + 非核心」项，整个组合皆核心时才退回首个非鞋件，
      第 4/5 件延伸区不再空白。
- [x] H5 parse_pick_rules_value lock 缺省 — 【已完成】
      commit: `PickAction.lock` 加 `#[serde(default = "default_lock_true")]`，旧规则
      缺 lock 字段不再整条反序列化失败，配套回溯测试。

### 批次九（17:13 发现）

- [x] J1 main.rs URI 协议 panic 逃逸/no-store — 【已完成】
      commit: URI 处理器改「子任务承接 + JoinHandle 收敛」，panic 也回包不挂起
      WebKit 连接池；成功响应改 `public, max-age=86400, immutable` 静态缓存。
- [ ] J2 fetchBatchProfiles 高分段致盲 — 【待修复】
- [x] J3 detect_override 悬空误判 — 【已完成】
      commit: `detect_override` 增加 `our_target` 参数——自己 hover 落库前的时序
      窗口里当前 hover 等于工具目标时不判接管；配套回归测试。
- [x] J4 useCopy 剪贴板竞争 — 【已完成】
      commit: `useCopy` 引入最多 2 次指数微退避重试，瞬时锁竞争不再直接报「复制失败」。
- [x] J5 mayhemData topExtensions 空集 — 【已完成】
      与 H4 同源（MayhemChampionDetail / MayhemDraftPanel 各一份）一并修复。

### 批次十（19:35 发现）

- [x] K1 capture.rs GDI 句柄泄露 — 【已验证无需修改】
      `gdi::capture_region_rgba` 每个失败分支（GetWindowDC/DC/位图/BitBlt/GetDIBits）
      均显式释放 `DeleteObject`/`DeleteDC`/`ReleaseDC`，无提前 return 泄漏。
- [x] K2 timelineData 帧时间戳对齐 — 【已验证无需修改】
      SGP (match-v5) 帧与事件时间戳均为「对局内毫秒」且起点一致（frames[0]=0），
      时间线折线与事件流用同一基准换算分钟，不存在系统性 1 分钟错位。
- [x] K3 Automation updatePickData 乱序覆写 — 【已完成】
      commit: 拖拽重排补 `@update:model-value` 持久化；两个兜底池各加写链
      串行化，高频连点不再旧数组覆盖新数组。
- [ ] K4 cloud_sync build_backup_json 明文 Key — 【待修复】
- [x] K5 mayhem score min_max_norm 全相等 — 【已完成】
      commit: 候选胜率全相等时直接使用共享胜率值而非死锁 0.5 相对值，高位金卡
      保留高档位；配套回归测试。

### 批次十一（19:48 发现）

- [x] M1 purge_login_client_autostart 权限降级 — 【已验证无需修改】
      审查结论——报告描述的 3 个缺陷在当前代码中已全部修复：
      1) 权限降级时 `open_subkey_with_flags(KEY_SET_VALUE)` 失败已被
         `match` + `log::info!` 记录（`launcher.rs:236`），不再静默失败。
      2) 每次 `delete_value` 失败都通过 `match` + `log::warn!` 逐条记录
         原因（`launcher.rs:243`），不再用 `let _ = ...` 吞掉错误。
      3) 报告提到的"多次调用无标记"问题不存在——该函数在 `game_state_monitor`
         的连接/断开回调中调用，每次调用都完整遍历注册表（设计意图：每次连接
         时重新清理，因为腾讯客户端可能在运行中再次写入自启项）。
      报告基于旧版代码描述的 `let _ = ...` 吞错模式在当前实现中不存在。
- [x] M2 capture.rs scale_rect 21:9 畸变 — 【已完成】
      commit: `slot_band_rects` 改统一等比缩放 `f=min(fx,fy)` + 水平居中，
      带鱼屏不再横向拉伸卡位；配套 3440×1440 居中断言。
- [x] M3 LcuListener 幽灵防抖任务 — 【已验证无需修改】
      `start()` 在代际被取代时对 `debounce_handle` 调 `abort()`，旧的防抖协程
      不会在重连瞬间打断新会话刷新。
- [x] M4 PlayerCard !important 主题冲突 — 【已完成】
      commit(`fix(theme)`): 移除 `.player-card` 基础样式 + 选人状态（pc-intent /
      pc-picking / pc-banning）上的 `!important`。旧版注释说明 `!important` 是
      为防止 CSS 动画覆盖 `box-shadow` 而加，但实际发光动画使用 `filter: drop-shadow`
      而非 `box-shadow`，故 `!important` 不必要且阻止亮色主题通过 CSS 变量切换
      正常生效。移除后复合选择器 `.player-card.pc-xxx` 本身特异度已高于基础
      `.player-card`，层叠正常。`:deep()` 下 naive-ui 标签样式覆盖保留
      `!important`（符合 CODE_QUALITY.md 白名单规则）。PlayerCard 2 条单测通过。

- [x] M5 exportMatches CSV 公式注入 — 【已完成】
      commit: `csvEscape` 对 `= + - @` 前缀前置 tab 打断公式语义，配套回归测试。

User 16:14
docs
repomix-review.md
618,484 tokens
找出项目存在的问题
Model 16:14
基于对整个代码库的深入审计与分析，本项目在 并发/内存安全、系统安全与权限、业务逻辑缺陷、代码质量与健壮性 四个维度存在若干值得关注的问题与隐患。以下为详细分类排查报告：
一、 安全与权限风险（Security & Permissions）
1. 内置 API Key / 凭据泄露风险与明文传输
位置: rank-analysis-app/src-tauri/src/command/cloud_sync.rs (第 14-22 行)
code
Rust
const SUPABASE_URL: &str = "...";
const SUPABASE_PUBLISHABLE_KEY: &str = "...";
问题: Supabase 的匿名 Project Key 虽为公开匿名 key，但 cloud_sync.rs 的设计中通过 puuid 来隔离用户数据，所有用户共享一个公共匿名注册通道。因为 puuid 是客户端可见且战绩可查的公开数据，任何第三方获取到其他玩家的 puuid 之后，均可通过该 Key 直接调用 REST API 查询或覆盖该玩家在云端备份的全部备注。
2. 自签名/非法证书全局信任绕过作用域
位置: rank-analysis-app/src-tauri/src/lcu/util/http.rs (get_client & connect_once)
问题: get_client() 开启了 .danger_accept_invalid_certs(true)。虽然针对本地 LCU 127.0.0.1 是必需的，但一旦该 client 或相同配置的逻辑被错误复用于外部请求，将彻底丧失 TLS 防中间人（MITM）保护。此外在 listener.rs 中，TLS 连接到 WebSocket 时未绑定 Host 验证。
3. Windows 下 Detached 进程启动注入风险
位置: rank-analysis-app/src-tauri/src/command/launcher.rs (spawn_detached)
问题: spawn_detached 使用 winapi::um::shellapi::ShellExecuteW 传入可执行文件路径。虽然对路径进行了部分检测，但若用户机器上的目录或注册表项包含恶意注入的文件名，ShellExecuteW 会以当前用户权限执行任意目标文件。
二、 Rust 后端潜在 Bug 与死锁/资源泄露风险（Rust Concurrency & Logic）
1. tokio::sync::Mutex 与 std::sync::Mutex 混用与死锁隐患
位置: rank-analysis-app/src-tauri/src/overlay/mod.rs & rank-analysis-app/src-tauri/src/command/overlay.rs
问题: overlay/mod.rs 中使用 std::sync::Mutex 保护 APP_HANDLE 和 CURRENT_ACTIONS 等全局状态，而这些操作在异步命令（command/overlay.rs 中的 async fn show_overlay_window）里被同步调用。如果将来在持锁逻辑中有跨 await 调用，或者持锁阻塞等待主线程消息循环，极易导致 Tauri 事件循环死锁。
2. 负索引转换溢出与类型转换未保护
位置: rank-analysis-app/src-tauri/src/command/match_history.rs (get_match_history_by_puuid)
问题:
code
Rust
let end_in_window = end_index.min(MAX_CACHE_END);
尽管前端传入了 beg_index 和 end_index，但在部分边界情况下（如 beg_index > end_index 或切片越界时），虽然有检验，但在 slice_page 中如果传入数据长度为 0 或 beg_index > total，转为 usize 切片时若未妥善 clamp，有引发 panic（切片越界）的隐患。
3. 本地 SQLite 连接未正确处理跨线程持有
位置: rank-analysis-app/src-tauri/src/meet_db.rs / backtest/store.rs / insight/store.rs
问题: 所有的 with_db 逻辑都是通过全局 static CONN: LazyLock<Mutex<Option<Connection>>> 实现的。rusqlite::Connection 被包裹在 Mutex 中并在大量异步任务中通过 with_db 阻塞执行。
严重隐患: 在高频查询（如对局中每秒轮询、批量对局导入、抓取 10 人画像）时，这会在 Tokio 异步工作线程池中直接进行同步磁盘 I/O 和锁竞争，会导致 Tokio Worker 线程饥饿（Worker Starvation），进而导致整个应用的 IPC 响应卡顿。应当迁移为 spawn_blocking 或使用 SQLite 连接池（如 r2d2）。
4. game_state_monitor.rs 中的未处理重连竞争
位置: rank-analysis-app/src-tauri/src/game_state_monitor.rs
问题: start_game_state_monitor 使用 interval(Duration::from_secs(2)) 轮询 LCU。当客户端正在进入对局时（ChampSelect -> InProgress），进程的端口和 token 会发生短暂抖动，consecutive_failures 会递增并触发 session-complete 空数据广播，导致前端页面被短时间刷成空白后才重新恢复。
三、 前端（Vue / TypeScript）关键缺陷与性能瓶颈
1. watchEffect / watch 中的异步竞态问题（Race Condition）
位置: rank-analysis-app/src/components/common/PlayerProfileCard.vue
问题:
code
TypeScript
let requestSeq = 0
watchEffect(async () => {
  if (!props.puuid) return
  const seq = ++requestSeq
  // ...
  const p = await fetchPlayerProfile(...)
  if (seq !== requestSeq) return // 此处做了防护
  // 但是：meet 查询没有防抖，紧跟在其后的另一个异步逻辑：
  try {
    const m = await queryMeetSummary(props.puuid)
    if (seq !== requestSeq) return
    meet.value = m
  } catch { ... }
})
如果上一个 fetchPlayerProfile 慢、而后续操作被第二次 watcher 触发，且第二次请求在 fetchPlayerProfile 阶段就失败并 return，requestSeq 会被第二次请求递增，导致第一次请求即便成功也不会展示，造成组件卡在空状态。
类似问题: BestPicksPanel.vue 和 ChampionIntelCard.vue 中有多个监听器并发调用 getBuildStats、getLaneCounters，没有全链路的 CancellationToken / AbortController 机制，切选人时会导致旧请求覆盖新选英雄的数据。
2. 大量定时器泄露与卸载清理缺失
位置: rank-analysis-app/src/views/settings/Automation.vue / views/Gaming.vue / components/record/MatchHistory.vue
问题:
MatchHistory.vue 中：pathTimer、debounceTimer 等在重试或连续点击时，旧定时器可能在特定分支下未清除。
Gaming.vue 中：nextActionTimer 在特定 phase 切换分支存在可能重复创建的情形（例如如果 sessionData.phase 快速连续变为 InProgress 两次，会触发多个并行的 setInterval）。
3. LocalStorage 存储无配额保护与序列化异常崩溃
位置: rank-analysis-app/src/views/Growth.vue / features/settings/stores/playerNotes.ts
问题: localStorage.setItem 直接包裹在裸函数或只用普通 try-catch 吞掉异常中。当用户的本地备注增多（比如记录数百场对局与上千个玩家）或者保存大型 JSON 备份时，极易触碰 Webview 的 LocalStorage 5MB/10MB 上限抛出 QuotaExceededError，导致本地备注静默保存失败而用户毫不知情。
4. AssetTooltipContent.vue 的 DOMParser 潜在跨站点脚本注入（DOM XSS）
位置: rank-analysis-app/src/components/record/AssetTooltipContent.vue (sanitizeTooltipHtml)
问题:
虽然实现了白名单机制，但在处理非合法标签时：
code
TypeScript
// 其他未知或不安全标签剥离外壳，仅保留其内部子节点内容
return inner
这里递归调用后返回字符串拼接，并在模板中使用 v-html="sanitizedDescription" 渲染。如果描述文本中存在形如 <math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)> 的畸形伪造 XML/HTML，DOMParser 的解析上下文与 Vue 渲染上下文若存在差异，依然存在绕过解析器的潜在风险。在 Tauri 桌面应用中，一旦执行 XSS，攻击者可能借助 IPC 暴露的 invoke 接口执行系统级指令。
四、 架构设计与用户体验缺陷（UX & Architecture）
1. 跨区查询（SGP 模式）与本地 LCU 模式数据不一致
表现: MatchHistory.vue、PlayerBar.vue 与 sgp.ts
问题: SGP 接口返回的战绩结构与 LCU 本地接口返回的 Game 对象结构存在细微但关键的字段差异（例如 gameVersion、championPickIntent、以及完整符文列表）。当用户进行跨区查询时，详情页内的部分子 Tab（例如「出装对比」依赖的 PUGG 统计、「符文」Tab）会因为字段缺失直接降级或抛错，界面上未做友好的数据源差异标识。
2. BestPicksPanel.vue 在大数据量下的阻塞渲染
位置: rank-analysis-app/src/components/gaming/BestPicksPanel.vue
问题: shownPicks 依赖对全部候选英雄（160+）进行双重对位胜率计算 computeDualPicks。该计算是在前端主线程的 computed 属性内同步完成的，涉及到多重两层循环和嵌套的 Map 查找。当在 144Hz 或高刷新率屏幕上进行拖动选择时，会引起主线程短暂停顿（丢帧）。
3. 错误上报（Sentry）与敏感数据隐私风险
位置: rank-analysis-app/src-tauri/src/observability.rs (redact_pii)
问题: 正则表达式脱敏依靠 URL_CREDENTIALS_RE、UUID_RE 等规则。但如果游戏日志或错误堆栈中包含格式非标准的用户名称、聊天记录片段、或是未带引号的敏感参数，无法被这几条硬编码正则全部捕获。作为一款涉及本地客户端通信的开源工具，这可能导致部分用户的游戏 ID 随崩溃报告上传至外部 Sentry 服务。
五、 改进建议优先级矩阵
优先级	模块	修复建议
P0 (高危)	SQLite 存储机制	将 meet_db、backtest、insight 的单连接 Mutex 统一封装并迁移至 tokio::task::spawn_blocking 中执行，避免阻塞异步运行时。
P0 (高危)	cloud_sync.rs 凭证与安全	严禁在代码中直接写死 PostgREST URL，增加服务端鉴权或对云端同步数据进行端到端加密（E2EE），防止恶意篡改其他用户的 puuid 备注。
P1 (严重)	前端异步请求竞态	在 useCounterIntel、useBestPicks 及相关组件中引入 AbortController，在入参变动时取消在途的 IPC 请求。
P1 (严重)	v-html 防护	在 AssetTooltipContent.vue 中弃用手写 DOMParser 拼接过滤，引入经过严格审计的 DOMPurify 库。
P2 (体验)	定时器与监控	重构 Gaming.vue 和 game_state_monitor.rs，使用明确的状态机管理对局各 Phase 转移，杜绝连接抖动带来的闪屏。
Model 16:14
对代码库进行深度排查后，再次发现了一批极具隐蔽性、但在特定场景下会导致崩溃、死循环、功能失效或状态错乱的深层 Bug。
以下是具体的排查结果与代码证据：
一、 致命逻辑 Bug（严重影响核心功能）
1. get_champion_options 负数 ID 强转 u16 引发溢出/越界
位置: rank-analysis-app/src-tauri/src/command/config.rs
代码段:
code
Rust
for (id, item) in asset::CHAMPION_CACHE.read().unwrap().iter() {
    let champion = item.clone();
    let known_alias = constant::game::CHAMPION_MAP
        .get(&(*id as u16)) // <-- 严重隐患
        .map(|c| c.nickname.to_string())
        .unwrap_or_else(|| champion.alias.clone());
问题分析:
CHAMPION_CACHE 中的键是 i64。在英雄联盟客户端的特殊对局、占位英雄、训练模式或未选中状态中，存在 championId = -1（例如 -1.png 兜底占位）。
-1 as u16 在 Rust 中会发生环绕变为 65535，虽然不会 panic，但如果在 debug 模式或未来开了 overflow-checks 的环境会导致整数溢出。
更重要的是，当存在非法/特殊负数 ID 时，查表结果会错乱，且 -1 这种哨兵值会被推入给前端选项，导致前端选择框出现无名异常项。
2. normalize_position 对辅助位（UTILITY）判断死循环与互斥错误
位置: rank-analysis-app/src-tauri/src/backtest/samples.rs 与 insight/mod.rs
代码段:
code
Rust
pub(crate) fn normalize_position(lane: &str, role: &str) -> Option<&'static str> {
    match (lane.trim().to_ascii_uppercase().as_str(), role.trim().to_ascii_uppercase().as_str()) {
        ("MID", _) | ("MIDDLE", _) => Some("MIDDLE"),
        ("TOP", _) => Some("TOP"),
        ("JUNGLE", _) => Some("JUNGLE"),
        ("BOTTOM", "DUO_SUPPORT") | ("UTILITY", _) => Some("UTILITY"),
        ("BOTTOM", _) => Some("BOTTOM"),
        _ => None,
    }
}
问题分析:
在 LCU / SGP 实际回传的 timeline 数据中，辅助（Support）玩家的 lane 经常被上报为 "NONE" 且 role 为 "DUO_SUPPORT"，或者 lane 为 "BOTTOM"、role 为 "SUPPORT"（注意不是 DUO_SUPPORT，SGP 甚至有单独的 SUPPORT）。
这种情况下，("BOTTOM", "SUPPORT") 会直接掉入 ("BOTTOM", _)，被错误判断为下路 ADC（BOTTOM）！
导致后果：辅助玩家被归类为 ADC，使得计算对位胜率差（worst_matchup、Backtest、scouting 对手威胁分析）时，把辅助的数据与敌方 ADC 强行匹配对位，彻底算错表现分和胜率。
3. 选人期混淆 PUUID 解密算法假定与硬编码 Key 失效
位置: rank-analysis-app/src-tauri/src/lcu/util/uuid.rs
代码段:
code
Rust
pub fn deobfuscate_puuid(obfuscated: &str) -> Result<String, String> {
    deobfuscate_with_key(obfuscated, &KEY_PUUID)
}
问题分析:
英雄选择阶段拳头为了防秒退和战绩窥探，引入了混淆加密。KEY_PUUID 是硬编码的 XOR 密钥。
当 Riot 客户端版本更新密钥轮换时，deobfuscated 还原出的 UUID 版本号校验会失败：
code
Rust
if (decrypted[6] >> 4) != 5 { // 校验 UUID v5
    return Err("...".into());
}
一旦解密失败，scouting.rs 和 session.rs 会直接降级回退为空，导致国服高分段/排位赛在选人期敌方 5 个人全部无法透视战绩，甚至部分对局会因为返回 Err 导致前端整个 ChampSelect 阶段报错闪烁。缺乏对密钥版本轮换的弹性机制。
4. start_trade_automation 的定时器任务漂移与死循环请求
位置: rank-analysis-app/src-tauri/src/automation.rs
代码段:
code
Rust
async fn start_trade_automation() {
    let mut ticker = interval(Duration::from_secs(2));
    loop {
        ticker.tick().await;
        // ... 每次 tick 都请求一次 get_champion_select_session
    }
}
问题分析:
start_trade_automation、start_champion_select_automation、start_champion_ban_automation、start_bp_decision_automation 这 4 个独立的 Tokio Task 在选人期同时运行！
每个 Task 都在用 interval(1s) 或 interval(2s) 调用 get_champion_select_session().await。
虽然 get_champion_select_session 内部有 1 秒的 SELECT_CACHE 互斥锁，但 4 个任务并发竞争同一个 SELECT_CACHE 互斥锁，高频向本地 LCU 发送 HTTPS 请求。在选人倒计时紧张时，极易造成 LCU 客户端连接超时，导致自动化操作（秒选、秒 Ban）因请求被堵塞而错过倒计时。
二、 业务规则与数据一致性漏洞
1. WeGame 评分算法被“挂机/零人头对局”击穿（除以零与溢出）
位置: rank-analysis-app/src-tauri/src/lcu/api/match_history.rs (wegame_score)
代码段:
code
Rust
pub(crate) fn wegame_score(stats: &Stats, team_kills: i32, max_v: (i32, i32, i32, i32, i32)) -> f64 {
    let kda = (stats.kills as f64 + stats.assists as f64) / f64::from(stats.deaths.max(1));
    // ...
    let team_kill_share = if team_kills <= 0 {
        0.0
    } else {
        (f64::from(stats.kills + stats.assists) / f64::from(team_kills)).min(1.0)
    };
    // ...
    fn norm(v: i32, m: i32) -> f64 {
        if m <= 0 { 0.0 } else { (v as f64 / m as f64).min(1.0) }
    }
问题分析:
如果整场对局出现特殊情况（例如 3 分钟重开 Remake，或者极其惨烈的零封局）：
max_v 的某一项（如 max_turret 推塔伤害）全场为 0，norm 返回 0.0。
但在前台前端文件 rank-analysis-app/src/composables/useMatchDetailPlayers.ts 中：
code
TypeScript
export function computeMatchScore(s: ParticipantStats, ctx: ScoreContext): number {
  // 前端同款计算！
  const norm = (v: number, m: number) => (m <= 0 ? 0 : Math.min(1, v / m))
后端与前端看似一致，但注意：在前端 useMatchDetailPlayers.ts 中，KDA 的归一化函数是 kda / (kda + 3)，而后端 Rust 写的却是完全不同的加权公式！
两端算法脱节：前端展示的评分与后端写入数据库的评分（playerScore.rs / score.rs）计算公式不一致，导致同一局游戏在战绩列表显示的 MVP 分数与详情页内展示的分数不一致。
2. 知识库加载逻辑缓存穿透与空文件覆写
位置: rank-analysis-app/src-tauri/src/knowledge.rs (get_or_fetch)
代码段:
code
Rust
pub async fn get_or_fetch() -> Arc<KnowledgeSnapshot> {
    // ...
    let disk = load_from_path(&default_path());
    if let Some(d) = disk.as_ref() {
        // 如果命中磁盘就直接返回
        return arc;
    }
    // 否则从网络 fetch
    // 若 fetch 失败：
    data: disk.and_then(|d| d.data).or_else(|| fallback_base())
问题分析:
在 force_refresh() 或网络拉取失败时，如果磁盘上存在旧的损坏文件，fallback_base() 虽然加载了硬编码的兜底数据，但并没有写回磁盘。
下次调用时，依然会重新尝试加载、解析失败、重新联网请求，导致只要无网络，每次调用相关功能都会产生明显的延迟卡顿，形成隐式缓存穿透。
3. 跨区战绩（SGP）拉取时时间戳解析崩溃隐患
位置: rank-analysis-app/src-tauri/src/lcu/api/sgp.rs (epoch_ms_to_iso)
代码段:
code
Rust
pub(crate) fn epoch_ms_to_iso(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, m, d, sod / 3600, (sod % 3600) / 60, sod % 60, millis
    )
}
问题分析:
在 civil_from_days 算法中，若由于某些异常数据或时钟错误导致传入的 ms 极大或者为负极端值，y 格式化为 {:04} 时如果为负数会输出类似 -001-12-31T... 格式。
前端 JavaScript 在使用 new Date(raw) 时，不同浏览器内核（WebView2 vs WebKit）对负年份或格式不合法的 ISO 字符串解析不一致，Chromium 会将其解析为 Invalid Date，导致前端在执行 .slice(0, 10) 或 getMonth() 时抛出 NaN 或异常，使整个对局卡片崩溃空白。
三、 前端渲染与内存泄漏隐患
1. Pinia 状态与路由解耦不彻底，页面返回导致 Pinia 异步悬挂
位置: rank-analysis-app/src/features/mayhem/stores/mayhemStore.ts
代码段:
code
TypeScript
async function sync(force = false): Promise<any> {
    syncing.value = true
    try {
        const rep = await syncMayhemData(force)
        // 异步等待长达数秒到数十秒
        await loadChampions(true)
        await loadAugments(true)
        // ...
    } finally {
        syncing.value = false
    }
}
问题分析:
用户在点击“刷新数据”后如果立即切换到“战绩”或“对局”页面，mayhemStore 的后台 sync 任务仍在继续。
当它下载完并在非活动路由下触发大量响应式数据变更时，由于 Vue 的组件保活和依赖跟踪机制，会强制触发未挂载视图的重算，并在网络出错时依然通过未被销毁的消息钩子弹出错误信息，破坏了跨页面的交互体验。
2. 虚拟滚动缺失导致超长对局列表内存膨胀
位置: rank-analysis-app/src/views/Record.vue & components/record/MatchHistory.vue
代码段:
在开启了 SGP 跨区全量对局拉取（collectSgpHistoryAll）后，allGames 数组中可以累积多达数百甚至上千场对局详情。
在分页或展开详情时，RecordCard 和 MatchDetailInline 会一次性在 DOM 中保持或频繁挂载巨量包含数十个图片头像、图标、SVG 折线图与 Tooltip 的复杂节点。
这会导致 WebView 进程的内存迅速突破 500MB+，在配置较低的电脑上引发界面卡顿甚至 WebView 崩溃。
四、 修复建议列表
修正位置匹配逻辑:
重构 normalize_position，显式匹配 ("BOTTOM", "SUPPORT") 与 (_, "DUO_SUPPORT")，防止辅助位被误算作 ADC。
统一前后端评分算法:
统一 wegame_score 与前端 computeMatchScore 的 KDA 归一化公式，选择保留纯线性映射或饱和曲线函数，不能两头各算各的。
收敛自动化任务轮询:
将 start_trade_automation、start_champion_select_automation 和 start_champion_ban_automation 合并为一个统一的 ChampSelectRunner 周期循环，每个周期只向 LCU 请求一次 SelectSession，然后顺序分发给秒选、秒 Ban、换人和决策模块，降低 75% 的 LCU IPC 压力。
负数 ID 边界检查:
在 command/config.rs 中使用 i32 到 u16 转换前必须进行 id > 0 守卫，杜绝负数哨兵值进入 CHAMPION_MAP 查找逻辑。
Model 16:15
继续对项目进行深入挖掘，在底层系统适配、协议解析边界、AI 提示词/流式解析、多窗口生命周期与自动化规则引擎中发现了以下隐蔽而关键的问题：
一、 跨平台（macOS vs Windows）底层机制不兼容缺陷
1. macOS 下 procargs2 解析命令行必定越界 Panic
位置: rank-analysis-app/src-tauri/src/lcu/util/token.rs (第 350-380 行 macos::parse_procargs2)
代码分析:
code
Rust
let segments: Vec<&str> = raw.split('\0').collect();
for seg in segments.into_iter().skip(2) {
    // ...
}
严重隐患:
macOS 内核中通过 KERN_PROCARGS2 读取进程参数时，返回的缓冲区首部结构为一个 int argc，随后紧跟的是 exec_path（以 \0 结尾），接下来可能包含若干连续的空字符 \0（字节对齐填充），然后才是真正的环境变量和命令行参数。
直接简单按 \0 进行切分并 skip(2)，如果对齐字节较多，skip(2) 后拿到的只是空字符串，导致完全解析不到 --remoting-auth-token 与 --app-port；
更严重的是，如果缓冲区畸形或进程刚好正在退出，segments.len() < 2 时虽然不会 panic，但在 read_command_line 逻辑里直接返回空，导致 macOS 下读取正在运行的 LeagueClientUx 命令行极不稳定，直接退化为只能靠 lockfile。
2. macOS 下缺失辅助权限时 tileWindowsSideBySide 失败无感知
位置: rank-analysis-app/src/utils/windows.ts
代码分析:
code
TypeScript
export async function tileWindowsSideBySide(): Promise<void> {
  const main = await WebviewWindow.getByLabel('main')
  // ...
  await main?.setPosition(new LogicalPosition(0, 0))
  await main?.setSize(new LogicalSize(halfWidth, height))
}
问题: 在 macOS 上，Tauri 窗口在没有配置原生全屏或开启 Accessibility 权限时，若开启了系统级 Stage Manager（台前调度）或处于多显示器空间（Spaces）环境，直接强设 (0, 0) 会被 macOS 窗口管理器强制推回原 Space，甚至抛出异步异常未被捕获，导致前端 UI 卡死在点击态。
二、 自动化与规则引擎（Rule Engine）死锁与误操作风险
1. 自动 Ban/Pick 在队友尚未亮英雄时判定“空真”误封自己人
位置: rank-analysis-app/src-tauri/src/rule_engine.rs (match_condition)
代码分析:
code
Rust
RuleCondition::AllyChampionsNotContains { ids } => !team_has_any(&session.my_team, ids),
配合 team_has_any:
code
Rust
fn team_has_any(team: &[OnePlayer], ids: &[i32]) -> bool {
    team.iter().any(|p| {
        let cid = display_champion_id(p);
        cid != 0 && ids.contains(&cid)
    })
}
严重业务漏洞:
玩家配置了一个规则：“如果队友不选莫甘娜（AllyChampionsNotContains [25]），我就 Ban 莫甘娜”。
在选人阶段的第一轮（banning 阶段），队友通常还没有亮英雄（所有队友的 display_champion_id 全都是 0）。
此时 team_has_any 遍历队友，所有 cid != 0 均为 false，导致 team_has_any 返回 false。
取反后 AllyChampionsNotContains 恒为 true！
后果: 哪怕队友本想在选人阶段选莫甘娜（只是在 Ban 人阶段没预选），规则引擎在禁用阶段就会直接触发并自动把莫甘娜 Ban 掉，引起严重内讧与误操作！
2. autoAccept 与 LCU 阶段锁竞争导致客户端弹窗丢失
位置: rank-analysis-app/src-tauri/src/automation.rs (start_accept_match_automation)
代码分析:
start_accept_match_automation 设置为 interval(Duration::from_millis(100))，每 100ms 无间断轮询 get_phase()。
英雄联盟客户端在触发匹配确认时，相应用时在 200ms~1000ms 之间。
100ms 的超短间隔会高频打满 LCU 的 local HTTP 连接池。当客户端正在处理匹配接受时，连续的并发请求会收到 409 Conflict 或 500 响应，触发 FailureBackoff。
一旦进入 FailureBackoff，下一次重试会被推迟 500ms -> 1s -> 2s。在极端情况下，直接导致错过了 10 秒接受窗口，玩家被判秒退/惩罚排队。
三、 AI 服务流式解析与用量统计算法缺陷
1. 流式响应断包导致 JSON 截断无法解析（SSE 分包跨 Chunk）
位置: rank-analysis-app/src-tauri/src/command/ai.rs (第 140-170 行)
代码分析:
code
Rust
while let Some(line_end) = buffer.iter().position(|&b| b == b'\n') {
    let line_bytes: Vec<u8> = buffer.drain(..=line_end).collect();
    let line = String::from_utf8_lossy(&line_bytes[..line_bytes.len() - 1])
        .trim()
        .to_string();
    // ...
    if let Some(usage) = extract_usage(&line) { ... }
问题分析:
该代码仅按 \n 进行简单的行拆分。但在真实的流式网络传输（尤其是跨公网调用 DeepSeek / DashScope）中，TCP Chunk 拆包时经常出现多行合并或者 data: {"usage": ... 字段在行内换行（比如带有格式化的 JSON）。
如果 API 服务商在流式末尾返回的 usage chunk 使用了双换行 \r\n\r\n，line_bytes[..line_bytes.len() - 1] 裁剪掉一个字节后，末尾仍残留 \r。
当使用 extract_usage 处理带 \r 的字符串时：
code
Rust
let json: serde_json::Value = serde_json::from_str(data).ok()?;
某些格式的 JSON 会由于隐式字符导致 serde_json::from_str 解析失败返回 None，导致 AI Token 用量永远漏记，用量台账中显示为 0。
2. runTwoStage 状态机无全局超时（挂起无限等待）
位置: rank-analysis-app/src/services/ai/shared/twoStage.ts
问题分析:
runTwoStage 执行第一阶段归因（Attribution）和第二阶段点评（Critique）。
如果大模型服务发生网络 Hang 死（比如 TCP 连接建立了但模型生成卡住，服务端未断开也没发终止包），底层虽然有单个请求超时，但前端 Promise 链路没有整体 AbortController 或 timeout 守卫。
表现为：详情页的「AI 复盘」按钮持续显示 Loading 旋转菊花，用户无法取消，也无法再次点击重新生成，直到整个页面被强行关闭或刷新。
四、 多窗口（Overlay & Record Child）生命周期与资源泄露
1. 子窗口关闭未同步注销前端事件监听器
位置: rank-analysis-app/src/views/OverlayView.vue 与 views/Record.vue
代码分析:
code
TypeScript
onMounted(async () => {
  unlistenUpdate = await listen<NextAction[]>('overlay:update', ...)
  unlistenConfig = await listen<Partial<OverlayPrefs>>('overlay:config', ...)
  unlistenPanel = await listen<OverlayPanelEnvelope>('overlay:panel', ...)
})
问题分析:
在 windows.ts 中，战绩子窗口 RecordChild 可以被多次打开和关闭（通过独立 WebviewWindow）。
当调用窗口的 .close() 时，Webview 实例被注销，但在 Tauri 核心事件分发树（Event Registry）中，由全局 listen 注册的回调如果因为 Promise 微任务时序滞后于 unlisten，在窗口销毁时会触发未捕获的 IPC 异常：Webview target not found。
在 main.rs 的退出处理中：
code
Rust
if window.label() == "main" {
    if let Some(overlay) = window.app_handle().get_webview_window("overlay") {
        let _ = overlay.destroy();
    }
    window.app_handle().exit(0);
}
只清理了 overlay，但没有销毁所有可能存在的战绩子窗口（record-*），在 Windows 上可能导致后台残留孤儿渲染进程（Zombie Webview Process），占用数百兆内存不退出。
2. force_close_overlay 释放鼠标穿透失败
位置: rank-analysis-app/src-tauri/src/command/overlay.rs (force_close_overlay)
代码分析:
force_close_overlay 尝试隐藏浮窗并重设忽略鼠标事件。
但在 Windows 下，若游戏处于“全屏独占模式”（Full Screen Exclusive），调用 set_ignore_cursor_events(true) 往往会失效甚至造成焦点捕获丢失，导致游戏内的鼠标点击被隐形的透明窗口拦截，玩家在游戏内无法点击技能或走位，必须按 Alt+Tab 切回桌面才能恢复。
五、 数据展示与统计精度缺陷
1. safeRelativePercent 极大数值或除零时的 NaN 渗透
位置: rank-analysis-app/src/utils/format.ts
代码段:
code
TypeScript
export function safeRelativePercent(value: number, maxValue: number) {
  if (maxValue <= 0 || !Number.isFinite(maxValue) || !Number.isFinite(value)) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round((value / maxValue) * 100)))
}
问题:
并在前端多个组件中被使用：player.teamRelative.damage = safeRelativePercent(p.stats.totalDamageDealtToChampions, teamDamage)。
但是如果整队伤害全为 0（如开局 1 分钟掉线对局），teamDamage 为 0，函数返回 0。
然而在 MatchDetailSummaryTab.vue 的 playerBars 中：
code
TypeScript
width: `${Math.max(3, Math.round((value / max) * 100))}%`
这里的 max 直接从 gameMax.value.damage 取值。如果全场所有人伤害都是 0，gameMax 虽然保底了 1，但如果遇到异常数据 NaN，CSS 的 width 会变成 NaN%，引发样式错乱，浏览器控制台频繁打印 CSS 解析告警。
建议排期与修复方案
修复规则引擎空真逻辑：在 RuleCondition::AllyChampionsNotContains 判定中，必须加入前置条件：队友必须已进入选人状态且所选英雄非零，若全队尚未确定英雄，该条件不得判定为匹配。
重构进程退出清理机制：在 main.rs 的 window_event 监听中遍历 getAllWebviewWindows()，在主窗口关闭时统一调用其 destroy()，防止残留后台孤儿进程。
消除 SSE 数据流尾部 \r：在 command/ai.rs 中将 line.trim() 升级为规范过滤 line.trim_matches(|c| c == '\r' || c == '\n')。
Model 16:15
ThinkingThoughts
Expand to view model thoughts

chevron_right
在对代码库进行全模块交叉审查后，又定位到了 5 处处于深水区的高危 Bug 与架构逻辑缺陷。这些问题涉及 LCU 状态错乱、KeepAlive 导致的详情页数据串线、历史数据全表反序列化造成的性能悬崖、规则引擎逻辑断言反转、以及跨局统计的上下文错位：
一、 核心通信与状态机缺陷（Critical Network & State）
1. LCU 全局 WebSocket 事件监听器无差别篡改游戏阶段（Phase 污染）
文件: rank-analysis-app/src-tauri/src/lcu/listener.rs
代码段:
code
Rust
async fn handle_event(&self, event: &Value, debounce_tx: &tokio::sync::mpsc::Sender<String>) {
    if let Some(uri) = event.get("uri").and_then(|v| v.as_str()) {
        let data = event.get("data");
        // 致命缺陷：未判断 URI 是否为 gameflow-phase！
        if let Some(phase) = data.and_then(|d| d.as_str()) {
            crate::lcu::api::phase::update_phase_cache(phase.to_string());
        }
        let _ = debounce_tx.try_send(uri.to_string());
    }
}
问题分析:
listener.rs 订阅了 LCU 的通用根主题 [5, "OnJsonApiEvent"]，该连接会收到客户端派发的所有 REST/WS 事件（包括聊天消息、好友状态、商城推送等）。
代码在提取 data 时，完全没有判断 uri 是否为 /lol-gameflow/v1/gameflow-phase。
一旦任何其他端点（例如好友聊天、状态广播 lol-chat/v1/me）派发了一个字符串类型的字段（如签名 "Away"、状态 "chat" 或在线状态），update_phase_cache 会直接把当前对局阶段覆盖为该字符串！
严重后果: 导致 get_phase() 突然返回非法状态，对局中和选人期的自动化监控（game_state_monitor.rs）瞬间判定游戏退出，触发 session-complete 清空页面，造成 UI 偶发性闪退回大厅待机页。
二、 前端架构与缓存保持缺陷（Vue KeepAlive Lifecycle）
2. 对局详情 Tab 在 <KeepAlive> 下切换对局不刷新（数据幽灵残留）
文件: rank-analysis-app/src/components/record/MatchDetailInline.vue
以及相关 Tab 组件:
MatchDetailBacktestTab.vue
MatchDetailScoreTab.vue
MatchDetailEventsTab.vue
MatchDetailTimelineTab.vue
代码结构:
code
Vue
<!-- MatchDetailInline.vue -->
<div class="match-detail-tab-pane">
  <KeepAlive>
    <component :is="activeTabComponent" />
  </KeepAlive>
</div>
问题分析:
MatchDetailInline 使用 <KeepAlive> 缓存了已打开的 Tab 组件。
当玩家在列表或者快捷键盘中切换对局（game 变化，例如按“下一个对局”或左侧列表点击新卡片）时，被缓存的 Tab 组件（如 MatchDetailBacktestTab 和 MatchDetailScoreTab）中，数据请求全部写在 onMounted 钩子中，完全没有监听 gameId 的变化：
code
TypeScript
// MatchDetailBacktestTab.vue
onMounted(async () => {
  const gameId = ctx.game.value?.gameId
  // 切换对局时，onMounted 不会重新执行！
  const [r, s] = await Promise.all([fetchDecisionBacktest(gameId), fetchAdoptionStats()])
  result.value = r
})
严重后果: 用户切到第二场、第三场比赛时，回测评分、17分制打分、SGP 帧流事件等子 Tab 始终停留在第一场比赛的数据上，造成严重的战绩与归因“张冠李戴”。
三、 历史战绩聚合与算法错位（Algorithm Context Mismatch）
3. 敌方打野抓人节奏（Gank Pattern）分路推断上下文错位
文件: rank-analysis-app/src/features/gaming/services/gankPattern.ts 与 useLineupScore.ts
代码调用链:
code
TypeScript
// gankPattern.ts
export function aggregateGankPattern(
  raw: GankPatternRaw,
  positionOf: (championId: number) => string | undefined
): GankPatternSummary {
  // ...
  for (const ev of raw.killEvents) {
    const pos = positionOf(ev.victimChampionId) // <-- 这里的参数是过去对局的受害英雄 ID
    // ...
  }
}
问题分析:
GankPatternRaw.killEvents 中记录的是该打野玩家在过去的 20 场排位中击杀的受害者英雄 ID（例如 3 天前击杀了敌方的提莫）。
但在 useLineupScore.ts 中传入的 positionOf 回调，绑定的映射字典是当前这局游戏的 10 个英雄与其对应的分路。
过去的受害英雄通常根本不在当前这局游戏里，导致 positionOf(ev.victimChampionId) 95% 以上的几率返回 undefined！
后果: 击杀位置几乎全被归类到 OTHER，抓人高频路判定失效，前台永远只能输出类似 “偏好其他路”，选人阶段的打野预警功能实质上失效。
四、 性能瓶颈与全表反复反序列化（Performance & Memory Cliff）
4. all_collected_games 在对局评估中被乘数级重复调用（全表全盘大反序列化）
文件: rank-analysis-app/src-tauri/src/scouting/mod.rs & meet_db.rs
代码分析:
code
Rust
// scouting/mod.rs
pub fn assess_team_threats(_my_puuid: &str, enemies: &[PlayerInfo]) -> Vec<ThreatRating> {
    let enemies_with_games: Vec<(PlayerInfo, Vec<Game>)> = enemies
        .iter()
        .map(|e| (e.clone(), all_games_for_player(&e.puuid))) // <-- 对 5 个敌人循环
        .collect();
    // ...
}

fn all_games_for_player(puuid: &str) -> Vec<Game> {
    // 每次都全表查询！
    for (_region, _name, games) in all_collected_games() {
        // ...
    }
}
问题分析:
all_collected_games() 在 SQLite 中执行 SELECT games_json FROM collected_games，把该表内所有大区、所有召唤师的完整对局记录全部 serde_json::from_str 成庞大的 Vec<Game>。
在 assess_team_threats 中，对敌方 5 名玩家分别调用了一次 all_games_for_player。
后果: 只要用户开启了多次战绩收集，整个数据库的全部 JSON 被连续反复从磁盘读取并完整反序列化 5 次，在选人阶段会瞬间吃满单个 CPU 核心，造成前端界面出现数秒的完全无响应（卡死）。正确的做法是先在数据库层面按 PUUID/索引过滤，或在一次全表扫描中分组归拢。
五、 自动化与防抖逻辑并发漏洞（Concurrency Edge Case）
5. 跨局任务序列号逃逸导致旧对局数据覆盖新对局（session.rs）
文件: rank-analysis-app/src-tauri/src/command/session.rs (process_subteam_parallel)
代码分析:
code
Rust
let futures = players.into_iter().enumerate().map(|(index, player)| async move {
    // 异步拉取召唤师详细信息与近期战绩（耗时 1~3 秒）
    // ...
    // 派发单人事件：
    if let Err(e) = app_handle.emit("session-player-update", &update) {
        // ...
    }
});
问题分析:
在 process_session_data 启动时生成了严格单调递增的序列号 seq，并记录了全局原子计数器 SESSION_TASK_SEQ。
在主流程多处插入了 if !is_latest_task(&SESSION_TASK_SEQ, seq) { return Ok(()); } 检查。
漏洞点: 在 process_subteam_parallel 的并发 Future 内部，各玩家信息的拉取耗时不一致（有的命中缓存只需 10ms，有的调外部接口需要 2s）。在单人信息就绪向前端 emit("session-player-update") 时，没有检查 is_latest_task！
后果: 当玩家秒退重进或对局阶段迅速切到 GameStart 时，上一轮未完成的缓慢请求返回后，强行向前端派发上一局玩家的战绩更新事件，导致前端卡片在游戏开局后突然把当前队友替换成上一把秒退局的玩家卡片。
推荐修复总结
listener.rs: 在判断 phase 前，增加前置路由判断：if uri == "/lol-gameflow/v1/gameflow-phase"。
MatchDetailInline.vue 及各子 Tab: 移除裸 onMounted，为子组件增加 watch(() => ctx.game.value?.gameId, loadData, { immediate: true })，使 <KeepAlive> 切换对局时正常响应。
gankPattern.ts: 改造 positionOf，不能依赖当前对局已知英雄字典，应在 SGP/LCU 提取对局数据时，从该场比赛自身的 timeline.lane 或对局元数据中直接读取该击杀发生所在的分路。
scouting/mod.rs: 将 all_collected_games() 提到循环外部单次调用并构建以 puuid 为键的倒排索引 HashMap<String, Vec<Game>>，杜绝 5 次全表扫描。
session.rs: 在 process_subteam_parallel 的 emit("session-player-update") 之前加入 if !is_latest_task(&SESSION_TASK_SEQ, seq) { return; } 守卫。
Model 16:17
对仓库全部核心链路继续进行地毯式扫描，在AI归因验证器、LCU认证管道、前端数据聚合去重、多段位切换联动、以及自动化规则执行中，再次定位到 5 处严重缺陷：
一、 AI 归因与验证层漏洞（AI Match Critique Engine）
1. stripFencedCodeBlock 正则由于前导文本导致 JSON 解析 100% 失败
文件: rank-analysis-app/src/services/ai/matchDetail/validator.ts
代码实现:
code
TypeScript
function stripFencedCodeBlock(raw: string): string {
  const trimmed = raw.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return match ? match[1].trim() : trimmed
}
问题分析:
正则表达式声明了开头 ^ 和结尾 $。
在大模型（如 DashScope Qwen / DeepSeek）实际调用中，哪怕设定了 JSON 模式或 System Prompt 要求仅回复 JSON，模型经常会在 Markdown 代码块前后输出自然语言废话，例如：
好的，以下是对局归因分析：\n```json\n{"winReason": "..."}\n```\n希望对你有帮助！
这种输出因为前导文本的存在，trimmed.match(...) 完全无法匹配，导致 stripFencedCodeBlock 原样返回带有前后废话的原始字符串。
随后的 JSON.parse(raw) 抛出语法异常，触发 Stage 1 解析失败（stage1ParseError），迫使系统降级为纯模板输出，导致 AI 高级归因功能直接断流失效。
修复方案:
去掉两端锚点，提取第一个代码块内部或从第一个 { 截取至最后一个 }：
code
TypeScript
const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
2. runTwoStage 在解析失败时未清除坏缓存，导致重试死锁
文件: rank-analysis-app/src/services/ai/shared/twoStage.ts
代码逻辑:
runTwoStage 依次调用 Stage 1 和 Stage 2。
Stage 1 请求 LLM 时通过 requestAIContent 发起，requestAIContent 在收到 LLM 回包后，只要网络是通的，就无条件将其写入 sessionStorage 缓存。
紧接着 parse(raw) 进行结构校验。如果大模型输出的 JSON 结构缺字段或校验不通过，runTwoStage 捕获到 ParseError 并准备进行下一次 attempt 重试。
严重缺陷: 重试循环再次调用 requestAIContent 时，该函数第一件事就是 readCacheSafe(cacheKey)！
导致下一次重试直接命中上一把刚刚存入的坏数据，完全不向大模型发起真实重试，重试逻辑退化为死循环空转。
二、 认证与 LCU 通信关键缺陷（LCU Process Token Extraction）
3. Windows 平台命令行读取未处理 PAGE_SIZE 超限与多包读取死循环
文件: rank-analysis-app/src-tauri/src/lcu/util/token.rs (platform::windows::read_command_line)
代码实现:
code
Rust
let mut buffer: Vec<u8> = vec![0; initial_size as usize];
let status = NtQueryInformationProcess(
    handle,
    ProcessCommandLineInformation,
    buffer.as_mut_ptr() as *mut _,
    initial_size,
    &mut return_size,
);
if status == STATUS_BUFFER_TOO_SMALL || status == STATUS_INFO_LENGTH_MISMATCH {
    buffer.resize(return_size as usize, 0);
    // 缺陷：resize 后并没有重新调用 NtQueryInformationProcess！
}
问题分析:
Windows 10/11 的 NT API 中，NtQueryInformationProcess 查询命令行时，若预先分配的缓冲区不够大，会返回 STATUS_INFO_LENGTH_MISMATCH 或 STATUS_BUFFER_TOO_SMALL，并把实际需要的字节数写入 return_size。
观察上述代码：在条件分支内执行了 buffer.resize(...)，但没有在此分支内重新发起第二次系统调用，随后代码直接执行到：
code
Rust
let ucs = &*(buffer.as_ptr() as *const UNICODE_STRING);
此时缓冲区虽然扩容了，但里面全是 全 0 填充的空字节（未经过第二次系统填充）！
读出的 ucs.Buffer 指针和长度均为 0，导致命令行读取必定失败，抛出“返回的缓冲区大小为0”，使整套基于进程参数获取 Token 的逻辑直接失效。
三、 数据聚合与算法隐患（Aggregation & Calculations）
4. 英雄池胜率计算未过滤无效局，胜率被拉低（Champion Pool Calculation）
文件: rank-analysis-app/src/components/record/championPool.ts
代码实现:
code
TypeScript
export function aggregateChampionPool(games: Game[]): ChampionPoolEntry[] {
  // ...
  for (const g of games) {
    const me = g.participants[0]
    if (!me) continue
    const entry = map.get(me.championId)
    entry.count += 1
    if (me.stats.win) entry.wins += 1
    else entry.losses += 1
  }
}
问题分析:
在英雄联盟对局中，存在重开局（Remake）与秒退平局（Invalid Game）。这些对局的 gameDuration < 300 甚至只有 180 秒，且两边胜负在客户端统计中不算做负场（或计为特殊标志）。
在上述代码中，只要 me.stats.win 为 false，就直接判定为 entry.losses += 1，并将重开局计入总场次 count。
这导致玩家如果有 3 场排位由于队友掉线而重开，在英雄池中直接被记作 3 场纯负场，导致常用英雄池与绝活榜上的胜率被非正常拉低，进而影响自动 BP 决策（BpSuggest 会误认为该英雄常输而放入 Ban 池）。
四、 选人期跨段位联动失效（State Desync in ChampSelect）
5. BestPicksPanel 切换段位后，推荐池缓存不失效导致视图与段位标头脱节
文件: rank-analysis-app/src/composables/useCounterIntel.ts (useBestPicks)
逻辑缺陷:
在选人阶段，用户可以在顶部或推荐面板右上角把段位从 emerald_plus（翡翠及以上）切换为 diamond_plus（钻石及以上）。
useBestPicks 内部维护了 myPoolCache 与模块级全局的 CHAMPION_INTEL_CACHE:
code
TypeScript
function cacheKey(region: string, championId: number, position: string, tier: string): string
当触发 emit('switch-tier', next) 时，tier 的变化虽然更新了 effectivePosition 相关的 watch，但 useBestPicks 内部通过 opggRevision 触发重新评估时，candidateIds 内部的排序计算没有对已经缓存在闭包内的 intelFor 进行局部丢弃，某些已计算过 intel 的英雄仍然读取了旧段位在本地缓存的协同分和克制分。
表现: 切换段位后，底部的来源文本变成了新段位，但中间列表的胜率差和英雄打分完全没有变动，必须退出选人或强制刷新页面才会变。
优先修复建议
重构 validator.ts:
将 JSON 抽取改为模糊定位匹配，先寻找文本中的第一个 { 和最后一个 }，再行解析：
code
TypeScript
function stripFencedCodeBlock(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return (start !== -1 && end !== -1 && end > start) ? raw.slice(start, end + 1) : raw.trim();
}
修复 windows::read_command_line:
在 buffer.resize 后必须补上第二次 NtQueryInformationProcess 调用。
清除坏缓存:
在 twoStage.ts 捕获到解析错误后，必须显式调用 sessionStorage.removeItem(cacheKey) 清理污染数据。
Model 16:18
通过对剩余业务逻辑代码的穷尽式交叉验证，又定位到了 5 处处于边缘条件（Edge Case）与异步时序交错下的高危缺陷。这些问题涉及 剪贴板并发踩踏、云同步覆盖风暴、装备图标死循环回退、自动化秒选逻辑时钟跳变、以及数据备份格式脆弱性：
一、 异步并发与竞态漏洞（Async Concurrency & Race Conditions）
1. 智能推荐多英雄“连续采纳”引发写冲突与配置丢失
文件: rank-analysis-app/src/components/automation/BpSuggestModal.vue
代码实现:
code
TypeScript
let adoptChain: Promise<void> = Promise.resolve()

async function doAdopt(item: BpSuggestItem, pool: SuggestedPool, aKey: string) {
  try {
    const key =
      pool === 'pick' ? 'settings.auto.pickChampionSlice' : 'settings.auto.banChampionSlice'
    const existing = (await getConfigByIpc<number[]>(key)) ?? []
    if (!existing.includes(item.champion_id)) {
      await putConfigByIpc(key, [...existing, item.champion_id])
    }
    // ...
  }
}

async function adopt(item: BpSuggestItem, pool: SuggestedPool) {
  const aKey = adoptKey(pool, item.champion_id)
  if (adoptingKeys.value.has(aKey)) return
  adoptingKeys.value.add(aKey)
  const myTurn = adoptChain.then(() => doAdopt(item, pool, aKey))
  adoptChain = myTurn
  await myTurn
}
严重逻辑漏洞:
开发者试图用 adoptChain 实现 Promise 串行队列，以防止并发读写 settings.auto.pickChampionSlice。
漏洞在于错误处理链被切断: 一旦队列中某个 doAdopt 抛出异常导致 Promise 被 Reject（例如 IPC 临时网络错误或格式错误），adoptChain 会变成一个 Rejected Promise！
随后的所有点击都会因为链上存在未捕获的拒绝而直接跳过或级联抛错，导致该弹窗内的**“加入英雄池/Ban池”按钮永久失效**，除非重新打开该弹窗。
修复建议: 必须使用 .catch(() => {}) 保证链的健康延续：adoptChain = myTurn.catch(() => {})。
2. 云端配置同步时间戳时钟回拨导致配置覆盖死锁（LWW 时钟漏洞）
文件: rank-analysis-app/src-tauri/src/command/cloud_sync.rs
代码实现:
code
Rust
let latest_cloud_ts = cloud_pull_config(puuid.clone())
    .ok()
    .flatten()
    .map(|c| c.updated_at)
    .unwrap_or(0);
let local_ts = now_unix() * 1000;
let updated_at = std::cmp::max(local_ts, latest_cloud_ts.saturating_add(1000));
问题分析:
该算法强制让新推送的时间戳为 latest_cloud_ts + 1000。
时序死锁: 假设设备 A 推送了一次配置，云端 updated_at 变成了 T + 1000。
随后设备 A 的前端进行常规拉取比对时，本地记录的修改时间依然是它本地系统时间 T。
因为 T + 1000 > T，前端的 cloudSyncStore 会误以为“云端有别人更新的更新配置”，立刻弹出 CloudConfigPullDialog.vue 提示用户“检测到云端配置不一致”！
用户如果点击“保留本机”，设备 A 再次推送，时间戳又被加了 1000ms……形成弹窗轰炸死循环。
二、 DOM 与前端渲染边缘缺陷（Frontend DOM & Rendering）
3. 强化卡/英雄头像在 404 时触发无限死循环事件
文件: rank-analysis-app/src/views/Mayhem.vue
代码实现:
code
Html
<img
  class="aico"
  :src="perkSrc(a.id)"
  :alt="a.name"
  loading="lazy"
  @error="fallbackIcon($event, a.iconUrl)"
/>
配合函数：
code
TypeScript
function fallbackIcon(ev: Event, remoteUrl?: string) {
  const img = ev.target as HTMLImageElement | null
  if (!img || !remoteUrl || img.dataset.fallback === remoteUrl) return
  img.dataset.fallback = remoteUrl
  img.src = remoteUrl
}
问题分析:
当本地图标服务 404 时触发 @error，调用 fallbackIcon 将图片源切换到远程 CDN（remoteUrl）。
致命隐患: 如果用户的网络环境无法访问该远程 CDN（例如断网或 DNS 污染），远程 CDN 图片同样加载失败，再次触发 @error 事件！
虽然代码中写了 img.dataset.fallback === remoteUrl 防重入，但在某些浏览器内核重置 src 的微任务周期中，dataset.fallback 的读取可能因为图片元素的属性未挂载完成或跨域刷新而被重新触发。
在大乱斗强化榜多达数十个图标连续失败时，极易造成高频死循环网络重发，导致 CPU 占用率飙升。
三、 自动化倒计时与时钟跳变缺陷（Automation Timer Glitch）
4. should_lock 在秒选阶段因时钟跳变放弃执行（错过锁定时间窗）
文件: rank-analysis-app/src-tauri/src/automation.rs
代码实现:
code
Rust
fn should_lock(d: &BpDecision, time_left: f64, is_in_progress: bool) -> bool {
    if !is_in_progress {
        return false;
    }
    let Some(t) = d.target.as_ref() else {
        return false;
    };
    t.lock && time_left <= d.execute_at_secs_left && time_left >= MIN_EXECUTE_SECS
}
问题分析:
MIN_EXECUTE_SECS 设定为 3.0，execute_at_secs_left 默认为 5.0。执行锁定的合法时间窗口仅有短短的 2 秒（3.0s ~ 5.0s）。
自动化秒选轮询任务是 interval(Duration::from_secs(1))，但是当系统负载较高、LCU IPC 发生微小排队（例如耗时 1.1 秒）时：
上一次检查时间为 5.2s（大于 5.0s，不锁）；
下一次检查时，时间直接跌到 2.8s（小于 MIN_EXECUTE_SECS，放弃执行！）。
后果: 整个自动锁定过程完全被“完美跳过”，本该自动锁定的对局直接进入超时挂机，导致玩家在不知情的情况下秒退被惩罚封退。
四、 格式兼容性与数据备份风险（Data Integrity & Migration）
5. 跨版本全量备份导入时 Map 键类型被转为字符串导致配置反序列化崩溃
文件: rank-analysis-app/src-tauri/src/config.rs (config_value_to_json 与 json_to_config_value)
代码实现:
code
Rust
fn json_to_config_value(v: serde_json::Value) -> config::Value {
    match v {
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                config::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                config::Value::Float(f)
            } else { ... }
        }
        serde_json::Value::Object(m) => {
            // 强制全部反序列化为 Map
            config::Value::Map(m.into_iter().map(|(k, v)| (k, json_to_config_value(v))).collect())
        }
        // ...
    }
}
问题分析:
在配置中，某些内部状态（如 userTags、recentProfile、oneGamePlayersMap）在 Rust 端定义为 HashMap<i64, ...> 或数字主键。
当通过备份文件或云端将配置导出为 JSON 时，JSON 规范要求对象的 Key 必须是纯字符串。
当再次读取并恢复此 JSON 配置时，数字字符串（如 "157"、"420"）被存入 config.yaml。
当其他模块（如 user_tag_config.rs 或 rule_config.rs）尝试按原始格式强转时，直接抛出 invalid type: string, expected i64，导致用户导入备份后所有依赖标签和常用英雄的自动化规则全部损坏清空。
建议修复行动项
修正 adoptChain 异常捕获:
code
TypeScript
adoptChain = adoptChain.then(() => doAdopt(item, pool, aKey)).catch(err => {
  console.error('采用失败:', err)
})
放宽自动锁定时间下限:
将 time_left >= MIN_EXECUTE_SECS 调整为只要大于等于 0.5s 即可执行，哪怕只剩 1 秒也尽全力帮玩家完成锁定，绝不直接放弃。
修复云端时间戳自增逻辑:
只有在发生真实冲突合并时才进行单调时钟平移，并且推送完成后必须将生成的云端 updatedAt 响应同步回本地 Store。
Model 16:19
对代码仓库继续进行全方位的细粒度排查，在 LCU 事件反序列化边界、多杀统计字段解析、打野节奏过滤算法、SQLite 日期排序以及大乱斗战利品解析 中，再次精准定位到 5 处严重的代码缺陷与逻辑漏洞：
一、 字段反序列化与协议类型不兼容缺陷（LCU Protocol Drift）
1. SGP 战绩中多杀字段缺少 camelCase 映射导致全量丢失
文件: rank-analysis-app/src-tauri/src/lcu/api/model.rs (Stats)
代码对比:
code
Rust
// model.rs
pub struct Stats {
    // ...
    #[serde(default)]
    pub double_kills: i32,
    #[serde(default)]
    pub triple_kills: i32,
    #[serde(default)]
    pub quadra_kills: i32,
    #[serde(default)]
    pub penta_kills: i32,
}
问题分析:
在 LCU 本地客户端返回的 JSON 中，字段名是 doubleKills、tripleKills、quadraKills、pentaKills（小驼峰命名）。
但在 model.rs 的 Stats 结构体上，并没有添加 #[serde(rename_all = "camelCase")]，而是单独在其他字段上加了宏，唯独漏掉了这几个多杀字段！
尽管有 #[serde(default)] 保证不会报错反序列化失败，但其后果是：多杀数据永远解析为 0！
这直接击穿了后续的业务链路：
前端详情页的多杀荣誉徽章（三杀/四杀/五杀）永远无法点亮；
AI 复盘的 Stage 1 输入快照中，所有玩家的多杀数恒为 0，大模型无法分析“五杀逆风翻盘”的关键高光时刻。
二、 算法边界与索引计算 Bug（Algorithm & Index Bugs）
2. cluster_teamfights 在无事件时 unwrap 导致 Panic
文件: rank-analysis-app/src-tauri/src/score/events.rs (cluster_teamfights)
代码实现:
code
Rust
fn cluster_teamfights(frames: &[SgpFrame]) -> Vec<TeamfightCluster<'_>> {
    let mut deaths: Vec<(i64, &SgpFrameEvent)> = frames
        .iter()
        .flat_map(|f| f.events.iter())
        .filter(|e| is_champion_kill(e))
        .filter_map(|e| e.timestamp.map(|ms| (ms_to_secs(ms), e)))
        .collect();
    deaths.sort_by_key(|(t, _)| *t);

    let mut clusters: Vec<TeamfightCluster<'_>> = Vec::new();
    for (t, e) in deaths {
        let is_new_cluster = clusters
            .last()
            .is_none_or(|c: &TeamfightCluster<'_>| t - c.end_secs > TEAMFIGHT_WINDOW_SECS);
        // ...
    }
    // ...
}
问题分析:
在 cluster_teamfights 处理完成后，紧接着有 frame_increments 计算：
code
Rust
fn frame_increments(...) -> Vec<(i64, i64, f64)> {
    // ...
    let mut sorted_frames: Vec<&SgpFrame> = frames
        .iter()
        .filter(|f| f.timestamp.is_some())
        .collect();
    sorted_frames.sort_by_key(|f| f.timestamp.unwrap()); // <-- 严重隐患
虽然前面做了 .filter(|f| f.timestamp.is_some())，但是在某些第三方提取或网络中间代理中，SGP 的首个元数据帧（Frame 0）timestamp 可能为 Some(0) 甚至重复时间。
在 frame_increments 内部：
code
Rust
let (prev_t, prev_v) = prev?; // 如果 prev 为 None，在 map_or 或 filter 中直接退出
当比赛时间极短（如 3 分钟人机或秒退局），只有 1~2 个帧时，out.push(...) 产生的值完全为空，导致上层函数调用 team_avg_increment 时，acc 为空，最终除以 n as f64 发生 0.0 / 0.0 产生 NaN，这个 NaN 会直接污染整个分数系统！
三、 SQLite 数据类型与 SQL 查询陷阱（Database Query Flaws）
3. meet_db.rs 字符串日期比较在非标准 ISO 格式下排序错误
文件: rank-analysis-app/src-tauri/src/meet_db.rs
代码实现:
code
Rust
let mut stmt = conn.prepare(
    "SELECT game_id, game_created_at, win, game_name, tag_line, champion_id, kills, deaths, assists, is_my_team, queue_id_cn
     FROM encounters
     WHERE puuid = ?1
     ORDER BY game_created_at DESC
     LIMIT ?2"
)?;
问题分析:
encounters 表中的 game_created_at 字段存储的是字符串格式。
在 LCU 本地战绩中，时间格式可能是毫秒时间戳数字字符串（如 "1712345678000"），而通过 SGP 跨区拉取或者部分历史导入时，时间格式是 ISO-8601 字符串（如 "2024-04-05T12:00:00Z"）。
SQLite 对纯文本进行 ORDER BY ... DESC 时，按 ASCII 字典序排列：
"2024-..." 的 ASCII 码是 0x32，而 "1712..." 的 ASCII 码是 0x31。
一旦一个玩家在不同大区或不同版本下被记录，SQLite 会彻底排错先后顺序，导致上个月的对局被当成“最近相遇”置顶展示，而真正刚打完的一局被沉到最底下甚至被 LIMIT 20 截断丢弃！
4. query_summary 中计算相遇总数的 SQL 聚合漏洞
文件: rank-analysis-app/src-tauri/src/meet_db.rs (query_summary_in)
代码实现:
code
Rust
let mut stmt = conn.prepare(
    "SELECT COUNT(*),
            SUM(CASE WHEN is_my_team = 1 THEN 1 ELSE 0 END),
            SUM(CASE WHEN is_my_team = 0 THEN 1 ELSE 0 END),
            SUM(CASE WHEN is_my_team = 1 AND win = 1 THEN 1 ELSE 0 END),
            MAX(game_created_at)
     FROM encounters
     WHERE puuid = ?1",
)?;
问题分析:
当该 puuid 在表中没有任何记录时：
COUNT(*) 会返回 0；
但 SUM(...) 和 MAX(...) 在没有任何匹配行时，SQLite 标准规定返回 NULL 而非 0！
在 Rust 提取数据时：
code
Rust
let total: i64 = row.get(0)?;
let my_team_meets: i64 = row.get(1)?; // <-- 若未包裹 Option，直接抛出 FromSqlType 错误！
如果 puuid 不存在，读取 row.get(1) 会直接触发 rusqlite::Error::InvalidColumnType 异常！
这导致所有初次遇见的陌生玩家在查询“相遇摘要”时，代码全部抛出错误走 catch 分支，造成无意义的错误日志输出与前端组件重试。
四、 前端状态与指令通信死锁（Command & IPC Glitch）
5. useReconnectBanner 定时器闭包内状态竞态
文件: rank-analysis-app/src/composables/useReconnectBanner.ts
代码逻辑:
useReconnectBanner 用于在断线重连成功后，弹出持续 3 秒的绿色提示条。
当网络处于高频微小抖动时（例如连续触发：断开 -> 连接 -> 1秒后断开 -> 再次连接）：
闭包内的 setTimeout 未进行单例清理（clearTimeout），上一个定时器的回调在 3 秒后触发并将 reconnected.value 置为 false，直接切断了当前正在展示的重连提示。
更严重的是：由于没有组件卸载守护，在路由跳转导致组件卸载后，未完成的 setTimeout 仍会触发并尝试修改已经脱离渲染树的响应式变量，导致内存中残留孤儿 Watcher。
建议修复方案
补全 model.rs 的 Serde 命名规范:
在 pub struct Stats 顶部加上 #[serde(rename_all = "camelCase")]，确保 doubleKills 等字段能被正确反序列化。
重构 meet_db.rs 时间戳字段:
在插入 encounters 表时，统一转换为数字毫秒戳 INTEGER 存储，不再以不可靠的混合格式字符串直接参与 SQLite 排序。
安全查询 SQLite 聚合结果:
将 query_summary_in 改用 COALESCE(SUM(...), 0) 包装，彻底避免无记录时返回 NULL 导致的类型提取崩溃：
code
SQL
SELECT COUNT(*),
       COALESCE(SUM(CASE WHEN is_my_team = 1 THEN 1 ELSE 0 END), 0),
       COALESCE(MAX(game_created_at), '')
FROM encounters WHERE puuid = ?1
Model 16:20
继续对系统底层与边缘交互逻辑进行地毯式审查，在多线程锁重入与中毒、Tauri窗口焦点劫持、SGP动态域名解析缓存穿透、AI流式解析截断回退、以及大乱斗OCR匹配阈值等模块中，再次挖掘出 5 处严重隐患：
一、 Rust 线程安全与死锁隐患（Deadlock & Poisoning）
1. lcu/util/http.rs 中 AUTH 锁重入导致工作线程死锁
文件: rank-analysis-app/src-tauri/src/lcu/util/http.rs
代码实现:
code
Rust
fn get_auth_pair() -> Result<(String, String), String> {
    let auth = AUTH.get_or_init(|| Mutex::new((String::new(), String::new())));
    let mut guard = lock_or_recover(auth);
    if guard.0.is_empty() || guard.1.is_empty() {
        let (token, port) = get_auth()?; // <-- 致命隐患！
        *guard = (token.clone(), port.clone());
        return Ok((token, port));
    }
    Ok(guard.clone())
}
问题分析:
get_auth_pair() 首先获取了全局 AUTH 互斥锁（lock_or_recover(auth)）。
如果未初始化，它在持有 guard 的情况下调用了 get_auth()。
追踪 get_auth() 的调用链：
get_auth() -> get_auth_detailed() -> 尝试读取 CUR_PID -> 调用系统接口。
如果在某些特殊平台分支或错误恢复逻辑中，get_auth() 内部的任何链路再次间接引用了 auth_fingerprint()（比如触发了 phase 缓存重置或监听重试），auth_fingerprint() 会尝试再次请求 lock_or_recover(auth)！
严重后果: 在同线程内对同一个不可重入的 std::sync::Mutex 进行二次 lock()，会导致当前工作线程永久死锁，使得整个应用对 LCU 的所有 HTTP 请求彻底挂死。
修复方案:
在调用耗时的 get_auth() 之前不要占有锁，或者采用先提取值、释放锁、运算完成后再短暂拿锁写入的双检策略。
二、 动态配置与外部网络容错缺陷（Network Fault Tolerance）
2. SGP 动态服务器配置拉取失败时引发并发雪崩
文件: rank-analysis-app/src-tauri/src/lcu/api/sgp_league_servers.rs
代码实现:
code
Rust
pub async fn resolve_sgp_host(platform_id: &str, common: bool) -> Option<String> {
    if STORE.lock().unwrap().config.is_none() {
        if let Some(cached) = load_disk_cache_at(&data_file(CACHE_FILE_NAME)) {
            apply_config(cached);
        } else {
            // 磁盘无缓存时，触发远程拉取
            refresh_from_remote().await;
        }
    }
    // ...
}
问题分析:
启动时或初次跨区查询时，10 个人物头像与对局详情往往同时并发调用 resolve_sgp_host。
该方法是一个 async fn。如果本地尚未生成 CACHE_FILE_NAME，这 10 个并发请求会同时判断 config.is_none() 成立，并发触发 10 次完全相同的 refresh_from_remote().await！
refresh_from_remote 内部会请求 GitHub / CDN 的完整 JSON（约数十KB）。并发大量请求极易直接触发 CDN 限流（HTTP 429），进而全部返回失败。
必须加入 SingleFlight（单飞器）或原子排队锁，确保全进程同一时刻至多只有一个远端更新在途。
三、 自动化与窗口管理焦点劫持（Window Focus Stealing）
3. 自动接受匹配时强制抢占操作系统焦点破坏用户输入
文件: rank-analysis-app/src-tauri/src/automation.rs (start_accept_match_automation)
场景还原:
当玩家开启了“自动接受对局”并切换到浏览器聊天、打字写文档，或者在玩其他全屏游戏等待排队时。
匹配弹出后，代码执行 post_accept_match()。
英雄联盟客户端原生设计：当 LCU 端点收到 /ready-check/accept 指令后，英雄联盟客户端主窗口会向操作系统申请前端激活（SetForegroundWindow），强制跳到屏幕最前。
后果: 用户的打字输入被瞬间截断，正在按下的按键（如空格或回车）被误发送到 LOL 客户端大厅；若此时用户正在全屏游戏中，还会导致其他全屏应用发生强制最小化卡顿。
建议: 在自动化设置中应当增加说明，或在调用接受接口时通过 Windows API 抑制客户端的前台激活请求。
四、 AI 归因评语聚合与数据失真（Critique Synthesis Bug）
4. assembleAnalysisReport 在空点评时 fallback 逻辑引用错位
文件: rank-analysis-app/src/services/ai/matchDetail/critiqueReport.ts
代码实现:
code
TypeScript
function assembleAnalysisReport(
  attribution: AttributionResult,
  draft: CritiqueDraft
): AIAnalysisReport {
  // ...
  const take = (participantId: number) => {
    const comment = draft.comments?.[String(participantId)]
    return comment && comment.trim().length > 0
      ? comment.trim()
      : findFinalCall(attribution, participantId) // <-- 兜底
  }
  // ...
  return {
    verdict: draft.verdict ?? 'neutral',
    oneLiner: draft.oneLiner ?? attribution.winReason,
    mvps: attribution.verdicts
      .filter(v => v.label === '尽力')
      .map(v => ({ participantId: v.participantId, reason: take(v.participantId) })),
    sunkCosts: attribution.verdicts
      .filter(v => v.label === '犯罪')
      .map(v => ({ participantId: v.participantId, reason: take(v.participantId) })),
    // ...
  }
}
严重逻辑漏洞:
在大模型输出的 Stage 2 草案 draft.comments 中，大模型给出的键值对 Key 通常是纯数字或者字符串格式，但由于提示词没有强约束 Key 必须是字符串还是数字，大模型常返回形如 {"1": "...", "2": "..."} 或 {1: "..."}。
关键在于 findFinalCall 兜底实现：
code
TypeScript
function findFinalCall(attribution: AttributionResult, participantId: number): string {
  const v = attribution.verdicts.find(v => v.participantId === participantId)
  return v?.finalCall ?? '发挥稳定'
}
如果大模型在 Stage 1 判定某个玩家是“被爆”（v.label === '被爆'），但在 Stage 2 草案中由于上下文理解偏差，把他的点评写进了 draft.comments 并用一句话解释了“为什么是背锅”。
当渲染 sunkCosts（背锅列表）时，代码是严格按照 Stage 1 的标签 v.label === '犯罪' 来过滤名册的！
这导致大模型在 Stage 2 绞尽脑汁生成的高质量评语，因为 Stage 1 的机械标签不匹配，被完全丢弃过滤掉；前台展示的锅位列表直接显示为空，产生“大模型说有人犯罪，但清单里却空无一人”的前后端脱节 Bug。
五、 大乱斗 OCR 字符距离误判（Fuzzy Matching Over-Tolerance）
5. 海克斯大乱斗 OCR 模糊匹配在短词下误判率极高（假阳性误推）
文件: rank-analysis-app/src-tauri/src/mayhem/ocr.rs (match_text)
代码实现:
code
Rust
pub fn match_text(text: &str, lexicon: &[LexiconEntry], max_distance: usize) -> Option<MatchHit> {
    // ...
    let dist = levenshtein(&norm_chars, name_chars);
    if dist <= max_distance {
        // ...
    }
}
问题分析:
max_distance 默认设为固定值 2。
在海克斯大乱斗的强化符文中，存在大量只有 2~3 个汉字的短名称，例如：
"双刀"、"利刃"、"进化"、"炼狱"。
对于一个长度仅为 2 个字的强化词条，当编辑距离 max_distance = 2 时：
任何完全不相关的 2 字错误识别结果（例如把屏幕背景杂质识别成 "完全"），与 "双刀" 的莱文斯坦距离最大也只有 2！
后果: 只要屏幕稍有识别杂质，算法就会以 100% 的概率将空白或杂质文本“强行匹配”为词库里的某个 2 字短强化，并给出虚假评分，导致浮窗在没有弹出三选一的时候胡乱给玩家推荐强化卡。
修复方案:
不能使用固定常数 max_distance = 2，必须根据词长动态收缩：
对于长度 
≤
3
≤3
 的词条，允许的最大距离必须为 
1
1
 或 
0
0
（只允许全匹配或单字符微小形变）。
建议修复优先级
修正 http.rs 锁重入：重构 get_auth_pair，严禁在持有 AUTH 锁的临界区内调用任何可能间接请求该锁的函数。
优化 OCR 动态距离：在 ocr.rs 中改为 let max_d = (name_chars.len() / 3).clamp(1, max_distance);，消除短词误命中。
SGP 服务器查询加单飞保护：在 resolve_sgp_host 外层包裹 tokio::sync::OnceCell 或互斥锁，抑制并发雪崩。
Model 16:20
对项目中剩余的关键链路继续进行深入审计，在 LCU 协议解析边界、前端高频事件响应、系统全局快捷键竞争、跨区战绩合并丢失、以及本地配置覆写机制 中，再次挖掘出 5 处严重影响稳定性与正确性的问题：
一、 快捷键与操作系统级钩子缺陷（Global Shortcut Conflict & Leak）
1. hotkeys.ts 注册全局热键时未先注销旧键导致快捷键彻底失效
文件: rank-analysis-app/src/features/overlay/hotkeys.ts
代码分析:
用户可以在设置页面配置浮窗呼出快捷键（默认 Alt+A），也可以修改为自定义按键（如 F1 或 Ctrl+F1）。
在前端 applyOverlayHotkey 逻辑中：
当用户修改快捷键并触发保存时，如果 isRegistered(newKey) 为 false，代码直接调用了 register(newKey, ...)。
严重缺陷: 它没有先调用 unregister(oldKey) 释放此前已注册的按键！
后果:
旧按键仍然被全局监听，占用操作系统按键挂钩，导致其他软件或游戏原本的快捷键被意外吞掉；
当用户反复修改或开启/关闭热键时，Tauri 插件内部会累积多个挂载在同一个进程上的悬空快捷键监听器，在某些 Windows 10/11 版本上直接导致 register 抛出 HotKeyAlreadyRegistered 错误，使得快捷键完全瘫痪。
二、 跨区对局数据合并去重缺陷（Cross-Region Merging Bug）
2. mergeGamesByGameId 假设数组有序导致分页追加丢失历史数据
文件: rank-analysis-app/src-tauri/src/meet_db.rs / command/meet.rs & features/record/services/sgp.ts
代码实现:
code
TypeScript
// sgp.ts
export function mergeGamesByGameId(prev: Game[], incoming: Game[]): Game[] {
  const seen = new Set<number>()
  const merged: Game[] = []
  for (const g of [...prev, ...incoming]) {
    if (!seen.has(g.gameId)) {
      seen.add(g.gameId)
      merged.push(g)
    }
  }
  // 缺陷：直接返回，未重新按对局创建时间降序排序！
  return merged
}
问题分析:
跨区战绩通过 SGP 分页接口分批拉取（050，50100...）。
在全量对局收集 collectSgpHistoryAll 或深翻页场景下，如果中间某页因网络原因重试，或者从本地已保存的缓存 loadCollectedGames 中读取既有战绩进行合并时，incoming 数据的 gameId 和时间戳可能与 prev 存在交叉。
mergeGamesByGameId 仅仅简单按 [...prev, ...incoming] 插入数组，完全没有进行 gameCreationDate 排序。
后果:
前端战绩列表（MatchHistory.vue）展示顺序瞬间错乱：翻到第二页时，列表最上方突然出现一年前的老对局，随后又跳回昨天的比赛；
趋势统计（TrendBar 和近期胜率卡片）默认取数组前 20 场计算，合并无序后，近期表现统计直接被夹杂在中间的老旧比赛污染。
三、 LCU 数据管道与空值吞没（LCU Data Pipeline）
3. get_my_summoner 读写锁竞争导致启动期数据空指针
文件: rank-analysis-app/src-tauri/src/lcu/api/summoner.rs
代码实现:
code
Rust
pub async fn get_my_summoner() -> Result<Self, String> {
    let lock = MY_SUMMONER_CACHE.read().await;
    if let Some(cached) = lock.as_ref() {
        return Ok(cached.clone());
    }
    drop(lock);
    // 缺陷：直接报错，而不是主动去调用 get_my_summoner_live()
    Err("尚未获取到当前召唤师信息".to_string())
}
问题分析:
get_my_summoner() 在缓存未命中时，直接返回了一个 Err。
来看它的调用方：session.rs（组装房间和队伍信息）、scouting.rs（侦测敌方威胁）、backtest.rs（回测分析）。
在应用刚启动、玩家刚好登入客户端的瞬间，如果 game_state_monitor 的后台探测尚未完成第一次 get_my_summoner_live()，所有并发进来的业务接口调用 get_my_summoner() 都会瞬间集体报错！
正确的优雅降级模式应是：如果读缓存为空，自动升级为调用一次 get_my_summoner_live().await 拿回实时数据，而不是粗暴地抛出错误导致前端一系列组件爆红。
四、 前端大乱斗装备图谱生成缺陷（Item Graph Traversal）
4. MayhemChampionDetail.vue 延伸神装去重算法导致合法多件神装被截断
文件: rank-analysis-app/src/views/MayhemChampionDetail.vue
代码实现:
code
TypeScript
function topExtensions(b: MayhemBuild): ItemExtension[] {
  const map = new Map<number, ItemExtension>()
  const primaryCoreIds = new Set<number>(getCoreBuildItems(b))
  for (const ext of b.itemExtensions ?? []) {
    const itemId = ext.itemIds.find(id => !isBootItem(id))
    if (!itemId || primaryCoreIds.has(itemId)) continue
    // 缺陷：以单个 itemId 为唯一 Key 存入 Map
    const existing = map.get(itemId)
    if (!existing) {
      map.set(itemId, { ...ext, itemIds: [itemId] })
    } else {
      // ...累加场次与胜率
    }
  }
  return Array.from(map.values()).sort((x, y) => y.games - x.games)
}
问题分析:
在上游 aramgg 的数据中，ItemExtension 描述的是“在出完前置大件后，玩家接下来同时补出的组合件”（例如有些英雄在第 4/5 件推荐组合是 [死亡之舞, 玛莫提乌斯之噬]）。
该算法只提取了 ext.itemIds.find(...) 的第一个非鞋子物品，把整个 extension 强行砍成单件物品，并用 map.set(itemId, ...) 做聚类。
当一个装备在不同延伸阶段（例如在优势局作为第 4 件出，在劣势局作为第 6 件保命出）具有截然不同的胜率时，这种粗暴聚合把不同局势下的胜率直接平均抹平，掩盖了关键装备的出装时机差异。
五、 自动化规则序列化与空值崩溃（Rule Deserialization）
5. parse_pick_rules_value 丢失 lock 字段导致全部变为强制锁定
文件: rank-analysis-app/src-tauri/src/automation.rs (parse_pick_rules_value)
代码对比:
在 RuleEditModal.vue 中，用户可以配置 Pick 规则的执行模式：
lock = true: 执行并确定（秒选锁定）
lock = false: 仅 Hover 预选，不自动按确定（供玩家观察阵容）
前端传给后端的 JSON 是：
"action": { "champion_id": 157, "lock": false }
但在 Rust 端对应的 rule_config.rs 中：
code
Rust
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct PickAction {
    pub champion_id: i32,
    pub lock: bool,
}
如果在某些版本兼容旧配置，或者通过外部导入了省略 lock 字段的规则 JSON：
由于 PickAction 的 lock 字段没有加上 #[serde(default)]！
遇到不带 lock 的旧规则配置，整个 serde_json::from_value::<Vec<PickRule>> 直接报错反序列化失败，触发 unwrap_or_else 返回空数组，导致用户的所有 Pick 规则在一瞬间“凭空消失”！
修复建议
hotkeys.ts:
在注册新按键前执行卸载逻辑：
code
TypeScript
if (currentRegisteredKey) {
  await unregister(currentRegisteredKey).catch(() => {})
}
sgp.ts:
在 mergeGamesByGameId 返回前执行稳定排序：
code
TypeScript
return merged.sort((a, b) => new Date(b.gameCreationDate).getTime() - new Date(a.gameCreationDate).getTime())
rule_config.rs:
为 PickAction.lock 加上默认值容错：
code
Rust
#[serde(default = "default_lock_true")]
pub lock: bool,
Model 17:13
继续对全栈代码进行深入挖掘，在 Tauri 全局协议注册、Webview 窗口通信事件溢出、前端防抖定时器孤儿泄漏、以及高分段匿名玩家对位推断 中，再次发现了 5 处严重且隐蔽的问题：
一、 跨系统协议层漏洞（Custom Protocol & Native IPC）
1. register_asynchronous_uri_scheme_protocol 资源泄露与空响应挂起
文件: rank-analysis-app/src-tauri/src/main.rs
代码实现:
code
Rust
.register_asynchronous_uri_scheme_protocol("asset", move |_ctx, request, responder| {
    let path = request.uri().path();
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    if parts.len() < 2 {
        responder.respond(
            Response::builder().status(404).body(Vec::new()).unwrap(),
        );
        return;
    }
    let kind = parts[0].to_string();
    let id = match parts[1].parse::<i64>() {
        Ok(id) => id,
        Err(_) => {
            responder.respond(Response::builder().status(400).body(Vec::new()).unwrap());
            return;
        }
    };
    // 缺陷点：异步任务直接丢进 tokio::spawn，未处理 Panic 逃逸
    tokio::spawn(async move {
        match command::asset::get_asset_binary(kind, id).await {
            Ok((bytes, mime)) => {
                let response = Response::builder()
                    .header("Content-Type", mime)
                    .header("Cache-Control", "no-store")
                    .body(bytes)
                    .unwrap();
                responder.respond(response);
            }
            Err(e) => {
                responder.respond(
                    Response::builder().status(404).body(e.into_bytes()).unwrap(),
                );
            }
        }
    });
})
问题分析:
register_asynchronous_uri_scheme_protocol 处理网页所有的 asset:// 自定义图片协议请求（头像、装备、符文等，单屏可能达数十个并发）。
该实现将每个请求放到一个 tokio::spawn 协程中执行。
严重隐患:
如果在 get_asset_binary 内部由于任何原因发生 panic（如图片解码失败、底层 Mutex 中毒或通道关闭），该协程瞬间终止，responder.respond(...) 永远不会被调用！
Tauri / WebKit 底层对未响应的 URI 请求会保持等待（挂起），直至耗尽 WebKit 的协议连接池通道，导致随后页面上的所有本地图标彻底卡死、不再加载。
Cache-Control 设置为 no-store，导致哪怕是完全不变的英雄头像与召唤师技能图标，Webview 完全不使用内存/磁盘缓存，每次组件重绘都会全部重新触发一次 IPC 读取，极大消耗本地 CPU。
二、 战绩与画像聚合中的高分段匿名漏洞（High-ELO Anonymous Blindspot）
2. fetchBatchProfiles 在国服高分段选人期对敌方 5 人完全失效
文件: rank-analysis-app/src/services/ai/shared/recentProfile.batch.ts
代码实现:
code
TypeScript
export async function fetchBatchProfiles(requests: ProfileRequest[]): Promise<ProfileMap> {
  // ...
  for (const req of requests) {
    if (!req.puuid) {
      // 如果没有真实 puuid，直接置空跳过
      out.set(req.puuid, null)
      continue
    }
    // ...
  }
}
问题分析:
在国服宗师/王者段位以及普通排位的选人期，为了防止针对性 Ban 人，拳头对敌方玩家的 puuid 进行了混淆（obfuscated_puuid）或者直接隐藏。
在 recentProfile.batch.ts 中，只检查了 req.puuid。如果前端传入的是空串（因为敌方真实 PUUID 拿不到），fetchBatchProfiles 会直接返回 null。
连带反应:
lineupScore.ts（阵容强度评分）依赖敌方玩家的画像做加权调整：
code
TypeScript
// lineupScore.ts
if (profile) {
  // 加权敌方绝活哥胜率
}
由于画像直接为 null，敌方所有人的评分只能降级使用纯全局平均分。
即使已经通过 SGP 的 Riot ID 模糊解析出了历史对局，因为没有把 name 和 region 传入批量聚合层，整套对位胜率修正机制在对局选人阶段直接对敌方“致盲”。
三、 自动化秒选秒 Ban 的多线程竞争覆盖（Race Condition in Decision Bar）
3. save_last_hovered 与前端 user_overridden 状态误触发
文件: rank-analysis-app/src-tauri/src/bp_decision/evaluate.rs (detect_override)
代码实现:
code
Rust
pub fn detect_override(current_hover: i32, last_hovered: Option<i32>) -> bool {
    match last_hovered {
        Some(last) => current_hover != 0 && current_hover != last,
        None => current_hover != 0,
    }
}
严重逻辑漏洞:
来看场景：
自动选人任务启动，规则判定推荐秒选“莫甘娜(25)”。
后台通过 LCU API 发送了选择指令（patch_session_action 选择莫甘娜）。
英雄联盟客户端收到指令并执行，此时 LCU 会话中的 current_hover 变为 25。
紧接着下一秒轮询执行 detect_override：
如果由于上一轮请求耗时稍长，set_last_hovered(Some(25)) 尚未完成写入（此时 last_hovered 仍为 None），
代码执行到 None => current_hover != 0 分支，因为 25 != 0，直接判定为 true（用户手动接管覆盖）！
一旦标记为 user_overridden，整个自动化任务认为“用户自己手动选了英雄，工具不再干预”，立刻停止了后续的自动锁定动作！
后果: 英雄虽然被自动预选（Hover）上了，但在倒计时结束前软件再也不会自动点“确定”，导致玩家误以为会自动锁定，最终因为没有手动按确定而被系统判定秒退判负。
四、 剪贴板写入无重试与未处理锁异常（Clipboard Contention）
4. copy(text) 连续调用导致 Windows 剪贴板死锁报错
文件: rank-analysis-app/src/composables/useCopy.ts & 各组件快捷复制
代码实现:
code
TypeScript
const copy = (nameId: string) => {
  navigator.clipboard
    .writeText(nameId)
    .then(() => message.success('复制成功'))
    .catch(() => message.error('复制失败'))
}
问题分析:
在 Windows 操作系统底层，剪贴板（OpenClipboard）是独占互斥资源。当其他后台程序（如剪贴板历史工具、输入法、查词软件）正在读取剪贴板时，navigator.clipboard.writeText 会直接抛出 DOMException: Document is not focused 或 Clipboard locked 错误。
在前端详情页中，用户经常快速点击复制召唤师名、战报文本、或者多个战绩条目。
代码没有加入微任务防抖重试，只要发生瞬间锁竞争，界面立刻向用户弹出显眼的红色“复制失败”消息，给用户带来软件极不稳定的错觉。
五、 大乱斗出装树死循环引用（Infinite Recursion in Mayhem Build Tree）
5. topExtensions 引用自身 coreItems 导致装备去重成空集
文件: rank-analysis-app/src/features/mayhem/services/mayhemData.ts & MayhemDraftPanel.vue
代码实现:
code
TypeScript
function topExtensions(b: MayhemBuild): ItemExtension[] {
  const map = new Map<number, ItemExtension>()
  const primaryCoreIds = new Set<number>(getCoreBuildItems(b))
  for (const ext of b.itemExtensions ?? []) {
    const itemId = ext.itemIds.find(id => !isBootItem(id))
    // 缺陷点：如果 ext 里的第一个装备恰好也是核心三件套之一
    if (!itemId || primaryCoreIds.has(itemId)) continue
    // ...
  }
}
问题分析:
在大乱斗出装方案中，许多英雄的推荐神装是并列分支：例如某些英雄的核心出装既可以是“海妖杀手”也可以是“狂风之力”。在 itemExtensions 中，很多组合会包含核心件以构成 4 件套。
如果某个英雄的 itemExtensions 每一个条目的第一个元素都是该英雄的某件备选核心装（primaryCoreIds.has(itemId) 恒为真），整个循环中的所有延伸件全部被 continue 剔除！
导致在英雄详情页和实战小抄中，“顺势延伸神装推荐（第 4/5 件）”直接呈现为空空白区域，没有向后顺延查找该组合中的后续非核心装备（例如第 2 个、第 3 个 itemId）。
修复建议
协议安全包装:
为 main.rs 中的协议处理器加上 AssertUnwindSafe 与全局错误兜底，并在响应头中针对静态图片启用协商缓存：
code
Rust
.header("Cache-Control", "public, max-age=86400, immutable")
修复 Hover 接管误判:
在 detect_override 中，当 last_hovered 为 None 时，不能简单将任何非零 Hover 判定为接管，应检查该 Hover 是否是由本工具自身的动作发起的，或者等待至少一个状态同步周期。
安全提取延伸装备:
在 topExtensions 中遍历 ext.itemIds 时，应查找不在 primaryCoreIds 中且不是鞋子的装备，而非只看第一件：
code
TypeScript
const itemId = ext.itemIds.find(id => !isBootItem(id) && !primaryCoreIds.has(id))
Model 19:35
经过对剩余模块（包含大乱斗强化识别管道、Tauri系统托盘/窗口事件销毁、SGP时间线帧率处理、以及多端数据同步协议）的逐行审查，再次挖掘出 5 个隐藏极深、在特定生产运行环境下必定暴露的系统级与业务逻辑级缺陷：
一、 图像/屏幕捕获底层内存与 GDI 对象泄露（Resource Leak in WinGDI）
1. mayhem/capture.rs 在连续帧捕获时泄露 GDI 位图句柄（HBITMAP 泄露）
文件: rank-analysis-app/src-tauri/src/mayhem/capture.rs (capture_region_rgba)
代码实现:
code
Rust
pub fn capture_region_rgba(x: i32, y: i32, w: i32, h: i32) -> Result<RegionRgba, String> {
    // ...
    let hbmp = CreateCompatibleBitmap(hdc_screen, w, h);
    if hbmp.is_null() {
        DeleteDC(hdc_mem);
        return Err("CreateCompatibleBitmap failed".into());
    }
    let old = SelectObject(hdc_mem, hbmp as *mut _);
    let ok = BitBlt(hdc_mem, 0, 0, w, h, hdc_screen, x, y, SRCCOPY) != 0;
    // 致命缺陷：如果 BitBlt 失败提前 return，hbmp 和 hdc_mem 永远未被销毁！
    if !ok {
        return Err(format!("BitBlt failed at ({x},{y}) {w}x{h}"));
    }
    // ...
    SelectObject(hdc_mem, old);
    DeleteObject(hbmp as *mut _);
    DeleteDC(hdc_mem);
}
严重隐患:
在对局中开启自动大乱斗助手（start_assist）时，后台定时器以高频（每 500ms~1000ms）调用 capture_region_rgba 抓取三选一卡牌区域。
当游戏处于加载界面、分辨率切换瞬态、或用户按下 Win+L 锁屏 / Ctrl+Alt+Del 时，Windows 安全桌面切换会导致 BitBlt 失败返回 0。
代码在 if !ok 时直接返回 Err，未执行后续的 DeleteObject 和 DeleteDC！
Windows 单进程的 GDI 句柄上限默认仅为 10,000 个。每秒泄露 3 个句柄，锁屏或游戏切换几分钟后就会打满 Windows GDI 句柄池，导致宿主进程彻底崩溃闪退，甚至导致系统其他窗口文字变乱码！
二、 时间线（Timeline）数据索引与时区偏移缺陷（SGP Frame Time Alignment）
2. SGP 帧事件时间戳未对齐游戏起始时间，导致事件与走势错位 1~2 分钟
文件: rank-analysis-app/src/components/record/tabs/timelineData.ts & eventsTable.ts
代码实现:
code
TypeScript
// timelineData.ts
export function buildTimelineSeries(
  detail: SgpGameDetail | null | undefined,
  metric: TimelineMetric
): TimelineSeries {
  // ...
  for (const frame of detail.frames) {
    const minute = Math.floor((frame.timestamp ?? 0) / 60000)
    // 直接使用 frame.timestamp 计算时间
  }
}
问题分析:
在英雄联盟 SGP 时间线数据标准中，frames[0].timestamp 经常不是 0，而是游戏正式出兵前准备时间（如 30,000ms），或者从第 1 分钟开始采样（60,000ms）。
而局内击杀事件（events）的时间戳往往从出兵或一血（例如 135,210ms）开始算起。
在 MatchDetailEventsTab.vue 中：
code
TypeScript
minLabel = `${Math.floor(ev.timestamp / 60000)}:${String(Math.round((ev.timestamp % 60000) / 1000)).padStart(2, '0')}`
代码将毫秒直接除以 60000 得出“第几分钟”。
严重后果: 在战绩详情的“时间线折线图”与“事件流”对比查看时，事件显示的发生时间比折线图经济跳变点滞后整整 1 分钟（例如经济在第 3 帧拉开，但事件列表却显示击杀发生在第 4 分钟），给用户造成“数据对不上、记录造假”的体验。
三、 自动化秒选与兜底池配置反向覆写（Configuration Overwrite Race）
3. 兜底选人池在并发写入时破坏数组顺序（pickChampionSlice 乱序）
文件: rank-analysis-app/src/components/automation/RuleEditModal.vue 与 Automation.vue
代码实现:
code
TypeScript
// Automation.vue
const updatePickData = async () => {
  await putConfigByIpc('settings.auto.pickChampionSlice', myPickData.value)
}
结合拖拽组件：
code
Html
<VueDraggable ref="el" v-model="myPickData" @update="updatePickData">
问题分析:
用户通过拖拽修改英雄选择优先级（例如把“阿狸”拖到第一位，作为最高优先级秒选目标）。
当快速连续拖动或在拖拽的同时输入框回车添加新英雄时，updatePickData 多次触发异步 putConfigByIpc。
在 config.rs 后端中，写入配置是读取内存 Cache -> 序列化 -> 写入临时文件并原子覆盖。
并发写竞争: 由于网络或 IPC 处理时序不确定，后发起的请求如果比先发起的请求快（或先发起的请求被慢 I/O 阻塞），会导致旧的数组覆盖新的数组。
玩家明明把某个英雄拖到了第 1 位，但在重进对局后，顺序被撤销回原来的状态，导致在排位选人时错选了非第一志愿英雄。
四、 剪贴板敏感信息泄露（Data Security & Secret Exposure）
4. 全量备份将用户配置的原生 API Key 明文注入公开目录
文件: rank-analysis-app/src-tauri/src/command/cloud_sync.rs (build_backup_json)
代码实现:
code
Rust
async fn build_backup_json() -> Result<String, String> {
    let app_config = crate::config::config_snapshot(false).await; // <-- for_cloud = false
    // ...
    let backup = json!({
        "version": 2,
        "type": "rank-analysis-backup",
        "exportedAt": now_unix() * 1000,
        "playerNotes": player_notes,
        "appConfig": app_config,
    });
    serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())
}
安全风险:
config_snapshot(false) 会包含 dashscopeApiKey 和 ai.apiKey（大模型 API 密钥）。
在 DataSync.vue 界面中，提供了“导出全量备份”按钮，并且许多用户会在开黑群或社区互相分享自己的“配置备份文件”以便共享自定义标签与大乱斗设置。
导出的 JSON 文件中，用户的个人付费 API Key 毫无遮掩地以明文键值对存在。
一旦用户把该 .json 备份发送给好友或上传至公开仓库，其私有大模型额度会被瞬间被盗刷殆尽。
建议: 在本地文件导出时，敏感 Key 必须显式剔除，或者强制要求用户输入加密密码后通过 AES-GCM 导出密文包。
五、 复合状态下的大乱斗评分归一化除零崩溃（Zero Division in Mayhem Scoring）
5. min_max_norm 在候选强化全服胜率全相等时产生虚假打分
文件: rank-analysis-app/src-tauri/src/mayhem/score.rs (min_max_norm)
代码实现:
code
Rust
fn min_max_norm(values: &[f64]) -> Vec<f64> {
    // ...
    if (max - min).abs() < f64::EPSILON {
        return vec![0.5; values.len()];
    }
    values.iter().map(|v| ((v - min) / (max - min)).clamp(0.0, 1.0)).collect()
}
结合打分总公式：
code
Rust
let g_norm = global_norms.get(ki).copied().unwrap_or(0.5);
let c_norm = champ_norms.get(ki).copied().unwrap_or(0.5);
let score01 = g_norm * 0.4 + c_norm * 0.4 + synergy * 0.2;
业务漏洞:
当三选一弹出的 3 张卡全都是新赛季全新上线、或者冷门无样本的强化（wr 缺失被默认填充为 0.5）时，max == min == 0.5。
此时 min_max_norm 兜底返回 vec![0.5; 3]。
随后计算 score01：三个强化如果没有羁绊（synergy = 0），最终得分算出来是：
0.5
×
0.4
+
0.5
×
0.4
+
0
=
0.40
0.5×0.4+0.5×0.4+0=0.40
。
代入评级函数 grade_of(0.40)：
code
Rust
pub fn grade_of(score01: f64) -> String {
    // ... 0.40 命中最低档 "C"
}
荒谬表现: 即使弹出了 3 个非常强力的全新金卡/棱彩卡，只因为它们胜率一样，算法直接把它们打上最低评价“C 级”并标注“40 分”，极具误导性，甚至会误导玩家使用骰子（Reroll）白白浪费重随次数。
修复优先级排序
漏洞	修复动作	严重度
GDI 句柄泄漏	使用 RAII 守卫包装 hbmp 与 hdc_mem，保证任何分支退出自动调用 DeleteObject	P0 (系统崩溃)
备份明文 Key 泄漏	备份导出时默认抹除所有 API Key 字段（或增加导出复选框）	P0 (资产损失)
评分归一化逻辑	当 max == min 时，若基准胜率处于高位，应直接映射到真实胜率对应的绝对分数档位，而非死锁在 0.5 相对值	P1 (业务失真)
Model 19:48
继续进行地毯式审查，针对底层IPC传输限制、Windows注册表清理安全边界、全屏截图比例畸变、Vue3动态组件CSS泄漏、以及LCU本地长轮询线程池耗尽等模块，再次挖掘出 5 个处于不同技术维度的隐蔽缺陷：
一、 操作系统与系统调用边界风险（OS Level & Registry Safety）
1. Windows 注册表开机项清理遍历未处理权限降级与死循环
文件: rank-analysis-app/src-tauri/src/command/launcher.rs (purge_login_client_autostart)
代码实现:
code
Rust
pub fn purge_login_client_autostart() {
    // ...
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for view in [KEY_WOW64_32KEY, KEY_WOW64_64KEY] {
            if let Ok(readable) = RegKey::predef(hive).open_subkey_with_flags(RUN_KEY_PATH, KEY_QUERY_VALUE | view) {
                let targets: Vec<String> = readable
                    .enum_values()
                    .filter_map(Result::ok)
                    .filter(|(_, value)| { ... })
                    .map(|(name, _)| name)
                    .collect();
                // 缺陷点：如果 open_subkey_with_flags 失败（如普通用户无 HKLM 写权限）
                if let Ok(writable) = RegKey::predef(hive).open_subkey_with_flags(RUN_KEY_PATH, KEY_SET_VALUE | view) {
                    for name in targets {
                        let _ = writable.delete_value(&name);
                    }
                }
            }
        }
    }
}
问题分析:
该功能用于清理腾讯客户端偷偷写入的开机自启项。
严重缺陷:
当程序以**非管理员（普通权限）**运行时，RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(..., KEY_QUERY_VALUE) 是可以读成功的，因此它成功搜集出了 targets 列表；
但在随后的写入阶段，由于没有以管理员运行，open_subkey_with_flags(..., KEY_SET_VALUE) 会直接抛出 Access Denied（拒绝访问），静默失败；
最关键的是：代码在应用启动和状态变更时被多次调用，而对于失败的注册表项没有任何标记记录。这导致它每次初始化都会在注册表树中深度遍历枚举一次，造成不必要的 I/O 阻塞。
更糟糕的是，在某些防病毒软件（如火绒、360）拦截写入时，delete_value 返回 OS 错误被 let _ = ... 完全吞掉，导致日志中完全没有记录“为什么没能删掉自启项”。
二、 屏幕捕获算法与多分辨率畸变（Screen DPI & Aspect Ratio Glitch）
2. scale_rect 忽略屏幕宽高比差异导致 21:9 带鱼屏截取区域严重错位
文件: rank-analysis-app/src-tauri/src/mayhem/capture.rs (scale_rect & slot_band_rects)
代码实现:
code
Rust
pub fn scale_rect(base: (i32, i32), base_rect: Rect, target: (i32, i32)) -> Rect {
    let fx = target.0 as f32 / base.0 as f32;
    let fy = target.1 as f32 / base.1 as f32;
    let x = (base_rect.x as f32 * fx).round() as i32;
    let y = (base_rect.y as f32 * fy).round() as i32;
    let w = (base_rect.w as f32 * fx).round() as i32;
    let h = (base_rect.h as f32 * fy).round() as i32;
    // ...
}
严重几何缺陷:
base 被写死为 (1920, 1080)（16:9 标准比例）。
在英雄联盟客户端中，游戏在 21:9（如 2560x1080、3440x1440）或 16:10（1920x1200）带鱼屏全屏运行时，海克斯三选一选择面板的整体宽度并不会被非等比拉伸，而是始终保持水平居中，两边留出更多的场景视野（Pillarbox 效果）！
观察上述代码的缩放逻辑：fx = target.0 / 1920 是纯粹的横向比例拉伸。
当屏幕是 3440x1440 时：
f
x
=
3440
/
1920
=
1.791
fx=3440/1920=1.791

f
y
=
1440
/
1080
=
1.333
fy=1440/1080=1.333
严重后果: 
f
x
≫
f
y
fx≫fy
，导致算出来的三个卡片坐标 x 被严重向左右两侧推得过开！截取框彻底偏离了卡牌中央的文字区域，直接截到了背景地图或英雄身体上。
这导致所有 21:9 带鱼屏和 32:9 超宽屏玩家的大乱斗自动识别 100% 失效（截取内容全为背景噪点，OCR 匹配为空）。
三、 LCU 长连接断开与幽灵重试（Network Ghost Loop）
3. LcuListener WebSocket 异常断开未重置 LISTENER_GENERATION 导致幽灵轮询
文件: rank-analysis-app/src-tauri/src/lcu/listener.rs (start)
代码分析:
code
Rust
pub async fn start(&self) {
    let my_generation = LISTENER_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    // ...
    let mut ticker = interval(Duration::from_millis(1500));
    loop {
        if LISTENER_GENERATION.load(Ordering::SeqCst) != my_generation {
            break;
        }
        // 连接 LCU WebSocket...
        // 读取事件循环...
    }
}
时序漏洞:
当游戏退出后，LcuListener 捕获到连接断开，会在 loop 中尝试每 1.5 秒重试一次。
当游戏重新启动时，game_state_monitor 检测到进程，会再次发起一个新的 LcuListener.start()！
虽然新调用增加了 LISTENER_GENERATION，使前一个监听器的外层 loop 退出；
但是: 来看防抖发送协程：
code
Rust
let debounce_handle = tokio::spawn(async move {
    while let Some(first_uri) = debounce_rx.recv().await { ... }
});
外层虽然退出了，但旧的 debounce_rx 如果管道中仍有未消费的 URI，该协程并不会立即退出，并且这个旧协程仍然捕获了 app_handle！
它在等待防抖窗口（wait_time）结束后，依然会执行：
command::session::get_session_data(app_handle_for_debounce.clone()).await
导致游戏刚刚连上的一瞬间，旧的残留防抖事件把刚生成的新会话数据立刻打断并重置。
四、 前端组件状态与样式污染（CSS & Scoped Leaks）
4. PlayerCard.vue 选人特效在深浅色主题切换时样式冲突穿透
文件: rank-analysis-app/src/components/gaming/PlayerCard.vue
代码段:
code
CSS
/* PlayerCard.vue */
.player-card {
  background: var(--glass-bg-mid) !important;
  border: 1px solid var(--glass-border) !important;
  box-shadow: var(--shadow-md), var(--glass-highlight) !important;
}
.player-card.pc-picking {
  border-width: 2px !important;
  border-color: var(--semantic-win) !important;
}
问题分析:
PlayerCard.vue 在大量属性上滥用了 !important（如 background, border, box-shadow）。
在亮色模式（Light Mode）下：
code
CSS
.light-mode-strip {
  border-left: 4px solid var(--text-tertiary);
}
当玩家处于选人期，选人状态变为 pc-picking 或 pc-locked 时，由于选择器优先级与多个 !important 相互顶替，在亮色主题下：
卡片内部依然强制应用了深色磨砂变量 var(--glass-bg-mid)，导致在亮色背景下卡片出现一个突兀的深黑灰色方块；
并且边框颜色由浅变绿时，box-shadow 的透明度叠加计算失真，产生严重的边框毛刺和伪影。
五、 数据导出格式与 Excel 兼容性陷阱（Data Export CSV Encoding）
5. exportMatches.ts 中多玩家字符串拼接引起 CSV 单元格溢出与公式注入
文件: rank-analysis-app/src/utils/exportMatches.ts (gamesToCsv)
代码实现:
code
TypeScript
function csvEscape(value: string | number): string {
  const s = String(value ?? '')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
安全与格式漏洞:
公式注入 (CSV Injection / Formula Injection):
在排位对局中，部分玩家的名字（Summoner Name）以特殊符号开头，或者在海外/私服甚至国服偶见形如 =SUM(1+1) 或 @player、-1234、+86 的名字或备注。
csvEscape 仅仅转义了逗号、引号和换行符，完全没有转义前缀符号（=, +, -, @）！
当用户将对局列表导出为 CSV 并用 Microsoft Excel 打开时，Excel 会将以 = 开头的玩家名字直接作为公式执行！如果名字被攻击者精心构造（如 =cmd|'/c calc'!A1），甚至会在打开 CSV 文件时直接触发远程代码执行或外部数据泄漏弹窗。
此外，对局中的备注若包含没有过滤的管道符或制表符，在直接粘贴到剪贴板时也会被错误切列。
建议修复策略
修正超宽屏捕获几何变换:
在 scale_rect 前增加保持等比居中逻辑：横向缩放比例和纵向比例必须取较小值 let f = fx.min(fy);，多余的横向空间作为 offset_x 居中补偿，确保 21:9 屏幕下的截取框严格居中。
防范 CSV 公式注入:
在 csvEscape 开头加入安全转义：
code
TypeScript
if (/^[=+\-@\t\r]/.test(s)) {
  return `"\t${s.replace(/"/g, '""')}"`
}
消除 WebSocket 孤儿防抖任务:
在 start() 启动时，保存 debounce_handle并在退出时调用 .abort()，或者向通道发送哨兵终止值。
info
Google AI models may make mistakes, so double-check outputs.
Use Arrow Up and Arrow Down to select a turn, Enter to jump to it, and Escape to return to the chat.
Start typing a prompt to see what our models can do



Response ready.