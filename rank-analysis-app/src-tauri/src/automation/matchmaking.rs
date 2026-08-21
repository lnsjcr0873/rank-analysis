use std::time::Duration;
use tokio::time::interval;

use crate::constant::game::{LOBBY, MATCHMAKING, READYCHECK};
use crate::lcu::api::champion_select::post_accept_match;
use crate::lcu::api::lobby::Lobby;
use crate::lcu::api::phase::get_phase;

/// 自动接受匹配任务。
///
/// 每 100 毫秒检测一次游戏阶段，当检测到 "ReadyCheck" 阶段时自动接受匹配。
pub async fn start_accept_match_automation() {
    log::info!("Starting accept match automation");
    let mut ticker = interval(Duration::from_millis(100));

    loop {
        ticker.tick().await;

        match get_phase().await {
            Ok(phase) if phase == READYCHECK => {
                log::info!("Ready check detected, accepting match");
                if let Err(e) = post_accept_match().await {
                    log::error!("Accept match error: {}", e);
                }
            }
            Err(e) => {
                log::error!("Get phase error: {}", e);
            }
            _ => {}
        }
    }
}

/// 自动开始匹配任务。
///
/// 当玩家处于大厅且是房主时，自动开始寻找对局。
pub async fn start_match_automation() {
    log::info!("Starting match automation");
    let mut ticker = interval(Duration::from_secs(1));
    let mut last_search_state = String::new();
    let mut auto_match_enabled = true;

    loop {
        ticker.tick().await;

        let cur_state = match get_phase().await {
            Ok(state) => {
                let trimmed = state.trim().to_string();
                if state != trimmed {
                    log::warn!(
                        "Phase string had whitespace! Original: {:?}, Trimmed: {:?}",
                        state,
                        trimmed
                    );
                }
                log::debug!("Current phase: {:?} (len={})", trimmed, trimmed.len());
                trimmed
            }
            Err(e) => {
                log::error!("Get phase error: {}", e);
                continue;
            }
        };

        // 如果状态没变，跳过本次循环
        if last_search_state == cur_state {
            log::debug!("State not changed: '{}'", cur_state);
            continue;
        }

        // 调试：显示详细的状态变化信息
        if log::log_enabled!(log::Level::Debug) {
            log::debug!(
                "State changed: '{}' (len={}) -> '{}' (len={})",
                last_search_state,
                last_search_state.len(),
                cur_state,
                cur_state.len()
            );
        } else {
            log::info!("State changed: '{}' -> '{}'", last_search_state, cur_state);
        }

        // 从匹配状态变回大厅状态，说明取消了匹配
        if last_search_state == MATCHMAKING && cur_state == LOBBY {
            log::info!("Match cancelled, disabling auto-match");
            auto_match_enabled = false;
            last_search_state = cur_state;
            continue;
        }

        // 恢复自动匹配状态
        if !auto_match_enabled && cur_state != LOBBY {
            log::info!("Re-enabling auto-match");
            auto_match_enabled = true;
            last_search_state = cur_state;
            continue;
        }

        // 检查是否开启自动匹配
        if !auto_match_enabled {
            log::info!(
                "Auto-match is disabled, skipping, last_search_state: {}, cur_state: {}",
                last_search_state,
                cur_state
            );
            last_search_state = cur_state;
            continue;
        }

        last_search_state = cur_state.clone();

        // 检查当前游戏阶段
        if cur_state != LOBBY {
            log::warn!(
                "Not in lobby, skipping. cur_state: {:?} (len={}), LOBBY constant: {:?} (len={}), equal: {}",
                cur_state, cur_state.len(),
                LOBBY, LOBBY.len(),
                cur_state == LOBBY
            );
            continue;
        }

        // 获取房间信息
        let lobby = match Lobby::get_lobby().await {
            Ok(lobby) => lobby,
            Err(e) => {
                log::error!("Get lobby error: {}", e);
                continue;
            }
        };

        // 检查是否是自定义游戏
        if lobby.game_config.is_custom {
            log::info!(
                "Is custom game, skipping, last_search_state: {}, cur_state: {}",
                last_search_state,
                cur_state
            );
            continue;
        }

        // 检查是否是房主
        match is_leader(&lobby.members).await {
            Ok(true) => {
                log::info!("I am the leader, starting match search");
            }
            Ok(false) => {
                log::debug!("Not the leader, skipping match search");
                continue;
            }
            Err(e) => {
                log::error!("Failed to check leader status: {}", e);
                continue;
            }
        }

        // 开始匹配
        log::info!("Starting match search");
        if let Err(e) = Lobby::post_match_search().await {
            log::error!("Start match search error: {}", e);
        }

        // 等待6秒钟
        tokio::time::sleep(Duration::from_secs(6)).await;
    }
}

/// 判断当前用户是否是房主。
pub async fn is_leader(members: &[crate::lcu::api::lobby::Member]) -> Result<bool, String> {
    use crate::lcu::api::summoner::Summoner;

    let my_summoner = Summoner::get_my_summoner().await?;
    let my_puuid = &my_summoner.puuid;

    log::debug!("My PUUID: {}", my_puuid);

    let am_leader = members.iter().any(|member| {
        let is_me_and_leader = member.puuid == *my_puuid && member.is_leader;
        if member.puuid == *my_puuid {
            log::debug!("Found myself in members, is_leader: {}", member.is_leader);
        }
        is_me_and_leader
    });

    Ok(am_leader)
}
