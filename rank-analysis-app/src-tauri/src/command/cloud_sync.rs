//! Supabase 云同步：匿名会话管理 + sync_data 表读写 + 导入导出文件 IO
//!
//! 身份模型：每台设备一个匿名 Supabase 账号，只用于写入溯源（RLS「谁写的谁能改」），
//! 不承担跨设备身份识别；跨设备找回数据按 puuid 查询所有设备的行，前端合并。
//!
//! 威胁模型（S1）：`sync_data` 按 puuid 寻址且同 puuid 的行任何人可读、
//! 任何匿名账号可插入——知道受害者 puuid（对局内队友/对手、战绩网站均可见）
//! 即可向其名下写毒行，受害者下次 `syncNow` 会拉取并合并。缓解措施：
//! - `validate_puuid` 限字符集 + 限长（堵注入与巨型 URL）；
//! - `pull_payloads` 限响应字节（堵超大 JSON 在反序列化前撑爆内存）；
//! - `push_payload` 限推送字节（超限直接拒绝，避免把本地巨表打上云端）；
//! - 前端 `mergeNotesMaps` 把每行当不可信输入做条目级校验（白名单 label、
//!   字段限长、时间戳限未来漂移、总条数熔断），毒行只计 `invalid` 不进内存；
//! - 配置走独立 LWW 通道 + 云端黑名单，备注毒行够不到 API Key（Key 根本不上云）。

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri_plugin_dialog::DialogExt;

use crate::config::{self, Value};

/// Supabase 项目地址（东南亚节点，2026-07 创建）
const SUPABASE_URL: &str = "https://agutdvbhkhxzngscdlsh.supabase.co";
/// 可公开 key（新版 publishable 格式，等价旧 anon key）——权限由服务端 RLS 兜底，
/// 硬编码提交是 Supabase 官方推荐用法，不是泄密
const SUPABASE_PUBLISHABLE_KEY: &str = "sb_publishable_ksZfyme84izJY9oTWC4VOw_l9OBXWBp";

/// 云端单次拉取响应的字节上限（5MiB）：同 puuid 的行任何匿名账号可插入，
/// 攻击者可注册大量账号塞行把响应撑到 GB 级；超限直接失败（同步报错而非 OOM），
/// 正常备注表（万条以内）远小于此值，不受影响。
/// 拉取上限：云端是「该 puuid + data_type 下所有设备的行」集合——2 台设备各推送
/// 3MB 备注时响应即达 6MB。若与推送上限同款 5MB 会对一个正常多设备用户形成
/// **拉取自锁**（永远超限 → 永远无法再取）。放宽到推送上限的 4 倍，既容纳
/// 多设备叠加，也保留 DoS 防线（攻击者塞行仍不能把响应撑到 GB 级）。
const MAX_PULL_BYTES: usize = 20 * 1024 * 1024;
/// 云端单次推送的字节上限（5MiB）：与拉取侧对齐，超限拒绝并提示用户清理备注。
const MAX_PUSH_BYTES: usize = 5 * 1024 * 1024;
/// puuid 长度上限：正常 UUID 36 字符，留余量；防巨型字符串拼进 URL/打爆查询。
/// `>=` 而非 `>`：达到上限的填充串（如 128 个 'a'）不应放行，实际 puuid 恒更短。
const MAX_PUUID_LEN: usize = 128;
/// 云端配置行可接受的最大键数：正常快照几十个键；超限说明被塞了垃圾，
/// 直接丢弃该行（防脏 payload 用巨 map 撑内存 / 借 LWW 劫持配置）。
const MAX_CLOUD_CONFIG_KEYS: usize = 500;
/// 云端时间戳允许的未来漂移（24h）：本地时钟 + LWW 都有小时级偏差，
/// 超过即视为投毒——攻击者盖 `u64::MAX` 会永久赢下 LWW，后续正常推送再也覆盖不掉。
const MAX_FUTURE_SKEW_MS: u64 = 24 * 60 * 60 * 1000;
/// 会话在 config.yaml 里的存储键（序列化为 JSON 字符串存 Value::String）
const SESSION_CONFIG_KEY: &str = "cloudSyncSession";
/// 云端备注行的数据类型标识
const DATA_TYPE_NOTES: &str = "playerNotes";
/// 云端配置行的数据类型标识
const DATA_TYPE_CONFIG: &str = "appConfig";
/// access_token 过期前多少秒就触发刷新（留网络往返余量）
const REFRESH_MARGIN_SECS: u64 = 60;

static HTTP: OnceLock<Client> = OnceLock::new();

/// 云同步专用 HTTP client：正常 TLS 校验（区别于 LCU client 的自签名豁免）
fn http() -> &'static Client {
    HTTP.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .expect("Failed to build cloud sync http client")
    })
}

/// Supabase 匿名会话（持久化到 config，跨启动复用同一账号）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CloudSession {
    access_token: String,
    refresh_token: String,
    /// Supabase 用户 UUID，即云端行的 owner_id
    user_id: String,
    /// access_token 过期时刻（unix 秒）
    expires_at: u64,
}

/// GoTrue /signup 与 /token 响应的公共字段
#[derive(Debug, Deserialize)]
struct AuthResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    user: AuthUser,
}

#[derive(Debug, Deserialize)]
struct AuthUser {
    id: String,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// access_token 是否临近过期需要刷新
fn needs_refresh(expires_at: u64, now: u64) -> bool {
    now + REFRESH_MARGIN_SECS >= expires_at
}

impl CloudSession {
    fn from_auth(resp: AuthResponse) -> Self {
        Self {
            access_token: resp.access_token,
            refresh_token: resp.refresh_token,
            user_id: resp.user.id,
            expires_at: now_unix() + resp.expires_in,
        }
    }
}

/// 从 config 读持久化会话，没有或解析失败返回 None
async fn load_session() -> Option<CloudSession> {
    match config::get_config(SESSION_CONFIG_KEY).await {
        Ok(Value::String(s)) => serde_json::from_str(&s).ok(),
        _ => None,
    }
}

/// 把会话序列化为 JSON 字符串，持久化到 config（键 [`SESSION_CONFIG_KEY`]）
async fn save_session(session: &CloudSession) -> Result<(), String> {
    let json = serde_json::to_string(session).map_err(|e| e.to_string())?;
    config::put_config(SESSION_CONFIG_KEY.to_string(), Value::String(json)).await
}

/// 匿名注册一个新 Supabase 账号
async fn sign_in_anonymously() -> Result<CloudSession, String> {
    let resp = http()
        .post(format!("{SUPABASE_URL}/auth/v1/signup"))
        .header("apikey", SUPABASE_PUBLISHABLE_KEY)
        .json(&json!({}))
        .send()
        .await
        .map_err(|e| format!("云端连接失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("匿名登录失败: HTTP {}", resp.status()));
    }
    let auth: AuthResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(CloudSession::from_auth(auth))
}

/// 用 refresh_token 换新 access_token
async fn refresh_session(refresh_token: &str) -> Result<CloudSession, String> {
    let resp = http()
        .post(format!(
            "{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token"
        ))
        .header("apikey", SUPABASE_PUBLISHABLE_KEY)
        .json(&json!({ "refresh_token": refresh_token }))
        .send()
        .await
        .map_err(|e| format!("云端连接失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("会话刷新失败: HTTP {}", resp.status()));
    }
    let auth: AuthResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(CloudSession::from_auth(auth))
}

/// 取可用会话：无会话→匿名注册；临过期→刷新；刷新失败→重新匿名注册（旧行仍可读到）
///
/// 全程持 [`SESSION_REFRESH_LOCK`] 串行：refresh_token 是**轮换式**的，并发两个
/// 请求各带同一枚旧 token 去换新时后到者必败；失败分支回退匿名注册新账号，
/// 会把数据分裂到两个 owner_id 下且旧账号从此不可写。单飞保证同一时刻至多
/// 一个刷新流程在途。
static SESSION_REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn ensure_session() -> Result<CloudSession, String> {
    let _refresh_guard = SESSION_REFRESH_LOCK.lock().await;
    let session = match load_session().await {
        Some(s) if !needs_refresh(s.expires_at, now_unix()) => return Ok(s),
        Some(s) => match refresh_session(&s.refresh_token).await {
            Ok(fresh) => fresh,
            // refresh_token 失效（被回收/项目重置）：放弃旧账号重新注册。
            // 旧账号写的行不再可写，但 select 全开放，pull 合并仍能读回其数据。
            Err(_) => sign_in_anonymously().await?,
        },
        None => sign_in_anonymously().await?,
    };
    save_session(&session).await?;
    Ok(session)
}

/// puuid 拼进 PostgREST 查询串前的校验：命令边界的不信任输入，限定 UUID 字符集防注入。
///
/// 空串必须显式拒绝——`chars().all(...)` 对空串恒真，曾放行空 puuid 读写云端
/// 以 "" 为键的共享行（所有同状态用户混写一行，跨用户数据串流）。
/// 正常路径 puuid 来自 LCU，恒为 UUID 格式，不受影响。
fn validate_puuid(puuid: &str) -> Result<(), String> {
    if puuid.is_empty()
        || puuid.len() >= MAX_PUUID_LEN
        || !puuid.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err("puuid 格式非法".to_string());
    }
    Ok(())
}

/// 拉取云端某 puuid + data_type 下所有设备的 payload 行（notes/config 共用）
async fn pull_payloads(puuid: &str, data_type: &str) -> Result<Vec<serde_json::Value>, String> {
    validate_puuid(puuid)?;
    let session = ensure_session().await?;
    let url = format!(
        "{SUPABASE_URL}/rest/v1/sync_data?puuid=eq.{puuid}&data_type=eq.{data_type}&select=payload"
    );
    let resp = http()
        .get(url)
        .header("apikey", SUPABASE_PUBLISHABLE_KEY)
        .header("Authorization", format!("Bearer {}", session.access_token))
        .send()
        .await
        .map_err(|e| format!("云端连接失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("拉取失败: HTTP {}", resp.status()));
    }
    // S1:先按字节验大小再反序列化——同 puuid 的行任何匿名账号可插入，
    // 不设上限时攻击者塞行可把响应撑到 GB 级直接 OOM。超限报同步失败而非崩溃。
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PULL_BYTES {
        return Err("云端数据过大，已拒绝合并（疑似脏数据），请稍后重试".to_string());
    }
    #[derive(Deserialize)]
    struct Row {
        payload: serde_json::Value,
    }
    let rows: Vec<Row> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|r| r.payload).collect())
}

/// 把 payload upsert 到本设备的 (owner_id, puuid, data_type) 行（notes/config 共用）
async fn push_payload(
    puuid: &str,
    data_type: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    validate_puuid(puuid)?;
    // S1:推送侧同样限字节——超限说明本地表已被毒行撑大，直接拒绝并提示清理，
    // 避免把本地巨表打上云端、让所有同 puuid 设备跟着遭殃。
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    if payload_bytes.len() > MAX_PUSH_BYTES {
        return Err("本地备注过大（>5MB），已拒绝推送，请先清理备注".to_string());
    }
    let session = ensure_session().await?;
    let url = format!("{SUPABASE_URL}/rest/v1/sync_data?on_conflict=owner_id,puuid,data_type");
    let body = json!([{
        "owner_id": session.user_id,
        "puuid": puuid,
        "data_type": data_type,
        "payload": payload,
    }]);
    let resp = http()
        .post(url)
        .header("apikey", SUPABASE_PUBLISHABLE_KEY)
        .header("Authorization", format!("Bearer {}", session.access_token))
        .header("Prefer", "resolution=merge-duplicates")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("云端连接失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("推送失败: HTTP {}", resp.status()));
    }
    Ok(())
}

/// 拉取云端某 puuid 下所有设备的备注 payload 列表（前端负责合并）
///
/// # 参数
/// - `puuid`: 召唤师 PUUID
///
/// # 返回值
/// - `Ok(Vec<Value>)`: 各设备写入的 payload 列表（可能为空）
/// - `Err(String)`: puuid 格式非法、网络失败或非 2xx 响应
#[tauri::command]
pub async fn cloud_pull_notes(puuid: String) -> Result<Vec<serde_json::Value>, String> {
    pull_payloads(&puuid, DATA_TYPE_NOTES).await
}

/// 把本设备合并后的完整备注表 upsert 到自己的行
///
/// # 参数
/// - `puuid`: 召唤师 PUUID
/// - `payload`: 合并后的完整备注 JSON
///
/// # 返回值
/// - `Ok(())`: 推送成功
/// - `Err(String)`: puuid 格式非法、网络失败或非 2xx 响应
#[tauri::command]
pub async fn cloud_push_notes(puuid: String, payload: serde_json::Value) -> Result<(), String> {
    push_payload(&puuid, DATA_TYPE_NOTES, payload).await
}

/// 云端配置行 payload:`updatedAt` 放 payload 内而非依赖数据库列,
/// 免去 sync_data 表结构迁移;毫秒时间戳由推送方(本地时钟)盖。
#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigPayload {
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
    pub config: std::collections::HashMap<String, crate::config::Value>,
}

/// 从多设备的 appConfig payload 行里挑 updatedAt 最大的一份。
///
/// 云端行任何人可写,逐行当不可信输入:反序列化失败的行直接跳过;
/// 解析成功后再按云端黑名单剔键(防脏 payload 夹带 cloudSyncSession 等)。
/// S1 加固:两条额外防线——
/// - 键数上限:正常快照几十个键,超限直接丢弃该行(防巨 map 撑内存/劫持 LWW);
/// - 时间戳未来漂移上限:攻击者盖 `u64::MAX` 会永久赢下 LWW,后续正常推送
///   再也覆盖不掉,超限行直接丢弃(本地时钟小时级偏差不受影响)。
fn pick_latest_config(rows: Vec<serde_json::Value>) -> Option<ConfigPayload> {
    let now_ms = now_unix().saturating_mul(1000);
    rows.into_iter()
        .filter_map(|v| serde_json::from_value::<ConfigPayload>(v).ok())
        .filter(|p| p.config.len() <= MAX_CLOUD_CONFIG_KEYS)
        .filter(|p| p.updated_at <= now_ms.saturating_add(MAX_FUTURE_SKEW_MS))
        .max_by_key(|p| p.updated_at)
        .map(|mut p| {
            p.config.retain(|k, _| crate::config::allowed_in_cloud(k));
            p
        })
}

/// 拉取云端最新一份配置(所有设备行中 updatedAt 最大者);云端无配置返回 None
#[tauri::command]
pub async fn cloud_pull_config(puuid: String) -> Result<Option<ConfigPayload>, String> {
    Ok(pick_latest_config(
        pull_payloads(&puuid, DATA_TYPE_CONFIG).await?,
    ))
}

/// 把本机云同步口径快照推送到本设备的 appConfig 行。
///
/// 快照在 Rust 侧现取现滤——前端无法传入自定义 payload，杜绝绕过黑名单。
/// 针对本地时钟漂移，比对云端最新时间戳取 max，确保 LWW (Last-Write-Wins) 单调递增不被误丢。
#[tauri::command]
pub async fn cloud_push_config(puuid: String) -> Result<(), String> {
    let latest_cloud_ts = cloud_pull_config(puuid.clone())
        .await
        .ok()
        .flatten()
        .map(|c| c.updated_at)
        .unwrap_or(0);
    let local_ts = now_unix() * 1000;
    let updated_at = std::cmp::max(local_ts, latest_cloud_ts.saturating_add(1000));
    let payload = ConfigPayload {
        updated_at,
        config: crate::config::config_snapshot(true).await,
    };
    push_payload(
        &puuid,
        DATA_TYPE_CONFIG,
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    )
    .await
}

/// 前端做"云端 vs 本地"内容比对用的本地快照(云同步口径,已过滤,无敏感键)
#[tauri::command]
pub async fn get_cloud_config_snapshot(
) -> Result<std::collections::HashMap<String, crate::config::Value>, String> {
    Ok(crate::config::config_snapshot(true).await)
}

/// 应用一份外来配置快照。
///
/// - `from_cloud = true`:云端拉取确认后,R01 口径拒绝 AI 端点身份键,
///   切换云配置不能改变已有 Key 的网络目的地;
/// - `from_cloud = false`:备份文件导入确认后,用户自有备份完整恢复。
#[tauri::command]
pub async fn apply_config_snapshot(
    snapshot: std::collections::HashMap<String, crate::config::Value>,
    from_cloud: bool,
) -> Result<(), String> {
    crate::config::apply_config_snapshot_map(snapshot, from_cloud).await
}

/// 导出 v2 全量备份文件:{version, type, exportedAt, playerNotes, appConfig}。
///
/// appConfig 用文件口径快照(含 dashscopeApiKey——文件由用户自己保管);
/// playerNotes 从 config 读出并解掉 `{value:...}` 包装,与前端 importNotes
/// 期望的裸 PlayerNotesMap 形状一致。
async fn build_backup_json() -> Result<String, String> {
    let notes = match crate::config::get_config("playerNotes").await? {
        crate::config::Value::Map(m) => m
            .get("value")
            .cloned()
            .unwrap_or(crate::config::Value::Map(std::collections::HashMap::new())),
        _ => crate::config::Value::Map(std::collections::HashMap::new()),
    };
    let backup = json!({
        "version": 2,
        "type": "rank-analysis-backup",
        "exportedAt": now_unix() * 1000,
        "playerNotes": notes,
        "appConfig": crate::config::config_snapshot(false).await,
    });
    serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())
}

/// 弹出系统「保存文件」对话框并把全量备份写入用户选定的路径。
///
/// 对话框在 Rust 侧执行、路径不经过 webview：此前的 `export_backup(path)`
/// 把「写任意 `.json` 路径」原语暴露给 webview，一旦被注入即可覆写其他软件的
/// 配置文件。收敛为「Rust 选路径 → Rust 写入」后，webview 只能触发、无法指认目标。
///
/// # 返回值
/// - `Ok(Some(path))`: 用户选定且已成功写入的路径（前端用于提示）
#[tauri::command]
pub async fn export_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();
    app.dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name(format!(
            "rank-analysis-backup-{}.json",
            today_iso_from_unix(now_unix())
        ))
        .save_file(move |file| {
            let _ = tx.send(file);
        });
    let picked = rx.await.map_err(|_| "文件对话框已关闭".to_string())?;
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let display = path.display().to_string();
    let content = build_backup_json().await?;
    std::fs::write(&path, content).map_err(|e| format!("写入文件失败 {display}: {e}"))?;
    Ok(Some(display))
}

/// 通用文本导出：Rust 侧弹系统保存对话框并写盘（webview 不持有裸路径，
/// 与 `export_backup` 同一安全范式）。内容由调用方给足（含 BOM 等编码前缀）。
///
/// # 参数
/// - `file_name`: 建议的默认文件名
/// - `contents`: 完整文件内容
///
/// # 返回值
/// - `Ok(Some(path))`: 用户选择路径且写入成功
/// - `Ok(None)`: 用户取消了对话框
#[tauri::command]
pub async fn save_text_file(
    app: tauri::AppHandle,
    file_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();
    app.dialog()
        .file()
        .set_file_name(file_name)
        .save_file(move |file| {
            let _ = tx.send(file);
        });
    let picked = rx.await.map_err(|_| "文件对话框已关闭".to_string())?;
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let display = path.display().to_string();
    std::fs::write(&path, contents).map_err(|e| format!("写入文件失败 {display}: {e}"))?;
    Ok(Some(display))
}

/// 备份文件大小上限（字节）：备注备份远小于此，超限说明选错了文件
const MAX_BACKUP_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// 弹出系统「打开文件」对话框并读取用户选定的备份文件内容。
///
/// 与 [`export_backup`] 同理收口路径来源：此前的 `read_text_file(path)` 是
/// 「读任意本地 `.json` 文件」原语，可与其他命令组合成读取本机敏感配置外传的
/// 攻击链；现在 webview 只能拿到用户亲手选中的那一份内容。
///
/// # 返回值
/// - `Ok(Some(content))`: 用户选定文件并成功读取
/// - `Ok(None)`: 用户取消对话框
/// - `Err(String)`: 文件过大或读取失败
#[tauri::command]
pub async fn read_backup_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();
    app.dialog()
        .file()
        .add_filter("JSON", &["json"])
        .pick_file(move |file| {
            let _ = tx.send(file);
        });
    let picked = rx.await.map_err(|_| "文件对话框已关闭".to_string())?;
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let display = path.display().to_string();
    let meta = std::fs::metadata(&path).map_err(|e| format!("读取文件失败 {display}: {e}"))?;
    if meta.len() > MAX_BACKUP_FILE_SIZE {
        return Err("文件过大（>10MB），不是备份文件".to_string());
    }
    // Some 包装与「用户取消 → Ok(None)」的返回形状对齐
    std::fs::read_to_string(&path)
        .map_err(|e| format!("读取文件失败 {display}: {e}"))
        .map(Some)
}

/// 由 Unix 秒得出 `YYYY-MM-DD`（UTC，仅用于默认导出文件名）。
///
/// 项目无 chrono 依赖，这里用 Howard Hinnant 的 civil_from_days 纯算法换算，
/// 避免为一个日期字符串引入新的依赖。
fn today_iso_from_unix(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_refresh_when_within_margin() {
        assert!(needs_refresh(100, 50)); // 50 + 60 >= 100
        assert!(needs_refresh(100, 100));
    }

    #[test]
    fn should_not_refresh_when_fresh() {
        assert!(!needs_refresh(1000, 100)); // 100 + 60 < 1000
    }

    #[test]
    fn validate_puuid_accepts_uuid_format() {
        assert!(validate_puuid("70d5f089-1234-abcd-ef00-0123456789ab").is_ok());
        assert!(validate_puuid("DEADBEEF-0000-1111-2222-333344445555").is_ok());
    }

    /// 空串对 `chars().all(...)` 恒真——曾绕过校验读写云端以 "" 为键的共享行，
    /// 造成跨用户数据串流；必须显式拒绝。
    #[test]
    fn validate_puuid_rejects_empty() {
        assert!(validate_puuid("").is_err());
    }

    #[test]
    fn validate_puuid_rejects_injection_chars() {
        assert!(validate_puuid("abc&data_type=eq.appConfig").is_err());
        assert!(validate_puuid("x'; drop table").is_err());
        assert!(validate_puuid("汉字").is_err());
    }

    #[test]
    fn validate_puuid_rejects_oversize() {
        // S1:巨型字符串不能拼进 PostgREST URL
        assert!(validate_puuid(&"a".repeat(MAX_PUUID_LEN + 1)).is_err());
        assert!(validate_puuid(&"a".repeat(MAX_PUUID_LEN)).is_err()); // 字符集也不合法
    }

    #[test]
    fn today_iso_should_render_known_dates() {
        // 2026-08-22 00:00:00 UTC = 1_787_356_800
        assert_eq!(today_iso_from_unix(1_787_356_800), "2026-08-22");
        // 1970-01-01
        assert_eq!(today_iso_from_unix(0), "1970-01-01");
        // 2000-02-29（世纪闰年）
        assert_eq!(today_iso_from_unix(951_782_400), "2000-02-29");
    }

    #[test]
    fn session_serde_roundtrip() {
        let s = CloudSession {
            access_token: "a".into(),
            refresh_token: "r".into(),
            user_id: "u".into(),
            expires_at: 42,
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: CloudSession = serde_json::from_str(&json).unwrap();
        assert_eq!(back.user_id, "u");
        assert_eq!(back.expires_at, 42);
    }

    #[test]
    fn config_payload_serde_shape() {
        // 前端按 { updatedAt, config } 读取;serde rename 必须精确
        let mut cfg = std::collections::HashMap::new();
        cfg.insert(
            "theme".to_string(),
            crate::config::Value::String("dark".into()),
        );
        let p = ConfigPayload {
            updated_at: 1_783_700_000_000,
            config: cfg,
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["updatedAt"], 1_783_700_000_000_u64);
        assert_eq!(json["config"]["theme"], "dark");
        let back: ConfigPayload = serde_json::from_value(json).unwrap();
        assert_eq!(back.updated_at, 1_783_700_000_000);
    }

    #[test]
    fn pick_latest_should_choose_max_updated_at_and_skip_malformed() {
        let rows = vec![
            serde_json::json!({ "updatedAt": 100, "config": { "theme": "light" } }),
            serde_json::json!(null),   // 云端脏数据
            serde_json::json!([1, 2]), // 云端脏数据
            serde_json::json!({ "updatedAt": 200, "config": { "theme": "dark" } }),
            serde_json::json!({ "config": {} }), // 缺 updatedAt
        ];
        let latest = pick_latest_config(rows).unwrap();
        assert_eq!(latest.updated_at, 200);
        assert!(matches!(
            latest.config.get("theme"),
            Some(crate::config::Value::String(s)) if s == "dark"
        ));
    }

    #[test]
    fn pick_latest_should_filter_cloud_blacklist_keys() {
        // 云端行任何人可写:payload 里混入黑名单键必须在解析时剔除
        // R01:ai.provider/ai.baseUrl 也不从云端取——防脏配置改走 Key 发送目标
        let rows = vec![serde_json::json!({
            "updatedAt": 1,
            "config": {
                "theme": "dark",
                "cloudSyncSession": "evil",
                "dashscopeApiKey": "sk",
                "ai.provider": "openai",
                "ai.baseUrl": "https://evil.example/v1",
                "ai.model": "deepseek-chat"
            }
        })];
        let latest = pick_latest_config(rows).unwrap();
        assert!(latest.config.contains_key("theme"));
        assert!(!latest.config.contains_key("cloudSyncSession"));
        assert!(!latest.config.contains_key("dashscopeApiKey"));
        assert!(!latest.config.contains_key("ai.provider"));
        assert!(!latest.config.contains_key("ai.baseUrl"));
        assert!(latest.config.contains_key("ai.model"));
    }

    #[test]
    fn pick_latest_should_return_none_when_all_malformed() {
        assert!(pick_latest_config(vec![serde_json::json!("junk")]).is_none());
        assert!(pick_latest_config(vec![]).is_none());
    }

    #[test]
    fn pick_latest_should_drop_oversize_config_and_future_timestamp() {
        // S1:巨 map 行直接丢弃(防撑内存/劫持 LWW)
        let mut big_config = serde_json::Map::new();
        for i in 0..(MAX_CLOUD_CONFIG_KEYS + 1) {
            big_config.insert(format!("k{i}"), serde_json::json!({"value": true}));
        }
        let rows = vec![
            serde_json::json!({ "updatedAt": 1, "config": big_config }),
            serde_json::json!({ "updatedAt": 2, "config": { "theme": "ok" } }),
        ];
        let latest = pick_latest_config(rows).unwrap();
        assert_eq!(latest.updated_at, 2);

        // S1:未来时间戳投毒行直接丢弃(攻击者盖 u64::MAX 会永久赢下 LWW)
        let now_ms = now_unix().saturating_mul(1000);
        let rows = vec![
            serde_json::json!({ "updatedAt": now_ms + MAX_FUTURE_SKEW_MS + 1, "config": { "theme": "evil" } }),
            serde_json::json!({ "updatedAt": 3, "config": { "theme": "good" } }),
        ];
        let latest = pick_latest_config(rows).unwrap();
        assert_eq!(latest.updated_at, 3);
        assert!(matches!(
            latest.config.get("theme"),
            Some(crate::config::Value::String(s)) if s == "good"
        ));
    }
}
