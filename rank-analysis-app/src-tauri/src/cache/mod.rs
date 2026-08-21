//! # 通用缓存抽象模块 (CacheManager)
//!
//! 提供基于 Moka 的内存缓存和带有磁盘回退的统一缓存管理接口。

use moka::future::Cache;
use std::hash::Hash;
use std::sync::Arc;
use std::time::Duration;

/// 缓存构建配置选项
#[derive(Debug, Clone)]
pub struct CacheOptions {
    pub max_capacity: Option<u64>,
    pub ttl: Option<Duration>,
    pub tti: Option<Duration>,
}

impl Default for CacheOptions {
    fn default() -> Self {
        Self {
            max_capacity: Some(1000),
            ttl: Some(Duration::from_secs(3600)),
            tti: None,
        }
    }
}

/// 泛型内存缓存管理器
#[derive(Clone)]
pub struct CacheManager<K, V>
where
    K: Hash + Eq + Send + Sync + 'static + Clone,
    V: Clone + Send + Sync + 'static,
{
    inner: Arc<Cache<K, V>>,
}

impl<K, V> CacheManager<K, V>
where
    K: Hash + Eq + Send + Sync + 'static + Clone,
    V: Clone + Send + Sync + 'static,
{
    /// 创建默认配置的缓存
    pub fn new() -> Self {
        Self::with_options(CacheOptions::default())
    }

    /// 使用自定义选项创建缓存
    pub fn with_options(options: CacheOptions) -> Self {
        let mut builder = Cache::builder();
        if let Some(cap) = options.max_capacity {
            builder = builder.max_capacity(cap);
        }
        if let Some(ttl) = options.ttl {
            builder = builder.time_to_live(ttl);
        }
        if let Some(tti) = options.tti {
            builder = builder.time_to_idle(tti);
        }
        Self {
            inner: Arc::new(builder.build()),
        }
    }

    /// 获取缓存值
    pub async fn get(&self, key: &K) -> Option<V> {
        self.inner.get(key).await
    }

    /// 插入缓存
    pub async fn insert(&self, key: K, value: V) {
        self.inner.insert(key, value).await;
    }

    /// 移除指定键
    pub async fn remove(&self, key: &K) -> Option<V> {
        self.inner.remove(key).await
    }

    /// 清空所有缓存
    pub async fn clear(&self) {
        self.inner.invalidate_all();
    }

    /// 获取当前条目数估计值
    pub fn entry_count(&self) -> u64 {
        self.inner.entry_count()
    }

    /// 获取或通过计算闭包填充
    pub async fn get_or_insert_with<F, Fut>(&self, key: K, init: F) -> V
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = V>,
    {
        if let Some(val) = self.get(&key).await {
            return val;
        }
        let val = init().await;
        self.insert(key, val.clone()).await;
        val
    }
}

impl<K, V> Default for CacheManager<K, V>
where
    K: Hash + Eq + Send + Sync + 'static + Clone,
    V: Clone + Send + Sync + 'static,
{
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cache_manager_basic_crud() {
        let cache: CacheManager<String, i32> = CacheManager::new();
        assert_eq!(cache.get(&"a".to_string()).await, None);

        cache.insert("a".to_string(), 42).await;
        assert_eq!(cache.get(&"a".to_string()).await, Some(42));

        let removed = cache.remove(&"a".to_string()).await;
        assert_eq!(removed, Some(42));
        assert_eq!(cache.get(&"a".to_string()).await, None);
    }

    #[tokio::test]
    async fn cache_manager_get_or_insert() {
        let cache: CacheManager<String, String> = CacheManager::new();
        let value = cache
            .get_or_insert_with("key1".to_string(), || async { "computed".to_string() })
            .await;
        assert_eq!(value, "computed");
        assert_eq!(
            cache.get(&"key1".to_string()).await,
            Some("computed".to_string())
        );
    }
}
