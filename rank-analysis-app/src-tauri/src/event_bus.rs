use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, OnceLock};
use tokio::sync::broadcast::{self, Receiver, Sender};

/// LCU 领域事件枚举
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LcuEvent {
    /// 游戏阶段变更（例如 Lobby -> Matchmaking -> ChampSelect -> InProgress -> EndOfGame）
    PhaseChanged(String),
    /// 英雄选择会话更新
    ChampSelectSession(Value),
    /// 组队房间数据更新
    LobbyUpdated(Value),
    /// Gameflow 会话更新
    GameflowSession(Value),
    /// 通用 LCU JSON API 事件
    Generic { uri: String, data: Option<Value> },
}

/// 全局广播通道容量
const EVENT_CHANNEL_CAPACITY: usize = 1024;

/// 全局事件总线单例
static GLOBAL_EVENT_BUS: OnceLock<EventBus> = OnceLock::new();

/// LCU 事件总线
#[derive(Clone)]
pub struct EventBus {
    sender: Arc<Sender<LcuEvent>>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self {
            sender: Arc::new(sender),
        }
    }

    /// 发布一个事件
    pub fn publish(&self, event: LcuEvent) {
        // 如果没有活跃的订阅者，send 会返回 Err，这是正常的
        let _ = self.sender.send(event);
    }

    /// 订阅事件流
    pub fn subscribe(&self) -> Receiver<LcuEvent> {
        self.sender.subscribe()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

/// 获取全局事件总线
pub fn event_bus() -> &'static EventBus {
    GLOBAL_EVENT_BUS.get_or_init(EventBus::new)
}

/// 便捷方法：发布事件到全局总线
pub fn publish_lcu_event(event: LcuEvent) {
    event_bus().publish(event);
}

/// 便捷方法：订阅全局总线事件
pub fn subscribe_lcu_event() -> Receiver<LcuEvent> {
    event_bus().subscribe()
}
