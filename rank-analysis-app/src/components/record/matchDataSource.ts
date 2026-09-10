/**
 * 对局详情数据源判定：跨区(SGP) vs 本地 LCU。
 *
 * 战绩详情页（MatchDetailInline）的共享头尾标识：跨区查询时数据来自官方跨区
 * 战绩通道（SGP），部分字段（如本局版本号 gameVersion，SGP 未必返回；报告中
 * 点名的 championPickIntent 仅存在于客户端实时选人接口，对局详情本就无此字段）
 * 与 LCU 本地数据存在差异。判定结果用于展示「数据源差异」标签，提示相关子 Tab
 * 可能出现降级展示（符文页缺失回退、出装推荐无样本等），其行为都已各自兜底。
 */
export interface MatchDataSource {
  /** 跨区(SGP) 数据源：路由 region 查询参数非空 = 官方跨区战绩通道 */
  isCrossSgp: boolean
  /** 本局缺少版本号字段（SGP 未必返回；LCU match-details 恒有） */
  missingGameVersion: boolean
}

export interface DataSourceCompatibleGame {
  gameDetail?: {
    gameVersion?: string | null
    participants?: unknown[]
    participantIdentities?: unknown[]
  } | null
  participants?: unknown[]
  gameVersion?: string | null
}

/**
 * 解析某场对局的数据源特征。
 * @param region - 跨区查询目标大区 platformId（空 = 当前区/LCU）
 * @param game - 对局对象（可为空）
 */
export function resolveMatchDataSource(
  region: string,
  game?: DataSourceCompatibleGame | null
): MatchDataSource {
  const version = game?.gameDetail?.gameVersion ?? game?.gameVersion ?? ''
  return {
    isCrossSgp: !!region,
    missingGameVersion: !version
  }
}
