//! # timeline 几何与营地识别
//!
//! ## 为什么营地靠 `monster_type` 而不是像素坐标
//!
//! 常见做法是把红/蓝 buff、鸟、狼、螃蟹的精确像素坐标写死成常量表，
//! 再用「玩家坐标落在哪个圆里」判营地。本实现**不这么做**：地图坐标常量一旦
//! 记错（版本间地形微调也会漂移），不会报错、只会让路径推断整体失真——
//! 而这类错误极难从测试里看出来。
//!
//! 帧事件本身带 `monster_type` / `monster_sub_type`（语义化的营地标识），
//! 用它判营地是**读数据**而非**猜几何**，稳定且可测。
//! 坐标只用于粗粒度区域分桶（我方/敌方半场、三条路、河蟹区域），
//! 且分桶阈值放宽，宁可粗一点也不假装精确。

use serde::Serialize;

use crate::timeline::constants::{MAP_COORD_MAX, MAP_COORD_MIN};

/// 召唤师峡谷中心（地图约 15000×15000）。
pub const MAP_CENTER: i32 = 7500;

/// 地图边长。
pub const MAP_SIZE: i32 = 15000;

/// 半条路的宽度：距某条「轴线」多近算落在那条路上。
///
/// 这是**分桶阈值**而非几何真值——用于回答「大致在哪条路 / 哪个半场」，
/// 不用于任何精确距离或路径还原。
const LANE_BAND: i32 = 1400;

/// 某点所属的大区（粗粒度）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MapZone {
    /// 蓝色方下半野区（蓝buff 一侧）
    BlueJungle,
    /// 红色方上半野区（红buff 一侧）
    RedJungle,
    TopLane,
    MidLane,
    BotLane,
    /// 河道（贯穿地图的斜线带）
    River,
    /// 坐标不可信
    Unknown,
}

impl MapZone {
    /// 是否野区（路径分析只关心野区轨迹）。
    pub fn is_jungle(self) -> bool {
        matches!(self, MapZone::BlueJungle | MapZone::RedJungle)
    }
}

/// 坐标是否可信（越界即脏数据）。
pub fn is_plausible_coord(x: i32, y: i32) -> bool {
    (MAP_COORD_MIN..=MAP_COORD_MAX).contains(&x) && (MAP_COORD_MIN..=MAP_COORD_MAX).contains(&y)
}

/// 判定点位所属大区。
///
/// 判定顺序有意为之：先取最「窄」的桶（三条路是地图上的细带），
/// 再取河，最后兜底为野区。这样中路与河道交点不会被野区吞掉。
pub fn classify_map_zone(x: i32, y: i32) -> MapZone {
    if !is_plausible_coord(x, y) {
        return MapZone::Unknown;
    }
    // 中路贴着主对角线 x == y
    if (x - y).abs() <= LANE_BAND {
        return MapZone::MidLane;
    }
    // 河道贴着副对角线 x + y == MAP_SIZE
    if (x + y - MAP_SIZE).abs() <= LANE_BAND {
        return MapZone::River;
    }
    // 上路贴上边界，下路贴下边界（先判野区会让边路被误吞）
    if y >= MAP_SIZE - LANE_BAND * 2 {
        return MapZone::TopLane;
    }
    if y <= LANE_BAND * 2 {
        return MapZone::BotLane;
    }
    // 兜底：以中心把地图切成两半
    if x + y < MAP_SIZE {
        MapZone::BlueJungle
    } else {
        MapZone::RedJungle
    }
}

/// 阵营归属。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Blue,
    Red,
    /// 中立区域（河道），不属于任一半边
    Neutral,
}

/// 判定点位属于哪个半场（用于「敌方打野早期出现在我方野区」这类判断）。
pub fn classify_side(x: i32, y: i32) -> Side {
    if !is_plausible_coord(x, y) {
        return Side::Neutral;
    }
    match x + y {
        s if s < MAP_SIZE - LANE_BAND * 2 => Side::Blue,
        s if s > MAP_SIZE + LANE_BAND * 2 => Side::Red,
        _ => Side::Neutral,
    }
}

/// 野区营地（靠帧事件的 monster 标识识别）。
///
/// 对外序列化为 camelCase（`blueBuff` / `riftHerald`），前端直接消费，
/// 不在调用层做 `format!("{:?}")` 之类的字符串拼装——那会让枚举改名时
/// 悄悄改变前端契约。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Camp {
    BlueBuff,
    RedBuff,
    /// 补刀刀锋（锋喙鸟）
    Krugs,
    /// 远古魔像
    Gromp,
    /// 灰烬狼
    Wolves,
    /// 帷帐？占位：scuttle 蟹（河道中立资源）
    RiftScuttler,
    /// 峡谷先锋
    RiftHerald,
    /// 小龙
    Dragon,
    /// 纳什男爵
    Baron,
}

/// 由帧事件的 monster 标识反查营地。
///
/// SGP 的 `monster_type` / `monster_sub_type` 取值随版本演进，故这里同时匹配
/// 两个字段并做**子串包含**而非全等——匹配不上就返回 `None`（该次击杀不计入
/// 营地序列），而不是猜一个最近的营地。
pub fn camp_of_monster(monster_type: Option<&str>, monster_sub_type: Option<&str>) -> Option<Camp> {
    // 归一化：统一小写并**去掉所有非字母数字字符**。
    // 这一步是必需的——SGP 同一概念在不同端点/版本里写法不一致
    // （`BlueSentinel` / `blue_sentinel` / `BLUE SENTINEL` / `RIFT_HERALD` / `RiftHerald`），
    // 若只做小写化，`BlueSentinel` 匹配不上 `blue sentinel` 这类带空格的键。
    let hay = normalize_token(monster_type.unwrap_or_default())
        + &normalize_token(monster_sub_type.unwrap_or_default());

    // 键同样归一化后匹配，故此处全部写成无分隔符形式。
    // 顺序有讲究：先判带特征词的，避免短词误吞更长概念
    // （如 `riftcrab` 不应被 `crab` 之外的规则抢先命中，`nashor` 要早于泛化规则）。
    const TABLE: &[(&str, Camp)] = &[
        ("bluesentinel", Camp::BlueBuff),
        ("bluebuff", Camp::BlueBuff),
        // 刻意**不**收录裸 "blue"/"red"：这两个词在 SGP 里也出现在
        // 阵营/皮肤等无关上下文中，收进来会把非营地事件误判成 buff。
        // 认不出就返回 None（不计入路径），比错判一个营地安全。
        ("redbrambleback", Camp::RedBuff),
        ("redbuff", Camp::RedBuff),
        ("krug", Camp::Krugs),
        ("gromp", Camp::Gromp),
        ("wolf", Camp::Wolves),
        ("riftcrab", Camp::RiftScuttler),
        ("scuttle", Camp::RiftScuttler),
        ("crab", Camp::RiftScuttler),
        ("riftherald", Camp::RiftHerald),
        ("herald", Camp::RiftHerald),
        ("baronnashor", Camp::Baron),
        ("nashor", Camp::Baron),
        ("baron", Camp::Baron),
        ("infernal", Camp::Dragon),
        ("ocean", Camp::Dragon),
        ("mountain", Camp::Dragon),
        ("hextech", Camp::Dragon),
        ("elder", Camp::Dragon),
        ("cloud", Camp::Dragon),
        ("dragon", Camp::Dragon),
    ];
    TABLE.iter().find(|(k, _)| hay.contains(k)).map(|(_, c)| *c)
}

/// 归一化单个 monster 标识：小写 + 只保留字母数字。
fn normalize_token(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// 该营地是否为「前期节奏资源」（有明确节奏意义，非补刀）。
pub fn is_objective_camp(camp: Camp) -> bool {
    matches!(camp, Camp::Dragon | Camp::Baron | Camp::RiftHerald)
}

/// 两点间距离（地图单位）。
pub fn distance(ax: i32, ay: i32, bx: i32, by: i32) -> f64 {
    let dx = (ax - bx) as f64;
    let dy = (ay - by) as f64;
    (dx * dx + dy * dy).sqrt()
}

/// 判定「敌方打野在场」的半径阈值（地图单位）。
///
/// **这是一个粗略的代理量，不是精确判定。** SGP 帧是逐分钟聚合，
/// 我们只有分钟级的位置快照，拿不到「打野正在赶来的路上」这类连续轨迹。
/// 因此语义被刻意收窄为：
///
/// > 死亡发生的这一分钟，敌方打野的位置离死亡点足够近。
///
/// 阈值取 2000（约占地图宽度的 13%）——宁可保守（略过一些真 gank），
/// 也不要激进（把路人经过算成打野支援），因为这个值直接决定
/// 「极好抓/好抓/难抓」三个对外 Tag 的可信度。
pub const GANK_PRESENCE_RADIUS: f64 = 2000.0;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mid_lane_is_the_main_diagonal() {
        // 地图正中
        assert_eq!(classify_map_zone(7500, 7500), MapZone::MidLane);
        // 蓝方一塔附近仍在中路轴线上
        assert_eq!(classify_map_zone(3200, 3400), MapZone::MidLane);
    }

    #[test]
    fn top_and_bot_lanes_are_the_two_horizontal_edges() {
        assert_eq!(classify_map_zone(7000, 14400), MapZone::TopLane);
        assert_eq!(classify_map_zone(7000, 900), MapZone::BotLane);
    }

    #[test]
    fn river_is_the_anti_diagonal() {
        // 河道从左上到右下：x + y ≈ MAP_SIZE
        assert_eq!(classify_map_zone(11000, 4200), MapZone::River);
        assert_eq!(classify_map_zone(4200, 11000), MapZone::River);
    }

    #[test]
    fn jungle_splits_by_map_center() {
        // 蓝方野区（左下）：x+y < MAP_SIZE，且与主对角线、副对角线都拉开距离
        assert_eq!(classify_map_zone(3000, 5000), MapZone::BlueJungle);
        // 红方野区（右上）：同理需避开两条轴线，否则会被中/河道吞掉
        assert_eq!(classify_map_zone(12000, 10500), MapZone::RedJungle);
        assert_eq!(classify_map_zone(10500, 12000), MapZone::RedJungle);
    }

    #[test]
    fn jungle_adjacent_to_mid_still_counts_as_mid() {
        // 中路带较宽，紧邻中路的点位按中路归桶而不是野区——这是有意的粗粒度取舍，
        // 断言把它钉住，避免后人误以为野区边界更精确
        assert_eq!(classify_map_zone(7800, 7900), MapZone::MidLane);
    }

    #[test]
    fn out_of_range_coords_are_unknown_not_panicking() {
        assert_eq!(classify_map_zone(-99999, 10), MapZone::Unknown);
        assert_eq!(classify_map_zone(10, 99999), MapZone::Unknown);
        assert!(!is_plausible_coord(-50000, 0));
        assert!(!is_plausible_coord(0, 99999));
        assert!(is_plausible_coord(0, 0));
        assert!(is_plausible_coord(15000, 15000));
    }

    #[test]
    fn side_classification_treats_river_as_neutral() {
        assert_eq!(classify_side(1000, 1000), Side::Blue);
        assert_eq!(classify_side(14000, 14000), Side::Red);
        // 河道正中
        assert_eq!(classify_side(11000, 4200), Side::Neutral);
    }

    #[test]
    fn monster_ids_map_to_camps() {
        assert_eq!(
            camp_of_monster(Some("BlueSentinel"), None),
            Some(Camp::BlueBuff)
        );
        assert_eq!(
            camp_of_monster(Some("CHAMPION"), Some("RedBrambleback")),
            Some(Camp::RedBuff)
        );
        assert_eq!(
            camp_of_monster(Some("RIFT_HERALD"), None),
            Some(Camp::RiftHerald)
        );
        assert_eq!(
            camp_of_monster(Some("BARON_NASHOR"), None),
            Some(Camp::Baron)
        );
        assert_eq!(
            camp_of_monster(Some("dragontype"), None),
            Some(Camp::Dragon)
        );
    }

    #[test]
    fn monster_ids_tolerate_separator_and_case_variants() {
        // SGP 同一概念有多种写法：驼峰 / 下划线 / 全大写 / 带空格
        for variant in [
            "BlueSentinel",
            "BLUE_SENTINEL",
            "blue sentinel",
            "Blue Sentinel",
            "bluesentinel",
        ] {
            assert_eq!(
                camp_of_monster(Some(variant), None),
                Some(Camp::BlueBuff),
                "写法 {variant} 未被识别"
            );
        }
        for variant in ["RiftHerald", "RIFT_HERALD", "rift-herald", "Rift Herald"] {
            assert_eq!(
                camp_of_monster(Some(variant), None),
                Some(Camp::RiftHerald),
                "写法 {variant} 未被识别"
            );
        }
    }

    #[test]
    fn scuttle_is_not_matched_as_blue_by_stale_prefix() {
        // 河蟹的标识含 "riftcrab"，不应被 "blue" 之类的宽规则误判
        assert_eq!(
            camp_of_monster(Some("RIFT_CRAB"), None),
            Some(Camp::RiftScuttler)
        );
    }

    #[test]
    fn unknown_monster_returns_none_rather_than_guessing() {
        assert_eq!(camp_of_monster(Some("SOME_NEW_CAMP"), None), None);
        assert_eq!(camp_of_monster(None, None), None);
        assert_eq!(camp_of_monster(Some(""), Some("")), None);
    }

    #[test]
    fn objectives_are_distinguished_from_farm_camps() {
        assert!(is_objective_camp(Camp::Dragon));
        assert!(is_objective_camp(Camp::Baron));
        assert!(is_objective_camp(Camp::RiftHerald));
        assert!(!is_objective_camp(Camp::BlueBuff));
        assert!(!is_objective_camp(Camp::Wolves));
    }

    #[test]
    fn distance_is_symmetric_and_zero_on_self() {
        assert_eq!(distance(100, 200, 100, 200), 0.0);
        let a = distance(0, 0, 3000, 4000);
        let b = distance(3000, 4000, 0, 0);
        assert!((a - b).abs() < 1e-9, "距离必须对称");
        assert!((a - 5000.0).abs() < 1e-9, "3-4-5 三角形");
    }

    #[test]
    fn gank_radius_is_well_formed() {
        // 常量不变量用 const 块表达（clippy assertions_on_constants）
        const {
            assert!(GANK_PRESENCE_RADIUS > 0.0);
            assert!(GANK_PRESENCE_RADIUS < MAP_SIZE as f64 * 0.25);
        }
    }
}
