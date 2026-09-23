import { ref } from 'vue'
import { getConfigByIpc } from '@renderer/services/ipc'
import { CONFIG_KEYS } from '@renderer/services/configKeys'

/**
 * 战绩面板 v2 重构灰度开关（aRecordV2）。
 *
 * 默认开启；配置键 `record.v2Enabled`（见 {@link CONFIG_KEYS.recordV2}）为 false
 * 时回退旧交互（宽屏"聚焦吞页"），用于线上事故一键回旧。
 *
 * 注意：本开关只控制可观测的布局/交互差异（如宽屏选中时是否整页吞掉列表），
 * 不控制结构收敛与缺陷修复（那些属于 bug 修复，不回退）。读取失败时按"开启"兜底。
 */
const recordV2 = ref<boolean | null>(null)

export function useRecordV2() {
  if (recordV2.value === null) {
    void getConfigByIpc<boolean>(CONFIG_KEYS.recordV2)
      .then(v => {
        recordV2.value = v ?? true
      })
      .catch(() => {
        // 读取失败（如测试宿主无 Tauri 后端）：按默认开启处理，不让 Promise 悬挂 reject
        recordV2.value = true
      })
  }
  return recordV2
}
