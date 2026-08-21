use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::watch;
use tokio::task::JoinHandle;

/// 全局自动化管理器实例
///
/// 使用 OnceLock 实现线程安全的懒加载单例模式
static AUTOMATION_MANAGER: OnceLock<AutomationManager> = OnceLock::new();

/// 获取全局自动化管理器实例
pub fn get_automation_manager() -> &'static AutomationManager {
    AUTOMATION_MANAGER.get_or_init(AutomationManager::new)
}

/// 尝试获取已初始化的全局自动化管理器实例
pub fn try_get_automation_manager() -> Option<&'static AutomationManager> {
    AUTOMATION_MANAGER.get()
}

/// 单个自动化任务的句柄和状态
#[derive(Debug)]
pub struct AutomationTask {
    /// 任务名称（用于标识和日志）
    pub _name: String,
    /// Tokio 任务句柄，用于中止任务
    pub handle: Option<JoinHandle<()>>,
    /// 关闭信号发送端，用于优雅停止任务
    pub shutdown_tx: Option<watch::Sender<bool>>,
}

/// 自动化任务管理器
///
/// 负责管理所有自动化任务的生命周期，包括：
/// - 启动新任务
/// - 停止现有任务
/// - 处理配置变更
#[derive(Debug)]
pub struct AutomationManager {
    /// 存储所有运行中的任务
    tasks: Arc<Mutex<HashMap<String, AutomationTask>>>,
}

impl Default for AutomationManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AutomationManager {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start_task(&self, name: &str, task: impl Future<Output = ()> + Send + 'static) {
        log::info!("Starting automation task: {}", name);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        let task_name = name.to_string();
        let handle = tokio::spawn(async move {
            log::info!("Task '{}' spawned and running", task_name);
            tokio::select! {
                _ = task => {
                    log::info!("Task '{}' completed", task_name);
                },
                _ = Self::wait_for_shutdown(shutdown_rx) => {
                    log::info!("Task '{}' received shutdown signal", task_name);
                }
            }
        });

        let mut tasks = self.tasks.lock().unwrap();
        if let Some(existing_task) = tasks.get_mut(name) {
            // 停止现有任务
            log::info!("Stopping existing task: {}", name);
            if let Some(tx) = existing_task.shutdown_tx.take() {
                let _ = tx.send(true);
            }
            if let Some(handle) = existing_task.handle.take() {
                handle.abort();
            }
        }

        tasks.insert(
            name.to_string(),
            AutomationTask {
                _name: name.to_string(),
                handle: Some(handle),
                shutdown_tx: Some(shutdown_tx),
            },
        );
        log::info!("Task '{}' registered successfully", name);
    }

    pub fn stop_task(&self, name: &str) {
        log::info!("Stopping automation task: {}", name);
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(task) = tasks.get_mut(name) {
            if let Some(tx) = task.shutdown_tx.take() {
                let _ = tx.send(true);
            }
            if let Some(handle) = task.handle.take() {
                handle.abort();
            }
            log::info!("Task '{}' stopped successfully", name);
        } else {
            log::warn!("Attempted to stop non-existent task: {}", name);
        }
        tasks.remove(name);
    }

    async fn wait_for_shutdown(mut shutdown_rx: watch::Receiver<bool>) {
        loop {
            if *shutdown_rx.borrow() {
                break;
            }
            if shutdown_rx.changed().await.is_err() {
                break;
            }
        }
    }
}
