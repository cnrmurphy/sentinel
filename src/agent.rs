//! Agent tracking and identification.
//!
//! Agents are logical entities that can span multiple sessions. Each agent
//! has a human-readable name and tracks its session history.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

/// An agent represents a logical Claude Code instance that can span multiple sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: Uuid,
    pub name: String,
    pub session_id: String,
    pub working_directory: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub status: AgentStatus,
    pub topic: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Active,
    Inactive,
}

impl std::fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentStatus::Active => write!(f, "active"),
            AgentStatus::Inactive => write!(f, "inactive"),
        }
    }
}

/// Word lists for generating human-readable names
const ADJECTIVES: &[&str] = &[
    "swift", "bright", "calm", "bold", "keen", "warm", "cool", "wild", "sage", "fair", "blue",
    "red", "green", "gold", "silver", "quiet", "quick", "brave", "wise", "kind",
];

const NOUNS: &[&str] = &[
    "fox", "owl", "wolf", "bear", "hawk", "deer", "lynx", "crow", "dove", "swan", "oak", "pine",
    "fern", "moss", "sage", "star", "moon", "wind", "rain", "snow",
];

/// Generate a human-readable name like "swift-fox" or "blue-owl"
pub fn generate_name() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let random = RandomState::new();
    let mut hasher = random.build_hasher();
    hasher.write_u128(Uuid::new_v4().as_u128());
    let hash = hasher.finish();

    let adj_idx = (hash as usize) % ADJECTIVES.len();
    let noun_idx = ((hash >> 32) as usize) % NOUNS.len();

    format!("{}-{}", ADJECTIVES[adj_idx], NOUNS[noun_idx])
}

/// Agent storage operations
#[derive(Clone)]
pub struct AgentStore {
    pool: SqlitePool,
}

impl AgentStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn init_schema(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                session_id TEXT NOT NULL,
                working_directory TEXT,
                topic TEXT,
                created_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                status TEXT NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id)
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)
            "#,
        )
        .execute(&self.pool)
        .await?;

        // Migration: add topic column if missing (existing databases)
        sqlx::query(
            r#"ALTER TABLE agents ADD COLUMN topic TEXT"#,
        )
        .execute(&self.pool)
        .await
        .ok();

        Ok(())
    }

    /// Find or create an agent for the given session ID
    pub async fn get_or_create_agent(
        &self,
        session_id: &str,
        working_directory: Option<&str>,
    ) -> Result<Agent, sqlx::Error> {
        // First, try to find existing agent by session_id
        if let Some(mut agent) = self.find_by_session_id(session_id).await? {
            // Update last_seen and status
            self.update_last_seen(&agent.id, AgentStatus::Active)
                .await?;

            // Update working directory if we have new info and agent doesn't have it yet
            if working_directory.is_some() && agent.working_directory.is_none() {
                self.update_working_directory(&agent.id, working_directory)
                    .await?;
                agent.working_directory = working_directory.map(String::from);
            }
            return Ok(agent);
        }

        // Create new agent with generated name
        let mut name = generate_name();

        // Ensure name is unique (rare collision case)
        let mut attempts = 0;
        while self.find_by_name(&name).await?.is_some() && attempts < 10 {
            name = generate_name();
            attempts += 1;
        }

        let now = Utc::now();
        let agent = Agent {
            id: Uuid::new_v4(),
            name,
            session_id: session_id.to_string(),
            working_directory: working_directory.map(String::from),
            created_at: now,
            last_seen_at: now,
            status: AgentStatus::Active,
            topic: None,
        };

        self.insert(&agent).await?;

        tracing::info!(
            "New agent '{}' created for session {}",
            agent.name,
            session_id
        );

        Ok(agent)
    }

    async fn insert(&self, agent: &Agent) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO agents (id, name, session_id, working_directory, topic, created_at, last_seen_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(agent.id.to_string())
        .bind(&agent.name)
        .bind(&agent.session_id)
        .bind(&agent.working_directory)
        .bind(&agent.topic)
        .bind(agent.created_at.to_rfc3339())
        .bind(agent.last_seen_at.to_rfc3339())
        .bind(agent.status.to_string())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn find_by_session_id(&self, session_id: &str) -> Result<Option<Agent>, sqlx::Error> {
        let row: Option<AgentRow> = sqlx::query_as(
            r#"
                SELECT id, name, session_id, working_directory, topic, created_at, last_seen_at, status
                FROM agents
                WHERE session_id = ?
                "#,
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.and_then(Self::row_to_agent))
    }

    pub async fn find_by_name(&self, name: &str) -> Result<Option<Agent>, sqlx::Error> {
        let row: Option<AgentRow> = sqlx::query_as(
            r#"
                SELECT id, name, session_id, working_directory, topic, created_at, last_seen_at, status
                FROM agents
                WHERE name = ?
                "#,
        )
        .bind(name)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.and_then(Self::row_to_agent))
    }

    pub async fn list_all(&self) -> Result<Vec<Agent>, sqlx::Error> {
        let rows: Vec<AgentRow> = sqlx::query_as(
            r#"
                SELECT id, name, session_id, working_directory, topic, created_at, last_seen_at, status
                FROM agents
                ORDER BY last_seen_at DESC
                "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().filter_map(Self::row_to_agent).collect())
    }

    async fn update_last_seen(&self, id: &Uuid, status: AgentStatus) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE agents SET last_seen_at = ?, status = ? WHERE id = ?
            "#,
        )
        .bind(Utc::now().to_rfc3339())
        .bind(status.to_string())
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn update_working_directory(
        &self,
        id: &Uuid,
        working_directory: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE agents SET working_directory = ? WHERE id = ?
            "#,
        )
        .bind(working_directory)
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Mark an agent as inactive by session_id
    pub async fn mark_inactive(&self, session_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE agents SET status = ?, last_seen_at = ? WHERE session_id = ?
            "#,
        )
        .bind(AgentStatus::Inactive.to_string())
        .bind(Utc::now().to_rfc3339())
        .bind(session_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn update_topic(&self, id: &Uuid, topic: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE agents SET topic = ? WHERE id = ?
            "#,
        )
        .bind(topic)
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    fn row_to_agent(row: AgentRow) -> Option<Agent> {
        let (id, name, session_id, working_directory, topic, created_at, last_seen_at, status) = row;
        Some(Agent {
            id: id.parse().ok()?,
            name,
            session_id,
            working_directory,
            created_at: DateTime::parse_from_rfc3339(&created_at)
                .ok()?
                .with_timezone(&Utc),
            last_seen_at: DateTime::parse_from_rfc3339(&last_seen_at)
                .ok()?
                .with_timezone(&Utc),
            status: match status.as_str() {
                "active" => AgentStatus::Active,
                "inactive" => AgentStatus::Inactive,
                _ => return None,
            },
            topic,
        })
    }
}

type AgentRow = (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    String,
    String,
    String,
);
