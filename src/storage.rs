use chrono::{DateTime, Utc};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

use crate::event::ObservabilityEvent;

#[derive(Clone)]
pub struct Storage {
    pool: SqlitePool,
}

impl Storage {
    /// Get the underlying connection pool
    pub fn pool(&self) -> SqlitePool {
        self.pool.clone()
    }

    pub async fn new(db_path: &std::path::Path) -> Result<Self, sqlx::Error> {
        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&db_url)
            .await?;

        let storage = Self { pool };
        storage.init_schema().await?;

        Ok(storage)
    }

    async fn init_schema(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS observability_events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                id TEXT UNIQUE NOT NULL,
                timestamp TEXT NOT NULL,
                session_id TEXT,
                agent TEXT,
                payload TEXT NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_obs_events_agent ON observability_events(agent)
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn insert_observability_event(
        &self,
        event: &ObservabilityEvent,
    ) -> Result<i64, sqlx::Error> {
        let payload_json =
            serde_json::to_string(&event.payload).unwrap_or_else(|_| "{}".to_string());

        let result = sqlx::query(
            r#"
            INSERT INTO observability_events (id, timestamp, session_id, agent, payload)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(event.id.to_string())
        .bind(event.timestamp.to_rfc3339())
        .bind(event.session_id.as_ref())
        .bind(event.agent.as_ref())
        .bind(payload_json)
        .execute(&self.pool)
        .await?;

        Ok(result.last_insert_rowid())
    }

    pub async fn get_recent_observability_events(
        &self,
        limit: i64,
    ) -> Result<Vec<ObservabilityEvent>, sqlx::Error> {
        let rows: Vec<(i64, String, String, Option<String>, Option<String>, String)> =
            sqlx::query_as(
                r#"
                SELECT seq, id, timestamp, session_id, agent, payload
                FROM observability_events
                ORDER BY seq DESC
                LIMIT ?
                "#,
            )
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;

        let events = rows
            .into_iter()
            .filter_map(|(seq, id, timestamp, session_id, agent, payload)| {
                Some(ObservabilityEvent {
                    seq: Some(seq),
                    id: id.parse().ok()?,
                    timestamp: DateTime::parse_from_rfc3339(&timestamp)
                        .ok()?
                        .with_timezone(&Utc),
                    session_id,
                    agent,
                    payload: serde_json::from_str(&payload).ok()?,
                })
            })
            .collect();

        Ok(events)
    }

    pub async fn get_agent_events(
        &self,
        agent: &str,
        limit: i64,
    ) -> Result<Vec<ObservabilityEvent>, sqlx::Error> {
        let rows: Vec<(i64, String, String, Option<String>, Option<String>, String)> =
            sqlx::query_as(
                r#"
                SELECT seq, id, timestamp, session_id, agent, payload
                FROM observability_events
                WHERE agent = ?
                ORDER BY seq ASC
                LIMIT ?
                "#,
            )
            .bind(agent)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;

        let events = rows
            .into_iter()
            .filter_map(|(seq, id, timestamp, session_id, agent, payload)| {
                Some(ObservabilityEvent {
                    seq: Some(seq),
                    id: id.parse().ok()?,
                    timestamp: DateTime::parse_from_rfc3339(&timestamp)
                        .ok()?
                        .with_timezone(&Utc),
                    session_id,
                    agent,
                    payload: serde_json::from_str(&payload).ok()?,
                })
            })
            .collect();

        Ok(events)
    }
}
