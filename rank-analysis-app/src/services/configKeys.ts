/**
 * config 持久化键名（前端共享常量）
 *
 * 收口散落在多个组件里的裸字符串 key，避免改名时漏改一处。
 * 与 `getConfigByIpc` / `putConfigByIpc`（{@link ./ipc}）配套使用。
 *
 * @module services/configKeys
 */

/**
 * 错误上报（Sentry）相关配置键。
 *
 * `errorReportingEnabled` 与后端 `observability::REPORTING_KEY` 对应——改这里也要同步 Rust。
 */
export const CONFIG_KEYS = {
  /** 是否开启 Sentry 错误上报 / 日志转发（opt-in，release 默认关、debug 默认开） */
  errorReportingEnabled: 'errorReportingEnabled',
  /** 是否已就错误上报询问过用户（首次同意弹窗用，问过即不再弹） */
  errorReportingConsentShown: 'errorReportingConsentShown',
  /** 用户自定义 DashScope API Key（留空用内置打包 key） */
  dashscopeApiKey: 'dashscopeApiKey',
  /** D-P4：AI 服务商（dashscope | openai | ollama，缺省 dashscope） */
  aiProvider: 'ai.provider',
  /** D-P4：OpenAI 兼容 / Ollama 的自定义端点（缺省各官方默认） */
  aiBaseUrl: 'ai.baseUrl',
  /** D-P4：模型名覆盖（空串用各调用方默认模型） */
  aiModel: 'ai.model',
  /** D-P4：OpenAI 兼容服务商的 API Key（dashscope 仍用 dashscopeApiKey） */
  aiApiKey: 'ai.apiKey',
  /** 玩家备注是否随 AI 分析请求发送到云端模型（默认开） */
  aiUsePlayerNotes: 'aiUsePlayerNotes',
  /** 战术情报开关：整队/对局 AI 分析是否注入版本情报+克制+信号+模式知识（默认开，显式 false 关闭） */
  opggEnabled: 'opgg.enabled',
  /** 云同步开关（默认关，开启需经风险告知弹窗） */
  cloudSyncEnabled: 'cloudSyncEnabled',
  /** 本设备是否已完成过首次配置同步(首次确认弹窗只出现一次;设备级,不入备份) */
  configSyncedOnce: 'configSyncedOnce',
  /** 本设备上次推送/应用配置的时刻 ms(LWW 比较基准;设备级,不入备份) */
  configLastSyncAt: 'configLastSyncAt',
  /**
   * 游戏安装根目录（免 WeGame 一键启动用）。
   *
   * 由后端在客户端「已连接」时从运行进程反推并自动记忆（见 Rust `command::launcher`），
   * 前端一般无需读写；列在此处以收口该共享键名。
   */
  gameInstallPath: 'gameInstallPath',
  /** 页面缩放比例（Ctrl+滚轮调节，0.7~1.5；见 composables/useZoom） */
  zoomFactor: 'settings.ui.zoomFactor',
  /** 启动时是否自动检查更新（默认开；关闭后仅影响 header 静默检查，手动检查不受限） */
  updateCheckEnabled: 'updateCheckEnabled',
  /** 战绩列表每页条数模式：auto=按窗口高度动态计算 / fixed=手动固定（见 components/record/pageSize） */
  matchPageMode: 'record.pageMode',
  /** 战绩列表 fixed 模式的固定条数（默认 10） */
  matchPageSize: 'record.pageSize',
  /**
   * 战绩面板 v2 重构灰度开关（默认开；关闭回退旧"聚焦吞页"行为，用于线上事故一键回旧）。
   * 结构收敛/缺陷修复属 bug 修复不随此开关回退，只有可观测布局/交互差异受控。
   */
  recordV2: 'record.v2Enabled',
  /** 禁用对局悬浮窗（Overlay）（默认 false，即不禁用） */
  disableOverlay: 'settings.overlay.disabled',
  /** 禁用游戏对局中 1-2s 频率轮询 allgamedata（默认 false，即不禁用） */
  disableLiveGamePoll: 'settings.liveGamePoll.disabled',
  /** 大乱斗 3 选 1 推荐功能开关（默认 false，即关闭） */
  mayhemAssistEnabled: 'settings.mayhem.assistEnabled',
  /** 大乱斗轮询截图功能开关（默认 false，即关闭） */
  mayhemCaptureEnabled: 'settings.mayhem.captureEnabled'
} as const
