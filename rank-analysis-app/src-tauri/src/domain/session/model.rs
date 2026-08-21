use crate::command::user_tag::{OneGamePlayer, UserTag};
use crate::lcu::api::champion_select::ChampSelectView;
use crate::lcu::api::match_history::MatchHistory;
use crate::lcu::api::rank::Rank;
use crate::lcu::api::summoner::Summoner;
use serde::{Deserialize, Serialize};

/// 对局会话的完整展示数据
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub phase: String,
    #[serde(rename = "type")]
    pub queue_type: String,
    pub type_cn: String,
    pub queue_id: i32,
    pub game_mode: String,
    pub is_multi_team: bool,
    pub my_subteam_id: i32,
    pub subteams: Vec<Subteam>,
    #[serde(default)]
    pub cherry_subteams_pending: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub champ_select: Option<ChampSelectView>,
}

/// 一个小队的展示数据
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Subteam {
    pub subteam_id: i32,
    pub players: Vec<SessionSummoner>,
}

/// 会话中单名玩家的展示数据
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummoner {
    pub champion_id: i32,
    pub champion_key: String,
    pub summoner: Summoner,
    pub match_history: MatchHistory,
    pub user_tag: UserTag,
    pub rank: Rank,
    pub meet_games: Vec<OneGamePlayer>,
    #[serde(default)]
    pub meet_total: i64,
    pub pre_group_markers: PreGroupMarker,
    pub is_loading: bool,
    #[serde(default)]
    pub pick_state: String,
    #[serde(default)]
    pub assigned_position: String,
}

/// 预组队标记
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreGroupMarker {
    pub name: String,
    #[serde(rename = "type")]
    pub marker_type: String,
}
