use serde::{Deserialize, Serialize};

/// 比较运算符枚举。
///
/// 用于历史数据筛选中的数值比较。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum Operator {
    #[serde(rename = ">")]
    Gt,
    #[serde(rename = ">=")]
    Gte,
    #[serde(rename = "<")]
    Lt,
    #[serde(rename = "<=")]
    Lte,
    #[serde(rename = "==")]
    Eq,
    #[serde(rename = "!=")]
    Neq,
}

impl Operator {
    /// 执行数值比较。
    pub fn check(&self, a: f64, b: f64) -> bool {
        match self {
            Operator::Gt => a > b,
            Operator::Gte => a >= b,
            Operator::Lt => a < b,
            Operator::Lte => a <= b,
            Operator::Eq => (a - b).abs() < 0.001,
            Operator::Neq => (a - b).abs() >= 0.001,
        }
    }
}

/// 对局筛选条件。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MatchFilter {
    /// 队列模式筛选
    Queue { ids: Vec<i32> },
    /// 英雄筛选
    Champion { ids: Vec<i32> },
    /// 统计数据筛选
    Stat {
        metric: String,
        op: Operator,
        value: f64,
    },
    /// 只取最近 N 场
    Recent { count: i32 },
}

/// 历史数据刷新（统计）条件。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum MatchRefresh {
    Count {
        op: Operator,
        value: f64,
    },
    Average {
        metric: String,
        op: Operator,
        value: f64,
    },
    Sum {
        metric: String,
        op: Operator,
        value: f64,
    },
    Max {
        metric: String,
        op: Operator,
        value: f64,
    },
    Min {
        metric: String,
        op: Operator,
        value: f64,
    },
    Streak {
        min: i32,
        kind: StreakType,
    },
    DistinctChampions {
        op: Operator,
        value: f64,
    },
    Ratio {
        metric: String,
        #[serde(rename = "gameOp")]
        game_op: Operator,
        #[serde(rename = "gameValue")]
        game_value: f64,
        op: Operator,
        value: f64,
    },
}

/// 连胜/连败类型。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum StreakType {
    Win,
    Loss,
}

/// 标签条件树节点。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum TagCondition {
    And {
        conditions: Vec<TagCondition>,
    },
    Or {
        conditions: Vec<TagCondition>,
    },
    Not {
        condition: Box<TagCondition>,
    },
    History {
        filters: Vec<MatchFilter>,
        refresh: MatchRefresh,
    },
    CurrentQueue {
        ids: Vec<i32>,
    },
    CurrentChampion {
        ids: Vec<i32>,
    },
}

/// 用户标签配置。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagConfig {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub good: bool,
    pub enabled: bool,
    #[serde(default)]
    pub is_default: bool,
    pub condition: TagCondition,
}
