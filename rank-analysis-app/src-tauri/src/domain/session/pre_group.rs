use crate::domain::session::model::{PreGroupMarker, SessionData};
use std::collections::HashMap;

/// 为 session_data 添加预组队标记
pub fn add_pre_group_markers(session_data: &mut SessionData) {
    let friend_threshold = 3;
    let team_min_sum = 2;
    let mut all_maybe_teams: Vec<Vec<String>> = Vec::new();

    let mut current_game_puuids: HashMap<String, bool> = HashMap::new();
    let subteam_puuids: Vec<Vec<String>> = session_data
        .subteams
        .iter()
        .map(|s| s.players.iter().map(|p| p.summoner.puuid.clone()).collect())
        .collect();

    for puuids in &subteam_puuids {
        for puuid in puuids {
            current_game_puuids.insert(puuid.clone(), true);
        }
    }

    for subteam in &session_data.subteams {
        for session_summoner in &subteam.players {
            let mut the_teams = Vec::new();
            if let Some(ref one_game_players_map) =
                session_summoner.user_tag.recent_data.one_game_players_map
            {
                for (puuid, play_record_arr) in one_game_players_map {
                    if !current_game_puuids.contains_key(puuid) {
                        continue;
                    }
                    let team_count = play_record_arr.iter().filter(|r| r.is_my_team).count();
                    if team_count >= friend_threshold {
                        the_teams.push(puuid.clone());
                    }
                }
            }
            if !the_teams.is_empty() {
                all_maybe_teams.push(the_teams);
            }
        }
    }

    let merged_teams = remove_subsets(&all_maybe_teams);

    let pre_group_maker_consts = [
        PreGroupMarker {
            name: "队伍1".to_string(),
            marker_type: "success".to_string(),
        },
        PreGroupMarker {
            name: "队伍2".to_string(),
            marker_type: "warning".to_string(),
        },
        PreGroupMarker {
            name: "队伍3".to_string(),
            marker_type: "error".to_string(),
        },
        PreGroupMarker {
            name: "队伍4".to_string(),
            marker_type: "info".to_string(),
        },
    ];

    let mut const_index = 0;

    for team in merged_teams {
        let mut marked = false;
        for (subteam_idx, st_puuids) in subteam_puuids.iter().enumerate() {
            let inter = intersection(&team, st_puuids);
            if inter.len() >= team_min_sum {
                for s in &mut session_data.subteams[subteam_idx].players {
                    if one_in_arr(&s.summoner.puuid, &inter) && s.pre_group_markers.name.is_empty()
                    {
                        s.pre_group_markers = pre_group_maker_consts[const_index].clone();
                        marked = true;
                    }
                }
                if marked {
                    break;
                }
            }
        }
        if marked {
            const_index += 1;
            if const_index >= pre_group_maker_consts.len() {
                break;
            }
        }
    }
}

/// 去重并保留最大范围的数组
pub fn remove_subsets(arrays: &[Vec<String>]) -> Vec<Vec<String>> {
    let mut sorted_arrays: Vec<Vec<String>> = arrays.to_vec();
    sorted_arrays.sort_by_key(|b| std::cmp::Reverse(b.len()));

    let mut result: Vec<Vec<String>> = Vec::new();
    for arr in sorted_arrays {
        let is_subset_flag = result.iter().any(|res_arr| is_subset(&arr, res_arr));

        if !is_subset_flag {
            result.push(arr);
        }
    }
    result
}

/// 判断 a 是否是 b 的子集
pub fn is_subset(a: &[String], b: &[String]) -> bool {
    if a.len() >= b.len() {
        return false;
    }
    let b_map: HashMap<&String, ()> = b.iter().map(|item| (item, ())).collect();
    a.iter().all(|item| b_map.contains_key(item))
}

/// 取两个数组的交集
pub fn intersection(arr1: &[String], arr2: &[String]) -> Vec<String> {
    let set: HashMap<&String, ()> = arr1.iter().map(|s| (s, ())).collect();
    arr2.iter()
        .filter(|s| set.contains_key(s))
        .cloned()
        .collect()
}

/// 判断元素是否在数组中
pub fn one_in_arr(e: &str, arr: &[String]) -> bool {
    arr.iter().any(|item| item == e)
}
