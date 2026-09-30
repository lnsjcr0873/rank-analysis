/**
 * 大乱斗三选一助手的**阻塞原因**与**运行态**共享状态。
 *
 * 动机：`useInGameServices.startMayhemAssistIfNeeded` 在 `mayhemAssistEnabled`
 * 为 false（或 OCR 构建不支持）时只 `stopMayhemAssist()` 就静默 return。结果是
 * 进大乱斗后既没有推荐、也没有 `band-detect.jsonl`，界面按钮还显示「启动对局
 * 监听」，用户完全无法判断是设置把它关了还是自己没点。
 *
 * 这里用**模块级 ref**（而非 Pinia store）承载状态，是因为写入方是全局常驻服务
 * `useInGameServices`——它在 Pinia 激活之前就有可能被调用，直接 import store
 * 会引入初始化顺序依赖。store 与全局服务都只在这里读写这两个 ref。
 *
 * 运行态同样必须共享：全局路径直接操作调度器，若不把真实 `running` 写回共享
 * ref，store 里的 `assistRunning` 就只有「用户点按钮」那条路径会更新。届时全局
 * 自动开启时按钮仍显示「启动对局监听」，全局停掉时按钮仍显示「已开启」——后者
 * 更糟：横幅条件 `assistBlocked && !assistRunning` 恰好为 false，提示被吞掉，
 * 又退回静默失效。
 *
 * @module features/mayhem/assistState
 */
import { ref } from 'vue'

/** 助手为何未运行；空字符串表示无阻塞（未启动 / 正常运行中）。 */
export const mayhemAssistBlockedReason = ref<string>('')

/**
 * 助手调度器的真实运行态，供跨页（Mayhem 页）读取。
 *
 * 与 {@link mayhemAssistBlockedReason} 同源同理由：唯一可信来源是
 * `getSharedAssistScheduler().running`，本 ref 由全局服务与 store 的
 * toggle 路径共同写入，不得在别处推断。
 */
export const mayhemAssistRunning = ref(false)

/** 设置里显式关闭了自动识别。 */
export const ASSIST_BLOCKED_DISABLED = '已在设置中关闭自动识别（设置 → 大乱斗 → 三选一助手）'

/** 当前构建/平台不支持 OCR 自动识别。 */
export const ASSIST_BLOCKED_NO_OCR = '当前构建不支持自动识别（缺 OCR 引擎），请用「手动三选一」'

/** 不在大乱斗队列，无需运行。 */
export const ASSIST_BLOCKED_NOT_MAYHEM = '当前队列不是大乱斗，无需三选一助手'
