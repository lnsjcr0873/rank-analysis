use crate::config;
use crate::domain::tags::defaults::{
    get_default_tags, merge_missing_defaults, migrate_casual_ranked_only,
};
use crate::domain::tags::model::TagConfig;
use std::collections::HashMap;

/// 加载标签配置。
pub async fn load_config() -> Vec<TagConfig> {
    match config::get_config("userTags").await {
        Ok(val) => {
            let tags = config_value_to_tags(val);
            let before = tags.len();
            let mut merged = merge_missing_defaults(tags);
            let migrated = migrate_casual_ranked_only(&mut merged);
            if merged.len() != before || migrated {
                let _ = save_config(merged.clone()).await;
            }
            merged
        }
        Err(_) => {
            let defaults = get_default_tags();
            let _ = save_config(defaults.clone()).await;
            defaults
        }
    }
}

/// 保存标签配置到持久层。
pub async fn save_config(configs: Vec<TagConfig>) -> Result<(), String> {
    let val = tags_to_value(&configs);
    config::put_config("userTags".to_string(), val).await
}

/// 将标签配置列表转换为 config::Value。
pub fn tags_to_value(tags: &Vec<TagConfig>) -> config::Value {
    let json = serde_json::to_value(tags).unwrap();
    json_to_config_value(json)
}

/// 将 config::Value 转换为标签配置列表。
pub fn config_value_to_tags(v: config::Value) -> Vec<TagConfig> {
    let json = config_value_to_json(v);
    serde_json::from_value(json).unwrap_or_else(|_| get_default_tags())
}

/// 将 serde_json::Value 转换为 config::Value。
pub fn json_to_config_value(v: serde_json::Value) -> config::Value {
    match v {
        serde_json::Value::Null => config::Value::Null,
        serde_json::Value::Bool(b) => config::Value::Boolean(b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                config::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                config::Value::Float(f)
            } else {
                config::Value::Integer(0)
            }
        }
        serde_json::Value::String(s) => config::Value::String(s),
        serde_json::Value::Array(arr) => {
            config::Value::List(arr.into_iter().map(json_to_config_value).collect())
        }
        serde_json::Value::Object(map) => {
            let mut m = HashMap::new();
            for (k, v) in map {
                m.insert(k, json_to_config_value(v));
            }
            config::Value::Map(m)
        }
    }
}

/// 将 config::Value 转换为 serde_json::Value。
pub fn config_value_to_json(v: config::Value) -> serde_json::Value {
    match v {
        config::Value::Null => serde_json::Value::Null,
        config::Value::String(s) => serde_json::Value::String(s),
        config::Value::Integer(i) => serde_json::Value::Number(serde_json::Number::from(i)),
        config::Value::Float(f) => serde_json::Value::Number(
            serde_json::Number::from_f64(f).unwrap_or(serde_json::Number::from(0)),
        ),
        config::Value::Boolean(b) => serde_json::Value::Bool(b),
        config::Value::List(arr) => {
            serde_json::Value::Array(arr.into_iter().map(config_value_to_json).collect())
        }
        config::Value::Map(map) => {
            let mut m = serde_json::Map::new();
            for (k, v) in map {
                m.insert(k, config_value_to_json(v));
            }
            serde_json::Value::Object(m)
        }
    }
}
