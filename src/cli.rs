use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use clap::{Parser, Subcommand};
use reqwest::Client;
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::info;
use uuid::Uuid;

use crate::agent::{Agent, AgentStatus, AgentStore};
use crate::event::ObservabilityEvent;
use crate::parsers::AnthropicParser;
use crate::proxy::{proxy_handler, ProxyState};
use crate::sse::sse_handler;
use crate::storage::{EventType, Storage};

#[derive(Parser)]
#[command(name = "sentinel")]
#[command(about = "Flight recorder for AI agent workflows")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the proxy server
    Start {
        /// Port to listen on
        #[arg(short, long, default_value = "9000")]
        port: u16,
    },
    /// View captured logs
    Logs {
        /// Maximum number of events to show
        #[arg(short, long, default_value = "20")]
        limit: i64,
        /// Filter by event type (request, response)
        #[arg(short = 't', long)]
        event_type: Option<String>,
        /// Show raw JSON data
        #[arg(long)]
        raw: bool,
    },
    /// List tracked agents
    Agents,
    /// Resume a Claude Code session by agent name
    Resume {
        /// Agent name (e.g., "swift-fox")
        name: String,
    },
}

pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Start { port } => {
            run_proxy(port).await?;
        }
        Commands::Logs {
            limit,
            event_type,
            raw,
        } => {
            show_logs(limit, event_type, raw).await?;
        }
        Commands::Agents => {
            show_agents().await?;
        }
        Commands::Resume { name } => {
            resume_agent(&name).await?;
        }
    }

    Ok(())
}

fn get_data_dir() -> std::path::PathBuf {
    std::env::var("SENTINEL_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .map(|h| h.join(".sentinel"))
                .unwrap_or_else(|| std::path::PathBuf::from(".sentinel"))
        })
}

async fn agents_handler(
    State(state): State<Arc<ProxyState>>,
) -> Json<Vec<Agent>> {
    match state.agent_store.list_all().await {
        Ok(agents) => Json(agents),
        Err(_) => Json(vec![]),
    }
}

async fn run_proxy(port: u16) -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();

    let data_dir = get_data_dir();
    std::fs::create_dir_all(&data_dir)?;

    let db_path = data_dir.join("sentinel.db");
    info!("Using database: {}", db_path.display());

    let storage = Storage::new(&db_path).await?;

    let agent_store = AgentStore::new(storage.pool());
    agent_store.init_schema().await?;

    let http_client = Client::new();
    let parser = Arc::new(AnthropicParser::new());

    let session_id = Uuid::new_v4();
    info!("Session ID: {}", session_id);

    let (event_broadcaster, _) = broadcast::channel::<ObservabilityEvent>(100);

    let state = Arc::new(ProxyState {
        storage,
        agent_store,
        http_client,
        session_id,
        parser,
        event_broadcaster,
    });

    // API routes must be registered before the fallback
    let app = Router::new()
        .route("/api/agents", get(agents_handler))
        .route("/api/events", get(sse_handler))
        .fallback(proxy_handler)
        .with_state(state);

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    info!("Sentinel proxy listening on http://{}", addr);
    info!(
        "Set ANTHROPIC_API_URL=http://127.0.0.1:{} to route traffic through Sentinel",
        port
    );

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn show_logs(
    limit: i64,
    event_type: Option<String>,
    raw: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = get_data_dir();
    let db_path = data_dir.join("sentinel.db");

    if !db_path.exists() {
        println!("No logs found. Run 'sentinel start' first to capture some traffic.");
        return Ok(());
    }

    let storage = Storage::new(&db_path).await?;
    let events = storage
        .get_recent_events(limit, event_type.as_deref())
        .await?;

    if events.is_empty() {
        println!("No events found.");
        return Ok(());
    }

    for event in events.iter().rev() {
        let type_indicator = match event.event_type {
            EventType::Request => "→",
            EventType::Response => "←",
        };

        println!(
            "\n{} {} [{}] {}",
            event.timestamp.format("%Y-%m-%d %H:%M:%S"),
            type_indicator,
            event.event_type,
            &event.id.to_string()[..8]
        );
        println!("  Session: {}", &event.session_id.to_string()[..8]);

        if raw {
            println!(
                "{}",
                serde_json::to_string_pretty(&event.data).unwrap_or_default()
            );
        } else {
            match event.event_type {
                EventType::Request => print_request_summary(&event.data),
                EventType::Response => print_response_summary(&event.data),
            }
        }
    }

    println!("\n({} events shown)", events.len());
    Ok(())
}

async fn show_agents() -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = get_data_dir();
    let db_path = data_dir.join("sentinel.db");

    if !db_path.exists() {
        println!("No agents found. Run 'sentinel start' first to capture some traffic.");
        return Ok(());
    }

    let storage = Storage::new(&db_path).await?;
    let agent_store = AgentStore::new(storage.pool());
    agent_store.init_schema().await?;
    let agents = agent_store.list_all().await?;

    if agents.is_empty() {
        println!("No agents tracked yet.");
        return Ok(());
    }

    println!(
        "{:<15} {:<10} {:<20} {}",
        "NAME", "STATUS", "LAST SEEN", "WORKING DIR"
    );
    println!("{}", "-".repeat(70));

    let now = chrono::Utc::now();
    let inactive_threshold = chrono::Duration::minutes(5);

    for agent in &agents {
        let working_dir = agent.working_directory.as_deref().unwrap_or("-");
        let working_dir_display = truncate_path_for_display(working_dir, 30);

        let status = if now.signed_duration_since(agent.last_seen_at) > inactive_threshold {
            AgentStatus::Inactive
        } else {
            AgentStatus::Active
        };

        println!(
            "{:<15} {:<10} {:<20} {}",
            agent.name,
            status,
            agent.last_seen_at.format("%Y-%m-%d %H:%M"),
            working_dir_display
        );
    }

    println!("\n({} agents)", agents.len());
    Ok(())
}

async fn resume_agent(name: &str) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = get_data_dir();
    let db_path = data_dir.join("sentinel.db");

    if !db_path.exists() {
        eprintln!("No agents found. Run 'sentinel start' first to capture some traffic.");
        std::process::exit(1);
    }

    let storage = Storage::new(&db_path).await?;
    let agent_store = AgentStore::new(storage.pool());
    agent_store.init_schema().await?;

    let agent = match agent_store.find_by_name(name).await? {
        Some(a) => a,
        None => {
            eprintln!("Agent '{}' not found.", name);
            eprintln!("Run 'sentinel agents' to see available agents.");
            std::process::exit(1);
        }
    };

    println!(
        "Resuming agent '{}' (session: {})",
        agent.name, agent.session_id
    );

    let status = std::process::Command::new("claude")
        .arg("--resume")
        .arg(&agent.session_id)
        .status()?;

    std::process::exit(status.code().unwrap_or(1));
}

fn truncate_path_for_display(path: &str, max_len: usize) -> String {
    if path.len() > max_len {
        let suffix_len = max_len.saturating_sub(3);
        format!("...{}", &path[path.len() - suffix_len..])
    } else {
        path.to_string()
    }
}

fn print_request_summary(data: &serde_json::Value) {
    if let Some(body) = data.get("body") {
        if let Some(model) = body.get("model") {
            println!("  Model: {}", model);
        }
        if let Some(messages) = body.get("messages").and_then(|m| m.as_array()) {
            println!("  Messages: {} message(s)", messages.len());
            if let Some(last) = messages.last() {
                if let Some(role) = last.get("role").and_then(|r| r.as_str()) {
                    println!("  Last role: {}", role);
                }
            }
        }
    }
}

fn print_response_summary(data: &serde_json::Value) {
    if data
        .get("streaming")
        .and_then(|s| s.as_bool())
        .unwrap_or(false)
    {
        println!("  [Streaming response]");
        if let Some(body) = data.get("body").and_then(|b| b.as_str()) {
            println!("  Size: {} bytes", body.len());
        }
    } else {
        if let Some(status) = data.get("status") {
            println!("  Status: {}", status);
        }
        if let Some(body) = data.get("body") {
            if let Some(usage) = body.get("usage") {
                if let (Some(input), Some(output)) = (
                    usage.get("input_tokens").and_then(|t| t.as_i64()),
                    usage.get("output_tokens").and_then(|t| t.as_i64()),
                ) {
                    println!("  Tokens: {} in / {} out", input, output);
                }
            }
            if let Some(content) = body.get("content").and_then(|c| c.as_array()) {
                for item in content {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        let preview: String = text.chars().take(80).collect();
                        let ellipsis = if text.len() > 80 { "..." } else { "" };
                        println!("  Content: {}{}", preview, ellipsis);
                    }
                }
            }
        }
    }
}
