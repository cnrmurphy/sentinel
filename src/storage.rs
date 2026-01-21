use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub seq: Option<i64>,
    pub id: Uuid,
    pub session_id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub event_type: EventType,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    Request,
    Response,
}

impl std::fmt::Display for EventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EventType::Request => write!(f, "request"),
            EventType::Response => write!(f, "response"),
        }
    }
}

impl Event {
    pub fn request(session_id: Uuid, data: serde_json::Value) -> Self {
        Self {
            seq: None,
            id: Uuid::new_v4(),
            session_id,
            timestamp: Utc::now(),
            event_type: EventType::Request,
            data,
        }
    }

    pub fn response(session_id: Uuid, data: serde_json::Value) -> Self {
        Self {
            seq: None,
            id: Uuid::new_v4(),
            session_id,
            timestamp: Utc::now(),
            event_type: EventType::Response,
            data,
        }
    }
}

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
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                id TEXT UNIQUE NOT NULL,
                session_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                event_type TEXT NOT NULL,
                data TEXT NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn insert_event(&self, event: &Event) -> Option<i64> {
        match self.insert_event_inner(event).await {
            Ok(seq) => Some(seq),
            Err(e) => {
                tracing::error!("Failed to store event: {}", e);
                None
            }
        }
    }

    async fn insert_event_inner(&self, event: &Event) -> Result<i64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            INSERT INTO events (id, session_id, timestamp, event_type, data)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(event.id.to_string())
        .bind(event.session_id.to_string())
        .bind(event.timestamp.to_rfc3339())
        .bind(event.event_type.to_string())
        .bind(event.data.to_string())
        .execute(&self.pool)
        .await?;

        Ok(result.last_insert_rowid())
    }

    pub async fn get_recent_events(
        &self,
        limit: i64,
        event_type: Option<&str>,
    ) -> Result<Vec<Event>, sqlx::Error> {
        let rows: Vec<(i64, String, String, String, String, String)> = if let Some(et) = event_type
        {
            sqlx::query_as(
                r#"
                SELECT seq, id, session_id, timestamp, event_type, data
                FROM events
                WHERE event_type = ?
                ORDER BY seq DESC
                LIMIT ?
                "#,
            )
            .bind(et)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as(
                r#"
                SELECT seq, id, session_id, timestamp, event_type, data
                FROM events
                ORDER BY seq DESC
                LIMIT ?
                "#,
            )
            .bind(limit)
            .fetch_all(&self.pool)
            .await?
        };

        let events = rows
            .into_iter()
            .filter_map(|(seq, id, session_id, timestamp, event_type, data)| {
                Some(Event {
                    seq: Some(seq),
                    id: id.parse().ok()?,
                    session_id: session_id.parse().ok()?,
                    timestamp: DateTime::parse_from_rfc3339(&timestamp)
                        .ok()?
                        .with_timezone(&Utc),
                    event_type: match event_type.as_str() {
                        "request" => EventType::Request,
                        "response" => EventType::Response,
                        _ => return None,
                    },
                    data: serde_json::from_str(&data).ok()?,
                })
            })
            .collect();

        Ok(events)
    }
}
