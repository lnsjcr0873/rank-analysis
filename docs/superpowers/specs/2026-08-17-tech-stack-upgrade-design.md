# 技术栈升级 P0–P2 — 执行计划

> 计划版本 v1.0 · 2026-08-17 · 调研依据:代码全量通读(339 前端文件/55k 行 + 78 Rust 文件/24k 行)+ npm registry 2026-08-17 实时版本
>
> **本文档是本次升级的唯一权威参考。** 任务卡 T1–T19 按序自包含,可直接作为 `/goal` 命令参数交由 harness 自动执行:
>
> ```
> /goal docs/superpowers/specs/2026-08-17-tech-stack-upgrade-design.md
> ```
>
> 门禁关联:本地 TS 门禁 + Rust 由 push 后 CI(win+mac 双矩阵 rustfmt/clippy/test)兜底(见 §1)

## 目录

1. [执行环境与全局规则(必读)](#1-执行环境与全局规则必读)
2. [目标与非目标](#2-目标与非目标)
3. [全局停止条件(自动执行硬约束)](#3-全局停止条件)
4. [任务卡 T1–T5(P0:低风险高收益)](#4-任务卡-p0)
5. [任务卡 T6–T10(P1:大版本跳)](#5-任务卡-p1)
6. [任务卡 T11–T19(P2:结构性升级)](#6-任务卡-p2)
7. [Backlog(本期不做)](#7-backlog)
8. [风险与回退](#8-风险与回退)
9. [附录:2026-08-17 实测版本对照](#9-附录)
10. [变更记录](#10-变更记录)

---

## 1. 执行环境与全局规则(必读)

### 1.1 环境

| 项 | 值 |
|---|---|
| 工作副本 | `D:\qwen-3.8-27b\ra-qwen3.8-27b`(rank-analysis 的 clone;若 harness 在既有工作区 `D:\lolzhushou\rank-analysis` 执行,先 `git fetch && git checkout qwen-3.8-27b`) |
| 工作分支 | `qwen-3.8-27b`(基于 main `82dca22`,当前 HEAD `ed8bb7b`,已含 `ci: cargo-audit 预编译二进制` 提交) |
| 远端 | 本 clone 的 `origin` = fork `lnsjcr0873/rank-analysis`,**可直接 push**;若远端 origin 是只读 upstream `wnzzer/rank-analysis`,则一律 `git push fork qwen-3.8-27b` |
| 前端工作目录 | `rank-analysis-app/` |
| 本机工具链 | Node 22.14 / npm 10.9 可用;**无 cargo/rustc** —— Rust 改动一律 push 后由 CI 验证 |
| 代码检索 | **一律 `codegraph`**(仓库规则,不要 grep):`codegraph status`(无索引先 `codegraph init`)、`codegraph explore <符号>`、`codegraph files --filter <目录>`、`codegraph callers <符号>`;仅当索引缺符号才退回 grep |

### 1.2 门禁(每张卡完成前必须全绿)

```bash
# 本地 TS 门禁(= npm run check 的 TS 部分;本机无 cargo,check:rust 跳过)
cd rank-analysis-app
npm ci            # 依赖卡之后首次/lockfile 变化时
npm run format
npm run lint
npm run typecheck
npm run test:coverage   # vitest 全量 + 覆盖率阈值(lines 15/functions 45/branches 73/statements 15)
```

- Rust 卡的"门禁"= push 后 CI(`gh run watch`)四个 job(win rust/mac rust/frontend/security)全绿。
- **Rust 卡串行门控**:T5/T11/T15/T16 等涉及 Rust 的卡,commit+push 后必须等 CI 全绿才能开始下一张 Rust 卡。
- CI 已知噪声:`Sync to GitCode` 因凭据失败是常态,与质量无关,不算红。

### 1.3 全局规则

1. **一卡一 commit**,commit message 用 Conventional Commits + 中文描述(仓库既有风格);commit 后立即 push。
2. diff 范围 = 任务卡"变更清单"所列文件;**出现清单外文件改动时先判断是否误改,是则还原**;确属必要联动的(如 lockfile、类型联改)允许,但须在 commit message 中列明。
3. 版本号升级一律用 `npm install <pkg>@<ver>` / 编辑 Cargo.toml 后 `cargo update -p <crate>`(或 CI 验证),**禁止手抄版本号到 lockfile**。
4. 新出现的 lint/type 错误:做**最小侵入修复**(代码适配新规则);**禁止批量 `eslint-disable` / `// @ts-ignore` 压制**(单点可加注释说明原因)。
5. 涉及 API 替换的改动,替换前必须 `codegraph explore <旧符号>` 确认全部调用点并列入变更清单。
6. 行为不变原则:P0/P1 全部是基础设施升级,**不得改变任何 UI 行为、业务逻辑、IPC 契约**(错误消息文案变化也视为契约变化,需列明)。
7. 不触碰:`.github/workflows/` 质量门禁配置、`release.yml` 发版链路、LCU 协议层(`lcu/api/model.rs` 之外的端点逻辑)。
8. 每张卡完成后,按模板更新本文件"变更记录"(卡名 + commit sha + 结果)。

### 1.4 任务卡标准格式

每张卡含:目标 / 前置 / 变更清单 / 验证 / 验收标准 / 失败处理 / commit。卡内"验证"全部通过 + "验收标准"全部勾选才算 Done。

---

## 2. 目标与非目标

### 目标

- **P0**:补齐 EOL/过期依赖与配置安全项,消除"下次升级更痛"的基础债务(§4)
- **P1**:构建与测试地基升级 Vite/Vitest/Pinia/vue-router/markdown-it(§5)
- **P2**:结构性收敛——错误体系、IPC 注册表、配置 store、巨型文件拆分、重复模式数据化(§6)

### 非目标

- ✗ 不改业务逻辑、UI 行为、LCU 协议解析
- ✗ 不升级 TypeScript 7(原生编译器,生态兼容性待观察,见 Backlog)
- ✗ 不跑全量 `cargo update`(rusqlite/sentry/tokio-tungstenite/mlua/moka 等逐个升级列入 Backlog)
- ✗ 不删 `quality-checks.yml` 的 macOS 矩阵(仓库注释明确:cfg(target_os) 分叉必须双平台编译,曾漏检 launcher.rs)
- ✗ 不做 meet_db 连接池化(见 Backlog)
- ✗ 不动本计划文件自身格式(仅"变更记录"区追加)

---

## 3. 全局停止条件

自动执行时出现以下任一情况,**立即停止并输出报告(当前卡名/失败命令/输出摘要/建议),不得绕过或降级继续**:

1. 同一命令修复 **2 轮**后仍红。
2. `npm run test:coverage` 失败测试数 **> 0 且修复不了**(不允许删测试/改断言迁就实现)。
3. 覆盖率阈值跌破(lines 15/functions 45/branches 73/statements 15)。
4. Rust CI 红且 2 轮修不好 —— 执行 `git revert <sha> --no-edit && git push`,该卡标记 Blocked,继续后续不依赖它的卡。
5. diff 中出现非预期的大面积格式/依赖波动(>20 个文件非本次变更的 diff)。
6. 卡内标注"需人工复核"的项:完成代码与测试后**停下来等复核**,不得自行视为 Done。
7. 网络/registry 不可用:等待重试 3 次后停止。

---

## 4. 任务卡 P0

### T1 前端依赖补丁/minor 对齐 + naive-ui 归类修复

- **目标**:对齐 Tauri npm 包/prettier/@types/node 到最新 patch/minor;把误放 devDependencies 的 naive-ui 移回 dependencies。
- **前置**:无(首卡)。
- **变更清单**(`rank-analysis-app/package.json` + `package-lock.json`):
  - `@tauri-apps/api` `^2.10.0` → `^2.11.1`
  - `@tauri-apps/plugin-dialog` `^2.7.1` → `^2.7.2`
  - `@tauri-apps/plugin-http` `^2.4.4` → `^2.5.9`
  - `@tauri-apps/plugin-opener` `^2` → `^2.5.4`
  - `@tauri-apps/plugin-updater` `^2.10.0` → `^2.10.1`
  - devDeps:`@tauri-apps/cli` `^2.10.0` → `^2.11.4`;`prettier` `^3.2.5` → `^3.9.6`;`@types/node` `^20` → `^22`(CI 用 node 22)
  - `naive-ui` `^2.37.3`(现 devDependencies)→ 移入 dependencies 并升级 `^2.45.0`
  - 执行:`npm install` 刷 lockfile;`npm run format`(prettier 3.9 若有新格式,自动落盘)
- **验证**:`npm run format && npm run lint && npm run typecheck && npm run test:coverage` 全绿。
- **验收**:
  - [ ] 除 format 自动格式化外,源代码零行为 diff
  - [ ] `npm ls naive-ui` 显示在 dependencies
  - [ ] 全部 spec 通过
- **失败处理**:install 冲突 → 逐包 `npm install <pkg>@<ver>` 缩小范围;prettier 格式 diff 爆炸(>30 文件)→ 停止上报(说明格式基线漂移)。
- **commit**:`chore(deps): 前端依赖对齐 patch/minor——tauri npm 包、prettier 3.9、@types/node 22、naive-ui 移回 dependencies`

### T2 ESLint 8 → 10(flat config 迁移)

- **目标**:ESLint 升到 10,完成 flat config 迁移(8.x 已 EOL)。
- **前置**:T1。
- **变更清单**:
  - `package.json` devDeps:`eslint ^10`、`eslint-plugin-vue ^10`、`@vue/eslint-config-typescript ^14`、`@vue/eslint-config-prettier ^10`;`@rushstack/eslint-patch` 若新配置用不到则删除(flat 下通常不需要)
  - `scripts.lint`:`eslint . --ext .js,.jsx,.cjs,.mjs,.ts,.tsx,.cts,.mts,.vue --fix` → `eslint . --fix`(flat config 不支持 --ext)
  - 新建 `rank-analysis-app/eslint.config.js`(flat):沿用 `@vue/eslint-config-typescript` 的 flat 预设 + `@vue/eslint-config-prettier` + 仓库现行规则(先读现有 `.eslintrc.cjs` 逐条对照迁移,新增规则集与旧版对齐)
  - 删除 `.eslintrc.cjs`
  - 按新规则修复产生的 error(最小侵入,见全局规则 4)
- **验证**:`npm run lint` 0 errors(warnings 允许,与现状一致);`npm run typecheck`、`npm run test:coverage` 绿。
- **验收**:
  - [ ] 功能代码改动仅限"新规则强制修复",并逐条写入 commit message
  - [ ] 无新增 `eslint-disable`(单点注释除外)
  - [ ] 新规则 error 总数未超过旧配置基线 20 个(超过即判定配置迁移走样,停止上报)
- **失败处理**:平迁后发现漏掉的旧规则 → 补进 flat config;插件 flat 预设缺失 → 手动组装 `vue.configs[...]/flat`。
- **commit**:`chore(lint): ESLint 8 → 10 flat config 迁移`

### T3 tauri.conf.json 安全加固(withGlobalTauri + CSP)

- **目标**:关闭全局 Tauri API 暴露;补上缺失的 CSP。
- **前置**:T2。
- **变更清单**(`rank-analysis-app/src-tauri/tauri.conf.json`):
  - `app.withGlobalTauri`: `true` → `false`(前置确认:`codegraph explore withGlobalTauri` 全仓无 `window.__TAURI__` 使用;现有代码只走 `@tauri-apps/api`)
  - `security.csp`: `null` →
    ```
    default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' http://asset.localhost data:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'
    ```
    (资产域名依据 `services/http.ts:10` 的 `assetPrefix = http://asset.localhost` + `get_asset_prefix` IPC;若 T3 执行时该值有变,以 codegraph 实查为准)
- **验证**:本地 `npm run build`(vue-tsc + vite build 成功);push 后 CI 绿。
- **验收**:
  - [ ] 构建与 CI 全绿
  - [ ] **【需人工复核】**:真机启动 app,确认:窗口渲染正常、英雄/段位/装备图标正常加载、AI 流式分析正常、updater 检查正常;任一异常 → 逐项放宽 CSP 对应 directive 并记录
- **失败处理**:CSP 导致资源被拦(控制台可见 blocked 记录)→ 放宽到实际需要的最小 scope;`withGlobalTauri=false` 导致运行时引用报错 → 还原该项并单独排查引用点。
- **commit**:`chore(security): tauri.conf 关闭 withGlobalTauri 并配置最小 CSP`

### T4 TypeScript 5.3 → 最新 5.x + vue-tsc 配套

- **目标**:去掉硬钉的 `typescript: 5.3.3`(2024 版本,无 caret),升到 5.x 最新并配套。
- **前置**:T2(TS/eslint-override 兼容)。
- **变更清单**:
  - `package.json`: `typescript: "^5.9.x"`(执行时以 `npm view typescript@5 version` 的 5.x 最新为准)
  - `vue-tsc`:保持 `^2.2.8` 先试;`npm run typecheck` 若报不兼容 TS 版本 → 升 `vue-tsc` 到能兼容的最新 2.x,仍不行再升 3.x 并修类型错误(3.x 的 breaking 按报错逐条处理)
  - 按新 TS 诊断修复类型错误(禁止 `@ts-ignore` 批量压制;单点注释说明)
- **验证**:`npm run typecheck` 绿 + `npm run test:coverage` 绿 + `npm run lint` 绿。
- **验收**:
  - [ ] typescript 版本在 package.json 带 caret 且为 5.x 最新
  - [ ] 新增类型修复逐条可追溯(写入 commit message 摘要)
- **失败处理**:vue-tsc 3.x 引入的结构性类型错误 >30 处 → 停止上报(说明需人工评估)。
- **commit**:`chore(deps): TypeScript 5.3 → 5.x 最新,解锁 caret 升级`

### T5 Rust 小版本对齐 + edition 2024

- **目标**:Rust 侧低风险版本对齐;**不动 lockfile 全量**,只动指定 crate。
- **前置**:T4。
- **变更清单**(`rank-analysis-app/src-tauri/`):
  - `Cargo.toml`:`base64 = "0.22"`、`tauri-plugin-updater = "2.10"`、`tauri-plugin-dialog = "2.7.2"`、`regex = "1.11"`、`edition = "2024"`
  - base64 0.21→0.22 代码适配:`use base64::Engine` prelude 变化,`codegraph explore 仓库内 base64 调用点`(主要在 `lcu/util/`)逐个改
  - **禁止**无参数全量 `cargo update`;需要时用 `cargo update -p <crate>` 单包
- **验证**:(本机无 cargo)commit + push 后 `gh run watch` 四 job 全绿(clippy -Dwarnings 下 edition 2024 可能出新 lint,按提示最小修复)。
- **验收**:
  - [ ] CI 四 job 全绿
  - [ ] Cargo.lock 中仅上述 crate 及其直接依赖变化
- **失败处理**:CI 红 2 轮修不好 → `git revert` 本卡,标记 Blocked(不阻塞 T6+)。
- **commit**:`chore(rust): 小版本对齐(base64 0.22 / tauri-plugin-* / regex)+ edition 2024`

---

## 5. 任务卡 P1

> P1 为构建/测试地基升级,通用规则:**分步升**(5→6→7→8),每步跑完验证再进下一步;某步 2 轮修不好 → 停在该版本,上报,不强制跳级;完成后 package.json/lockfile 落终值。

### T6 Vite 5 → 8

- **目标**:Vite 升 8.x,`@vitejs/plugin-vue` 配套 6.x。
- **前置**:T5(Rust 卡串行门控结束)。
- **变更清单**:
  - devDeps 分步:`vite ^6` → `^7` → `^8`;`@vitejs/plugin-vue ^6.0.8`(与 vite 主版本兼容的最高版本)
  - `vite.config.ts`:按各 major 的 breaking 调整(如 plugin 选项改名、移除废弃项);minify 保持 terser(已装)
- **验证**:每步 `npm ci && npm run build && npm run typecheck && npm run test:coverage` 绿;终步再补 `npm run format`。
- **验收**:
  - [ ] `vite --version` 为 8.x
  - [ ] `npm run build` 产物正常(dist 生成,无构建告警新增)
  - [ ] tauri dev 构建链路不破(以 `npm run build` 通过为准;真机运行列入【需人工复核】)
- **失败处理**:某 major 的 breaking 无法在 2 轮内解决 → 停在可工作的上一 major,commit 到该版本,后续卡照常,本卡记 Partial。
- **commit**:`chore(deps): Vite 5 → 8,plugin-vue 6 配套`

### T7 Vitest 1 → 4(+ jsdom 30)

- **目标**:vitest 与 @vitest/coverage-v8 升 4.x,jsdom 30。
- **前置**:T6(vitest 跑在 vite 之上)。
- **变更清单**:
  - devDeps 分步:`vitest ^2` → `^3` → `^4`;`@vitest/coverage-v8` 同版本;`jsdom ^30.0.1`
  - `vitest.config.ts`:按 major breaking 调整配置键;**覆盖率阈值不动**(lines 15/functions 45/branches 73/statements 15)
  - 修复测试 API 变更(如 fake timers/mocking 语义)导致的失败;**禁止改断言迁就实现**
- **验证**:每步 `npm run test:coverage` 绿(含阈值);`npm run typecheck` 绿。
- **验收**:
  - [ ] vitest 4.x,123 个 spec 全过,阈值不破
  - [ ] 测试逻辑等价(仅适配 API,不改测试意图)
- **失败处理**:某 spec 因框架行为变更失败且 2 轮无法等价修复 → 停止上报(该 spec 可能暴露真问题)。
- **commit**:`chore(deps): Vitest 1 → 4,jsdom 30,覆盖率阈值不变`

### T8 Pinia 2 → 4

- **目标**:pinia 升 4.x(Vue 3.5.41 已满足前置)。
- **前置**:T7。
- **变更清单**:
  - dependencies:`pinia ^4.0.3`(分步 3 → 4)
  - 三个 store(`pinia/setting.ts`、`playerNotes.ts`、`cloudSync.ts`)与 `main.ts` 装配按 breaking 调整
- **验证**:`npm run typecheck && npm run test:coverage`(cloudSync/playerNotes 均有 spec)绿。
- **验收**:
  - [ ] pinia 4.x;store 行为不变(以现有 spec 全过为准)
- **失败处理**:store 持久化/事件语义变化导致 spec 挂 → 2 轮修不好则停在 3.x,报 Partial。
- **commit**:`chore(deps): Pinia 2 → 4`

### T9 vue-router 4 → 5

- **目标**:vue-router 升 5.x。
- **前置**:T8。
- **变更清单**:
  - dependencies:`vue-router ^5.2.0`
  - `src/router/`:route 表、guards、route meta 按 breaking 调整;`codegraph explore router` 确认 `useRouter/useRoute` 调用点
- **验证**:`npm run typecheck && npm run test:coverage` 绿;`npm run build` 绿。
- **验收**:
  - [ ] 路由行为不变(gaming/record/settings 页面可达,guard 逻辑不变)
- **失败处理**:guard/meta 不兼容 2 轮修不好 → 停在 4.x 报 Partial。
- **commit**:`chore(deps): vue-router 4 → 5`

### T10 markdown-it 14 → 15

- **目标**:markdown-it 升 15.x(补丁笔记渲染链路)。
- **前置**:T9。
- **变更清单**:
  - dependencies:`markdown-it ^15.0.0`(app 与仓库根 `package.json` 各一处,`scripts/patch-notes/*.mjs` 用根上的);devDeps `@types/markdown-it` 配对
  - `codegraph explore markdown-it` 确认全部使用点(API 稳定,预计零代码改动)
- **验证**:两个 package 目录都 `npm install`;`npm run test:coverage`(含 patch-notes 相关 spec,若有)绿;`node scripts/patch-notes/run.mjs --check` 如脚本支持自检则跑。
- **验收**:
  - [ ] 两处 markdown-it 均 15.x
  - [ ] 补丁笔记渲染相关测试全过
- **失败处理**:15.x 移除 API 导致报错 → 按报错适配;2 轮不行停 14.x 报 Partial。
- **commit**:`chore(deps): markdown-it 14 → 15`

---

## 6. 任务卡 P2

> P2 为结构性升级,每卡保持"行为等价 + 测试兜底";涉及 Rust 的卡遵守 CI 串行门控。

### T11 Rust 类型化错误体系(error.rs + 首批命令)

- **目标**:引入 `thiserror` 类型化错误,替换最高频命令的 `Result<T, String>`;前端错误可按 code 分支。
- **前置**:T10;本机无 cargo → push 后 CI 门控。
- **变更清单**:
  - 新增 `src-tauri/src/error.rs`:`#[derive(thiserror::Error, Debug, Clone, Serialize, Deserialize)]` 枚举,至少含:`LcuNotRunning / TokenExpired / UpstreamHttp { status: u16, hint: String } / NotFound { what: String } / Unsupported(String) / Internal(String)`;每个 variant 序列化出 `{ "code": "LCU_NOT_RUNNING", "message": "..." }` 形状(前端兼容旧字符串读法的适配在 T12 做)
  - `Cargo.toml` 加 `thiserror = "2"`
  - 首批迁移 **5 个命令**(执行时 `codegraph callers invoke` 统计前端调用次数取 Top5,预期含 summoner/match_history/session 查询类):签名改 `Result<T, AppError>`,错误构造处替换
  - 其余命令**保持** `Result<T, String>` 不动(在 error.rs 文件头注释登记"二期清单")
  - 单测:每个 variant 的 serde 形状 + 至少 1 个命令的错误路径
- **验证**:CI 四 job 绿(新增单测随跑)。
- **验收**:
  - [ ] AppError 全部 variant 有 serde 单测
  - [ ] 5 个迁移命令的前端调用点无需改动即可编译通过(错误仍按字符串兼容,或前端 catch 路径不受影响——以现有 spec 全过为准)
- **失败处理**:Tauri v2 对 command 错误类型的约束不符(需 `Serialize + Debug`)→ 调整 derive;CI 2 轮红 → revert 报 Blocked。
- **commit**:`feat(rust): 引入 AppError 类型化错误体系,首批迁移 5 个高频命令`

### T12 前端 IPC 类型化注册表

- **目标**:51 处裸 `invoke('name')` + 4 处裸事件名收敛到类型化注册表,后端改名有编译期报错。
- **前置**:T11(错误形状确定)。
- **变更清单**:
  - 新增 `src/services/ipc/commands.ts`:每个后端 command 一个 `typedInvoke<TReq, TRes>('name', args)` 包装(泛型 + 参数/返回类型引用 `types/` 既有类型);事件名常量进 `src/services/ipc/events.ts`
  - 迁移全部 51 处 `invoke(` 调用点(28+ 文件,`codegraph callers invoke` 全量清单核对)+ 4 处 `listen(` 改用事件常量
  - 现有 `services/ipc.ts`(5 个命令)并入注册表,原文件保留 re-export 或删(避免双入口)
  - T11 迁移过的 5 个命令在此统一 `{code,message}` 错误归一(catch 后转 typed error 或既有降级策略,保持各调用点现有行为)
- **验证**:`npm run typecheck && npm run lint && npm run test:coverage` 绿;`grep -rn "invoke(" src --include=* | grep -v services/ipc/` 结果为 0。
- **验收**:
  - [ ] 裸字符串 command 名在 src 内(注册表外)= 0
  - [ ] 纯机械迁移:无行为变化(diff 可核对)
- **失败处理**:某调用点类型推导困难 → 该点用显式 `typedInvoke<XxxRes>` 标注,不放宽为 any;2 轮修不好停止上报。
- **commit**:`refactor(ipc): 前端 IPC 调用收敛到类型化注册表(51 command + 4 event)`

### T13 配置收敛:pinia config store(首批 20 处)

- **目标**:消灭"每组件 onMounted 自己拉 config"的重复模式;首批迁移设置页。
- **前置**:T12。
- **变更清单**:
  - 新增 `src/pinia/configStore.ts`:per-key 缓存 + `getConfig(key)/putConfig(key, val)/watchConfig(key, cb)`(封装既有 `getConfigByIpc/putConfigByIpc`,接入 `config-changed` 事件刷新缓存)
  - 迁移 `views/settings/General.vue`(11 处)+ `views/settings/Automation.vue`(9 处)改用 store
  - composables/其余 store 的 10+ 处留二期(文件头登记)
- **验证**:`npm run typecheck && npm run lint && npm run test:coverage` 绿;configStore 新 spec ≥5 个(缓存命中/未命中/put 后 watch 触发/IPC 失败降级)。
- **验收**:
  - [ ] General/Automation 两页行为不变(拉取时机/失败提示与现状一致)
  - [ ] 同 key 重复读取命中缓存(spec 覆盖)
- **失败处理**:watch 语义与既有轮询冲突 → 保留轮询,store 只做缓存,报说明;2 轮不行停止。
- **commit**:`refactor(config): 新增 config store,迁移 General/Automation 设置页 20 处读取`

### T14 Gaming.vue BP 候选计算抽取

- **目标**:把 Gaming.vue 内联的 BP 决策计算抽成 composable,组件只剩装配。
- **前置**:T13。
- **变更清单**:
  - 新增 `src/composables/useBestPickCandidates.ts`(或按 codegraph 实查的精确逻辑边界):Gaming.vue script 315–433 区间逻辑(orderedSubteams / bestPickCandidates / panelForColumn 等,以实查为准)整体搬移,依赖注入改为参数传入
  - `views/Gaming.vue`:引用 composable;script 目标 ≤ 350 行
  - 新 spec:`useBestPickCandidates.spec.ts`(覆盖排序/候选生成/列绑定各 ≥3 案)
- **验证**:`npm run typecheck && npm run lint && npm run test:coverage` 绿(含新 spec)。
- **验收**:
  - [ ] Gaming.vue 行数下降 ≥120 且无行为变化(现有 spec 全过;BP 面板列为【需人工复核】)
  - [ ] 抽取后 composable 无隐式全局状态(纯输入→输出)
- **失败处理**:逻辑边界比预期纠缠(与 session reactive 强耦合)→ 只抽能干净抽的部分,其余登记二期;不得为抽取改逻辑。
- **commit**:`refactor(gaming): BP 候选计算从 Gaming.vue 抽入 useBestPickCandidates`

### T15 user_tag_config 默认标签数据化

- **目标**:消灭 ~290 行的 `get_default_tags()` 字面量(约 user_tag_config.rs:839–1127)。
- **前置**:T14;Rust 卡 CI 门控。
- **变更清单**:
  - 新增 `src-tauri/src/command/data/default_tags.json`(内容 = 现函数输出;执行时先写"等价性测试"取旧函数输出固化为期望值,再落 JSON)
  - 新增结构体 + `include_str!` + serde 反序列化(`lazy` 缓存解析)
  - `get_default_tags()` 改为返回解析结果;旧字面量删除
  - 单测:JSON 解析 + 与旧输出等价(字段逐项)+ 容错(缺文件/坏 JSON 的降级行为明确化)
- **验证**:CI 四 job 绿。
- **验收**:
  - [ ] `get_default_tags()` 函数体 < 30 行
  - [ ] 等价性测试覆盖全部顶层字段
- **失败处理**:JSON 体积过大(>1MB)→ 改用 `include_bytes!` + 解压,或回退保留函数报说明。
- **commit**:`refactor(rust): 默认标签 290 行字面量数据化为嵌入 JSON`

### T16 (可选·高风险) automation 6 段同构分支数据驱动

- **目标**:`init_run_automation/start_automation` 等 6 段几乎相同的 match 分支收敛为任务表。
- **前置**:T15;Rust 卡 CI 门控。
- **变更清单**:
  - `automation.rs`:定义 `AutomationTaskSpec { name, interval, action: fn(Arc<Self>) -> ... }` 表,替换 6 段 match
  - **不改**任何任务的实际行为(轮询间隔/执行动作逐一对照)
  - 现有 automation 单测全过 + 补 1 个"任务表注册完整性"测试(6 任务名齐全)
- **验证**:CI 四 job 绿。
- **验收**:
  - [ ] 6 段 match 消失,行为逐分支等价(对照旧代码)
  - [ ] 现有测试零改动通过
- **失败处理**:自动化是真机核心链路——任何不能确证的等价性疑虑 → revert 本卡,标记 Blocked(不阻塞 T17+)。本卡失败不影响整体计划完成度。
- **commit**:`refactor(rust): automation 同构 start 分支数据驱动化(任务表)`

### T17 AI composable 状态机收敛(试点 useGrowthReport)

- **目标**:4 个 AI 分析 composable 复制的 loading/progress/缓存/try-catch 状态机收敛为模板;最小者试点。
- **前置**:T16。
- **变更清单**:
  - 新增 `src/composables/useAiAnalysis.ts` 泛型模板(参数:generator 函数 key、缓存策略、并发互斥);复用既有 `services/ai/shared/twoStage.ts`/`cache.ts`
  - 迁移 `useGrowthReport.ts`(59 行,最小)为模板实例;另 3 个登记二期
  - 模板 spec + useGrowthReport 既有 spec 零改动通过
- **验证**:`npm run typecheck && npm run test:coverage` 绿。
- **验收**:
  - [ ] useGrowthReport 行为等价(既有 5 spec 全过、零改动)
  - [ ] 模板覆盖 loading 互斥/缓存命中/错误降级三路径(spec)
- **失败处理**:模板抽象后发现语义差异(各 composable 的降级策略不一致)→ 模板只收公共部分,差异参数化;2 轮不行停止。
- **commit**:`refactor(ai): AI 分析 composable 状态机收敛,useGrowthReport 试点`

### T18 WS 重连指数退避 + 抖动

- **目标**:`lcu/listener.rs` 固定 2s 重连改为指数退避 + 抖动,避免 LCU 重启时的重连风暴。
- **前置**:T17;Rust 卡 CI 门控。
- **变更清单**:
  - `listener.rs`:退避 2s → 4s → 8s → … → 30s 封顶 + ±25% 抖动;连接成功后重置
  - 抽纯函数 `next_backoff_ms(attempt: u32, rng) -> u64` + 单测(单调、封顶、抖动范围、可注入 rng)
- **验证**:CI 四 job 绿。
- **验收**:
  - [ ] 纯函数单测 ≥4 案
  - [ ] 现有 listener 行为(首连/断开检测)不变
- **失败处理**:与现有重连回调交互出现竞态 → 保持 2s 固定并登记二期(需真机验证项)。
- **commit**:`fix(rust): LCU WebSocket 重连改指数退避+抖动`

### T19 catch (e: any) → unknown 类型收敛(首批)

- **目标**:错误处理类型卫生,首批收敛 AI 层与 cloudSync。
- **前置**:T18。
- **变更清单**:
  - `services/ai/index.ts`(5 处)、`services/ai/stream.ts`、`useGamingAIAnalysis.ts`、`useLiveAIAnalysis.ts`、`useGrowthReport.ts`、`pinia/cloudSync.ts`(8 处)等:`catch (e: any)` → `catch (e: unknown)` + 轻量 `errorMessage(e)` 工具(utils 新增 + spec)
  - 其余文件登记二期(在 utils/errorMessage 文件头列剩余清单)
- **验证**:`npm run typecheck && npm run lint && npm run test:coverage` 绿。
- **验收**:
  - [ ] 首批文件内 `catch (e: any)` = 0
  - [ ] 错误日志文案不变(既有降级行为等价)
- **失败处理**:unknown 收窄导致取属性报错 → 用 `instanceof`/工具断言,不退回 any。
- **commit**:`refactor(ts): catch(e: any) → unknown 收敛,首批 AI 层 + cloudSync`

---

## 7. Backlog

本期不做,按价值排期:

1. **全量 Rust 依赖升级**:`cargo update` 逐包(rusqlite 0.32 / sentry 0.42 / tokio-tungstenite 0.28 / mlua 0.9 / moka 0.12 / phf 0.12 / reqwest 补丁位),每包一 commit + CI 门控
2. **meet_db 连接池化**:`meet_db.rs:30` 全局 `Mutex<Option<Connection>>` → r2diesqlite(数据量上来前收益有限)
3. **T11/T12/T13/T14/T17 的"二期"尾巴**:其余 command 错误迁移、AI composable 其余 3 个迁移、config store 其余 10+ 处
4. **TypeScript 7(原生编译器)观察**:等 vue-tsc/vitest 生态稳定
5. **WS 退避真机验证**:T18 若降级为 2s 固定,留验证项
6. **automation 真机回归**:T16 类改动上线后的 LCU 真机冒烟(BAN/pick/trade 链路)

## 8. 风险与回退

| 风险 | 缓解 |
|---|---|
| 大版本跳(Vite 5→8 / Vitest 1→4)行为漂移 | 分步升、每步门禁、停级策略(§5 通用规则) |
| Rust 改动本机无法验证 | CI 四 job 门禁 + 串行门控 + 2 轮 revert 纪律(§3-4) |
| CSP 误伤运行时资源 | T3 标注【需人工复核】+ 逐 directive 放宽回退 |
| 机械迁移(IPC/composable)引入行为漂移 | 纯搬运纪律 + 现有 spec 零改动全过 + diff 逐文件核对 |
| 依赖 registry 漂移(计划写好时 latest ≠ 执行时) | 各卡版本写区间下限,执行时 `npm view` 复查,取"计划版本与当前 latest 的较新兼容值" |
| 自动执行跑偏 | §3 停止条件 + 一卡一 commit 可单卡 revert |

**整体回退**:任一卡 `git revert <sha>`,不影响其他卡(各卡自包含、无跨卡半成品状态)。

## 9. 附录

### 9.1 2026-08-17 实测版本对照(npm)

| 包 | 仓库现值 | 当日最新 | 落卡 |
|---|---|---|---|
| @tauri-apps/api | ^2.10.0 | 2.11.1 | T1 |
| @tauri-apps/plugin-dialog | ^2.7.1 | 2.7.2 | T1 |
| @tauri-apps/plugin-http | ^2.4.4 | 2.5.9 | T1 |
| @tauri-apps/plugin-opener | ^2 | 2.5.4 | T1 |
| @tauri-apps/plugin-updater | ^2.10.0 | 2.10.1 | T1 |
| @tauri-apps/cli | ^2.10.0 | 2.11.4 | T1 |
| prettier | ^3.2.5 | 3.9.6 | T1 |
| naive-ui | ^2.37.3(devDeps 误放) | 2.45.0 | T1 |
| eslint | ^8.56.0 | 10.8.1 | T2 |
| eslint-plugin-vue | ^9.21.1 | 10.10.0 | T2 |
| @vue/eslint-config-typescript | ^12.0.0 | 14.9.0 | T2 |
| @vue/eslint-config-prettier | ^8.0.0 | 10.2.0 | T2 |
| typescript | 5.3.3(硬钉) | 5.x 最新 | T4 |
| vite | ^5.0.12 | 8.2.1 | T6 |
| @vitejs/plugin-vue | ^5.0.3 | 6.0.8 | T6 |
| vitest / @vitest/coverage-v8 | ^1.2.2 | 4.1.10 | T7 |
| jsdom | ^24.0.0 | 30.0.1 | T7 |
| pinia | ^2.3.1 | 4.0.3 | T8 |
| vue-router | ^4.2.5 | 5.2.0 | T9 |
| markdown-it | ^14.1.0 | 15.0.0 | T10 |
| vue | 3.5.x | 3.5.41 | 已最新,不动 |

### 9.2 Rust 关键依赖现值(Cargo.toml)

tauri "2" / tauri-plugin-updater 2.9.0 / tauri-plugin-dialog 2.7.1 / serde_yaml 0.9 / regex 1.10.3 / reqwest 0.12 / base64 0.21 / moka 0.12 / phf 0.12 / tokio "1" / tokio-tungstenite 0.28 / sentry 0.42 / rusqlite 0.32 / mlua 0.9 / winreg 0.55 / ntapi 0.4 / winapi 0.3.9 / tauri-plugin-mcp-bridge 0.11

T5 只动其中低风险子集;其余见 §7-1。

### 9.3 调研中发现、本期未立项的观察

- `services/ai/player-insight.ts`:any 重灾区且无 spec(T19 二期一并处理)
- `automation.rs` 6 段之外,`start_task/stop_task` 的 `lock().unwrap()` 未用同文件 `lock_or_recover`(T16 顺带修或登记)
- 4 处 `danger_accept_invalid_certs` 仅限 LCU 127.0.0.1 客户端,隔离正确,不动

## 10. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-08-17 | 初版:T1–T19 任务卡 + 停止条件 + 版本对照(调研:代码全量通读 + registry 实测) |
| T1 | — | 待执行:commit sha / 结果 |
| T2 | — | 待执行 |
| T3 | — | 待执行 |
| T4 | — | 待执行 |
| T5 | — | 待执行 |
| T6 | — | 待执行 |
| T7 | — | 待执行 |
| T8 | — | 待执行 |
| T9 | — | 待执行 |
| T10 | — | 待执行 |
| T11 | — | 待执行 |
| T12 | — | 待执行 |
| T13 | — | 待执行 |
| T14 | — | 待执行 |
| T15 | — | 待执行 |
| T16 | — | 待执行(可选) |
| T17 | — | 待执行 |
| T18 | — | 待执行 |
| T19 | — | 待执行 |

