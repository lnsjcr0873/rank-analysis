//! # 一键导入命令（M3 战场五，quick win 先行）
//!
//! 「一键导入」= 把本地历史最流行的一套**完整符文页**（或常用召唤师技能对）
//! 直接写进客户端，玩家点一下即可使用：
//!
//! - `import_rune_page`：任意时刻可用。同名页（`RA-{champion_id}`）存在则
//!   覆盖（PUT），否则新建（POST），随后切为当前页。
//! - `import_summoner_spells`：仅 champ-select 阶段可用。把本机该英雄最常
//!   用的一对技能写入我的 pick 动作（PATCH）。
//!
//! 数据源纪律：全本地（`meet_db` 收集的完整对局详情），无外部网络依赖；
//! 凑不出一套完整页/技能对时如实报错，不编造。

use crate::lcu::api::champion_select::SelectSession;
use crate::lcu::api::perks::{self, NewPerkPage};
use crate::lcu::api::summoner::Summoner;
use crate::rune_import::{most_common_perk_page, most_common_spells, AGGREGATE_LIMIT};

/// 一键导入的符文页命名前缀：`RA-{champion_id}`（如 `RA-64`）。
/// 同名页已存在时覆盖而非新建，避免无限堆页。
pub const RUNE_PAGE_PREFIX: &str = "RA-";

/// 导入结果：客户端立即可见的页信息。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRuneResult {
    pub page_id: i64,
    pub page_name: String,
    /// true = 新建；false = 覆盖已有页。
    pub created: bool,
    pub champion_id: i32,
}

/// 全部已收集对局（meet.db），按时间升序输入给聚合器。
fn collected_games() -> Vec<crate::lcu::api::match_history::Game> {
    crate::meet_db::all_collected_games()
        .into_iter()
        .flat_map(|(_region, _name, games)| games)
        .collect()
}

/// 一键导入符文页：聚合本机该英雄最流行完整页 → LCU 创建/覆盖 → 切当前页。
#[tauri::command]
pub async fn import_rune_page(champion_id: i32) -> Result<ImportRuneResult, String> {
    let my = Summoner::get_my_summoner().await?;
    let games = collected_games();
    let build = most_common_perk_page(&games, &my.puuid, champion_id, AGGREGATE_LIMIT)
        .ok_or_else(|| "本地没有该英雄的完整符文记录（需先收集过该英雄的对局详情）".to_string())?;

    let page_name = format!("{RUNE_PAGE_PREFIX}{champion_id}");
    let page = NewPerkPage {
        name: page_name.clone(),
        primary_style_id: build.primary_style_id,
        sub_style_id: build.sub_style_id,
        selected_perk_ids: build.selected_perk_ids,
        stat_perks: Some(crate::lcu::api::perks::PerkStatPerks {
            defense: build.defense,
            flex: build.flex,
            offense: build.offense,
        }),
    };

    let pages = perks::get_perk_pages().await?;
    let (page_id, created) = if let Some(existing) = perks::find_page_by_name(&pages, &page_name) {
        perks::update_perk_page(existing.id, &page).await?;
        log::info!("[import] 覆盖符文页 {} (id={})", page_name, existing.id);
        (existing.id, false)
    } else {
        let id = perks::create_perk_page(&page).await?;
        log::info!("[import] 新建符文页 {} (id={})", page_name, id);
        (id, true)
    };

    // 切当前页失败时的补偿：新建路径删除刚建的页（不留半完成状态的垃圾页）；
    // 覆盖路径不回滚——原页内容已是目标值，回滚反而需要旧值快照，且覆盖失败
    // 时原页保持原样、无脏状态。
    if let Err(e) = perks::set_current_perk_page(page_id).await {
        if created {
            log::warn!(
                "[import] 切换当前页失败，补偿删除刚新建的符文页 {} (id={}): {}",
                page_name,
                page_id,
                e
            );
            if let Err(del_err) = perks::delete_perk_page(page_id).await {
                log::error!(
                    "[import] 补偿删除失败，客户端可能残留新建的空页 {}: {}",
                    page_id,
                    del_err
                );
            }
        }
        return Err(format!("切换当前符文页失败: {e}"));
    }
    log::info!("[import] 已切换当前符文页 {} (id={})", page_name, page_id);

    Ok(ImportRuneResult {
        page_id,
        page_name,
        created,
        champion_id,
    })
}

/// 找「我」在选人会话里的 pick 动作（cellId 对齐 + 未完成 + type=pick）。
fn my_pick_action(session: &SelectSession) -> Option<&crate::lcu::api::champion_select::Action> {
    session.actions.iter().flatten().find(|a| {
        a.is_ally_action
            && a.actor_cell_id == session.local_player_cell_id
            && a.action_type == "pick"
            && !a.completed
    })
}

/// 一键导入召唤师技能：把本机该英雄最常用的一对技能写入我的选人动作。
///
/// 仅 champ-select 阶段可用；英雄未锁定（动作无英雄）时无法聚合，如实报错。
#[tauri::command]
pub async fn import_summoner_spells() -> Result<(i32, i32), String> {
    let session = crate::lcu::api::champion_select::get_champion_select_session().await?;
    let action = my_pick_action(&session)
        .ok_or_else(|| "当前不在选人阶段，或我的选人动作已完成".to_string())?;
    if action.champion_id <= 0 {
        return Err("我的英雄尚未确定，无法导入对应技能".to_string());
    }

    let my = Summoner::get_my_summoner().await?;
    let games = collected_games();
    let (spell1, spell2) =
        most_common_spells(&games, &my.puuid, action.champion_id, AGGREGATE_LIMIT)
            .ok_or_else(|| "本地没有该英雄的常用技能记录".to_string())?;

    crate::lcu::api::champion_select::patch_session_spells(action.id, spell1, spell2).await?;
    log::info!(
        "[import] 已写入技能 {spell1}/{spell2} 到动作 {}（英雄 {}）",
        action.id,
        action.champion_id
    );
    Ok((spell1, spell2))
}

/// 大乱斗自定义装备集区块。
#[derive(Debug, serde::Deserialize)]
pub struct MayhemItemSetBlock {
    pub name: String,
    pub item_ids: Vec<i64>,
}

/// 一键导入大乱斗装备页到客户端自定义装备方案。
#[tauri::command]
pub async fn import_mayhem_item_set(
    champion_id: i32,
    title: String,
    blocks: Vec<MayhemItemSetBlock>,
) -> Result<String, String> {
    let summoner_res: serde_json::Value =
        crate::lcu::util::http::lcu_get("lol-summoner/v1/current-summoner").await?;
    let account_id = summoner_res["accountId"]
        .as_i64()
        .or_else(|| summoner_res["summonerId"].as_i64())
        .ok_or_else(|| {
            "无法获取当前登录召唤师的 accountId (请确保英雄联盟客户端已启动)".to_string()
        })?;

    let set_uri = format!("lol-item-sets/v1/item-sets/{}", account_id);
    let mut current_sets: serde_json::Value = crate::lcu::util::http::lcu_get(&set_uri)
        .await
        .unwrap_or_else(|_| {
            serde_json::json!({
                "accountId": account_id,
                "itemSets": [],
                "timestamp": 0
            })
        });

    let item_sets_arr = current_sets["itemSets"]
        .as_array_mut()
        .ok_or_else(|| "LCU 装备方案数据解析异常".to_string())?;

    let new_blocks: Vec<serde_json::Value> = blocks
        .into_iter()
        .map(|b| {
            let items: Vec<serde_json::Value> = b
                .item_ids
                .into_iter()
                .filter(|id| *id > 0)
                .map(|id| {
                    serde_json::json!({
                        "id": id.to_string(),
                        "count": 1
                    })
                })
                .collect();
            serde_json::json!({
                "type": b.name,
                "items": items,
                "hideIfSummonerSpell": "",
                "showIfSummonerSpell": ""
            })
        })
        .collect();

    let set_title = format!("【大乱斗】{}", title);
    let new_set = serde_json::json!({
        "title": set_title,
        "type": "custom",
        "map": "any",
        "mode": "any",
        "priority": true,
        "sortorder": 0,
        "associatedChampions": [champion_id],
        "associatedMaps": [11, 12],
        "blocks": new_blocks
    });

    // 若已存在该英雄的大乱斗专属装备页则替换，否则新增
    if let Some(pos) = item_sets_arr.iter().position(|s| {
        s["title"]
            .as_str()
            .is_some_and(|t| t.starts_with("【大乱斗】"))
            && s["associatedChampions"]
                .as_array()
                .is_some_and(|arr| arr.iter().any(|c| c.as_i64() == Some(champion_id as i64)))
    }) {
        item_sets_arr[pos] = new_set;
    } else {
        item_sets_arr.push(new_set);
    }

    crate::lcu::util::http::lcu_put::<serde_json::Value, serde_json::Value>(
        &set_uri,
        &current_sets,
    )
    .await?;
    log::info!(
        "[import] 成功导入大乱斗装备方案: {} (champion_id={})",
        set_title,
        champion_id
    );
    Ok(set_title)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::champion_select::{Action, OnePlayer, SelectSession, Timer};

    fn empty_session(me_cell: i32) -> SelectSession {
        SelectSession {
            my_team: vec![OnePlayer {
                champion_id: 0,
                puuid: String::new(),
                obfuscated_puuid: String::new(),
                assigned_position: String::new(),
                cell_id: me_cell,
                champion_pick_intent: 0,
            }],
            their_team: vec![],
            actions: vec![],
            timer: Timer::default(),
            local_player_cell_id: me_cell,
            bench_champions: vec![],
            trades: vec![],
        }
    }

    fn pick_action(id: i32, cell: i32, champ: i32, completed: bool) -> Action {
        Action {
            id,
            actor_cell_id: cell,
            champion_id: champ,
            completed,
            is_ally_action: true,
            is_in_progress: true,
            action_type: "pick".to_string(),
        }
    }

    #[test]
    fn picks_my_unfinished_pick_action() {
        let mut s = empty_session(2);
        s.actions = vec![vec![pick_action(10, 2, 64, false)]];
        let got = my_pick_action(&s).unwrap();
        assert_eq!(got.id, 10);
        assert_eq!(got.champion_id, 64);
    }

    #[test]
    fn ignores_other_cells_and_completed_or_non_pick_actions() {
        let mut s = empty_session(0);
        s.actions = vec![vec![
            pick_action(1, 1, 64, false),
            pick_action(2, 0, 64, true),
            Action {
                action_type: "ban".to_string(),
                ..pick_action(3, 0, 64, false)
            },
        ]];
        assert!(my_pick_action(&s).is_none(), "只有我格子的未完成 pick 才算");
    }

    #[test]
    fn no_session_actions_returns_none() {
        assert!(my_pick_action(&empty_session(0)).is_none());
    }

    #[test]
    fn rune_page_name_is_prefixed_by_champion_id() {
        assert_eq!(format!("{RUNE_PAGE_PREFIX}{}", 64), "RA-64");
    }
}
