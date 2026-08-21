/**
 * 极地大乱斗 ARAM 备选席与阵容平衡建议引擎（ARAM Bench & Comp Advisor）
 */

export interface AramBenchRecommendation {
  championId: number
  name: string
  buffSummary: string
  reason: string
  priority: 'high' | 'medium'
}

export interface AramCompAnalysis {
  adPercent: number
  apPercent: number
  balanceStatus: 'balanced' | 'all_ap' | 'all_ad' | 'lack_frontline'
  statusText: string
  recommendations: AramBenchRecommendation[]
}

// 常见英雄主要伤害类型分类（简易映射与兜底）
const AP_CHAMPIONS = new Set([
  1, 4, 7, 9, 13, 25, 26, 27, 30, 31, 34, 38, 43, 45, 55, 61, 63, 68, 69, 74, 82, 84, 85, 90, 99,
  101, 103, 105, 112, 115, 127, 131, 134, 136, 142, 143, 161, 163, 245, 268, 516, 517, 518, 526,
  711, 777, 887, 888, 895, 902
])

export function analyzeAramComp(
  myTeamChampionIds: number[],
  benchChampionIds: number[] = [],
  championNames: (id: number) => string = id => `英雄${id}`
): AramCompAnalysis {
  const validTeam = myTeamChampionIds.filter(id => id > 0)
  if (validTeam.length === 0) {
    return {
      adPercent: 50,
      apPercent: 50,
      balanceStatus: 'balanced',
      statusText: '阵容攻防均衡',
      recommendations: []
    }
  }

  let apCount = 0
  let adCount = 0

  validTeam.forEach(id => {
    if (AP_CHAMPIONS.has(id)) {
      apCount++
    } else {
      adCount++
    }
  })

  const total = validTeam.length
  const apPercent = Math.round((apCount / total) * 100)
  const adPercent = Math.round((adCount / total) * 100)

  let balanceStatus: AramCompAnalysis['balanceStatus'] = 'balanced'
  let statusText = '阵容物理与魔法伤害均衡'

  if (apPercent >= 80) {
    balanceStatus = 'all_ap'
    statusText = '⚠️ 纯 AP 魔法阵容，易被敌方魔抗装备（水银鞋/自然之力）针对'
  } else if (adPercent >= 80) {
    balanceStatus = 'all_ad'
    statusText = '⚠️ 纯 AD 物理阵容，易被敌方护甲装备（布甲鞋/反甲/兰顿）克制'
  }

  // 备选席推荐
  const recommendations: AramBenchRecommendation[] = []
  benchChampionIds.forEach(id => {
    if (id <= 0) return
    const isAp = AP_CHAMPIONS.has(id)
    const name = championNames(id)

    if (balanceStatus === 'all_ap' && !isAp) {
      recommendations.push({
        championId: id,
        name,
        buffSummary: 'AD 核心物理输出',
        reason: '换入可补充队伍稀缺的物理伤害，防止敌方全叠魔抗',
        priority: 'high'
      })
    } else if (balanceStatus === 'all_ad' && isAp) {
      recommendations.push({
        championId: id,
        name,
        buffSummary: 'AP 核心魔法输出',
        reason: '换入可补充队伍稀缺的魔法伤害与清线能力',
        priority: 'high'
      })
    }
  })

  return {
    adPercent,
    apPercent,
    balanceStatus,
    statusText,
    recommendations: recommendations.slice(0, 3)
  }
}
