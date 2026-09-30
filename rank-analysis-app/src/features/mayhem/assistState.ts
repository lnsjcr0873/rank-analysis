/**
 * 大乱斗三选一助手的**阻塞原因**共享状态。
 *
 * 动机：`useInGameServices.startMayhemAssistIfNeeded` 在 `mayhemAssistEnabled`
 * 为 false（或 OCR 构建不支持）时只 `stopMayhemAssist()` 就静默 return。结果是
 * 进大乱斗后既没有推荐、也没有 `band-detect.jsonl`，界面按钮还显示「启动对局
 * 监听」，用户完全无法判断是设置把它关了还是自己没点。
 *
 * 这里用**模块级 ref**（而非 Pinia store）承载原因，是因为写入方是全局常驻服务
 * `useInGameServices`——它在 Pinia 激活之前就有可能被调用，直接 import store
 * 会引入初始化顺序依赖。store 与全局服务都只在这里读写这一个 ref。
 *
 * @module features/mayhem/assistState
 */
import { ref } from 'vue'

/** 助手为何未运行；空字符串表示无阻塞（未启动 / 正常运行中）。 */
export const mayhemAssistBlockedReason = ref<string>('')

/** 设置里显式关闭了自动识别。 */
export const ASSIST_BLOCKED_DISABLED = '已在设置中关闭自动识别（设置 → 大乱斗 → 三选一助手）'

/** 当前构建/平台不支持 OCR 自动识别。 */
export const ASSIST_BLOCKED_NO_OCR = '当前构建不支持自动识别（缺 OCR 引擎），请用「手动三选一」'

/** 不在大乱斗队列，无需运行。 */
export const ASSIST_BLOCKED_NOT_MAYHEM = '当前队列不是大乱斗，无需三选一助手'
