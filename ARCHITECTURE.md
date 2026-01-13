# Architecture

This document describes the design decisions and architecture of Sentinel.

## Goals

1. **Capture everything**: Every prompt, response, thinking block, tool call, and file change
2. **Label semantically**: Not just raw logs, but structured understanding (phases, decisions, retries)
3. **Multi-agent observability**: Birds-eye view of how agents coordinate, their relationships, parallel work
4. **Lifecycle tracking**: Agent spawning, completion, failures, handoffs
5. **Checkpoint/resume**: Serialize enough state that a crashed agent can reconstruct its context

## Design Decisions

### Why Proxy-Based Capture?

We considered several approaches for capturing agent activity:

| Approach | Pros | Cons |
|----------|------|------|
| **SDK/Library** | Explicit semantic control | Requires agent code modification |
| **PTY/Terminal** | Captures stdout/stderr | Only sees formatted output, not raw API data |
| **Proxy** | Zero modification, sees everything | Adds network hop |

We chose **proxy-based capture** because:

1. **Zero friction**: User just sets an environment variable
2. **Complete data**: Captures the actual API payloads, not summaries
3. **Works with anything**: Claude Code, LangChain, custom agents - anything using HTTP APIs

The proxy captures:
- Full request/response JSON
- Thinking blocks (when extended thinking is enabled)
- Tool calls and results
- Token usage and timing metadata

### Why MCP for Semantic Labeling?

While the proxy captures raw data, agents can add semantic meaning via MCP tools:

```
Proxy alone:   "Agent called Edit tool on auth.rs"
With MCP:      "Phase 2: Implementing authentication - editing auth.rs"
```

MCP is ideal because:
- Claude Code already supports MCP
- Agents discover tools naturally
- No code changes - just configuration
- Optional enhancement, not required

### Why SQLite?

For local observability, SQLite is optimal:

- **Single file**: Easy to backup, share, inspect
- **No server**: Works offline, no setup
- **Queryable**: SQL for filtering and analysis
- **JSON support**: Flexible schema for event data

For team/cloud usage, PostgreSQL can be added later with the same storage trait.

## Data Model

### Core Entities

```
Session
  └── Agent (1:N)
        └── Event (1:N)
        └── Checkpoint (1:N)
```

- **Session**: A top-level run, may contain multiple agents
- **Agent**: Individual worker with identity and lifecycle
- **Event**: Timestamped entry in the flight log
- **Checkpoint**: Marked point safe to resume from

### Event Types

| Type | Description | Source |
|------|-------------|--------|
| `request` | Outgoing LLM API request | Proxy |
| `response` | Incoming LLM API response | Proxy |
| `tool_call` | Tool invocation from response | Proxy (extracted) |
| `tool_result` | Result returned for tool call | Proxy |
| `mcp_label` | Semantic label | MCP Server |
| `file_change` | File modification detected | Proxy (inferred from tool calls) |
| `agent_spawn` | New agent started | Session management |
| `agent_complete` | Agent finished | Session management |
| `error` | Error occurred | Any |

### Semantic Labels

Labels add structured meaning to events:

- `phase`: Workflow phase identifier
- `decision`: Decision point with rationale
- `checkpoint`: Safe resume point
- `retry`: Retry attempt
- `context`: Custom user-provided context

## Component Architecture

### Proxy Layer (`src/proxy/`)

```
┌──────────────────────────────────────────────┐
│                 Axum Server                   │
│  ┌─────────────┐    ┌─────────────────────┐  │
│  │   Router    │───▶│  Anthropic Handler  │  │
│  └─────────────┘    └──────────┬──────────┘  │
│                                │              │
│                     ┌──────────▼──────────┐  │
│                     │   Request Logger    │  │
│                     └──────────┬──────────┘  │
│                                │              │
│                     ┌──────────▼──────────┐  │
│                     │   HTTP Forward      │  │
│                     │   (reqwest)         │  │
│                     └──────────┬──────────┘  │
│                                │              │
│                     ┌──────────▼──────────┐  │
│                     │  Response Logger    │  │
│                     │  (streaming)        │  │
│                     └─────────────────────┘  │
└──────────────────────────────────────────────┘
```

Key responsibilities:
- Accept any Anthropic API request
- Log request before forwarding
- Forward to real API with original headers (except host)
- Stream response back while logging chunks
- Log complete response when done

### Storage Layer (`src/storage/`)

Trait-based design for future extensibility:

```rust
#[async_trait]
pub trait Storage: Send + Sync {
    async fn create_session(&self, session: &Session) -> Result<()>;
    async fn create_agent(&self, agent: &Agent) -> Result<()>;
    async fn insert_event(&self, event: &Event) -> Result<()>;
    async fn get_events(&self, filter: EventFilter) -> Result<Vec<Event>>;
    // ...
}
```

SQLite implementation handles:
- Connection pooling
- JSON serialization for flexible fields
- Migrations for schema evolution

### MCP Server (`src/mcp/`)

JSON-RPC over stdio, exposing:

```
Tools:
  - sentinel_phase(name, description)
  - sentinel_decision(choice, reasoning)
  - sentinel_checkpoint(label)
  - sentinel_context(key, value)
  - sentinel_error(error, context)
```

Each tool call writes directly to the storage layer with appropriate event type and labels.

## Resume Capability

LLM agents are essentially stateless - their "state" is the conversation history. This makes resume straightforward:

1. **Checkpoint creation**: Mark a point in the conversation as resumable
2. **Export**: Serialize the conversation up to that checkpoint
3. **Resume**: Start new agent with exported conversation as context

```bash
# Export checkpoint
sentinel export --checkpoint <id> > context.json

# Resume (implementation depends on agent)
# For custom agents: load context.json as initial messages
```

## Future Considerations

### Multi-Provider Support

The proxy can be extended to support OpenAI, Gemini, etc. Each provider gets its own handler module that normalizes to our event format.

### Web UI

A web interface could provide:
- Timeline visualization
- Agent relationship graphs
- Search and filtering
- Real-time streaming view

### Distributed Tracing

For cloud deployments, integration with OpenTelemetry could provide:
- Trace correlation across services
- Integration with existing observability stacks
- Distributed agent tracking
