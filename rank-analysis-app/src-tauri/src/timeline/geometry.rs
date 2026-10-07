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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
    let hay = format!(
        "{}|{}",
        monster_type.unwrap_or_default().to_ascii_lowercase(),
        monster_sub_type.unwrap_or_default().to_ascii_lowercase()
    );
    // 顺序有讲究：先判带特征词的，避免 "redbuff" 被 "buff" 这类短词误吞，
    // 也避免 herald 的 "blue" 前缀（虚空巢虫）误判成蓝buff。
    const TABLE: &[(&str, Camp)] = &[
        ("bluebuff", Camp::BlueBuff),
        ("blue sentinel", Camp::BlueBuff),
        ("redbuff", Camp::RedBuff),
        ("red brambleback", Camp::RedBuff),
        ("krug", Camp::Krugs),
        ("gromp", Camp::Gromp),
        ("wolf", Camp::Wolves),
        ("scuttle", Camp::RiftScuttler),
        ("crab", Camp::RiftScuttler),
        ("herald", Camp::RiftHerald),
        ("rift herald", Camp::RiftHerald),
        ("baron", Camp::Baron),
        ("nashor", Camp::Baron),
        ("dragon", Camp::Dragon),
        ("infernal", Camp::Dragon),
        ("ocean", Camp::Dragon),
        ("mountain", Camp::Dragon),
        ("cloud", Camp::Dragon),
        ("hextech", Camp::Dragon),
        ("elder", Camp::Dragon),
    ];
    TABLE.iter().find(|(k, _)| hay.contains(k)).map(|(_, c)| *c)
}

/// 该营地是否为「前期节奏资源」（有明确节奏意义，非补刀）。
pub fn is_objective_camp(camp: Camp) -> bool {
    matches!(camp, Camp::Dragon | Camp::Baron | Camp::RiftHerald)
}

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
        // 蓝方野区（左下）：x+y < MAP_SIZE
        assert_eq!(classify_map_zone(7800, 7900), MapZone::BlueJungle);
        // 红方野区（右上）
        assert_eq!(classify_map_zone(12000, 12200), MapZone::RedJungle);
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
        // 大小写不敏感
        assert_eq!(
            camp_of_monster(Some("dragontype"), None),
            Some(Camp::Dragon)
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
}
