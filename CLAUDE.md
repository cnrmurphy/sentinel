# Sentinel — Claude Code Guidelines

## Project overview

Sentinel is an observability proxy for AI agent workflows. It sits between Claude Code and the Anthropic API, capturing request/response events into SQLite and serving them via SSE to a React frontend.

## Architecture

- `src/proxy.rs` — Axum handler that forwards requests to Anthropic, parses responses, stores events
- `src/parsers.rs` — SSE and JSON response parsing for the Anthropic API
- `src/storage.rs` — SQLite persistence for observability events
- `src/agent.rs` — Agent tracking and identification
- `src/sse.rs` — SSE endpoint for the frontend
- `src/cli.rs` — CLI entrypoint and Axum router setup
- `web/` — React frontend

## Coding standards

### Error handling

- Never silently discard errors with `.ok()` or `unwrap_or_default()` — at minimum log a warning with `tracing::warn!`
- Never use `filter_map` to skip unparseable DB rows without logging. Parse failures indicate bugs or data corruption.
- API handlers must return appropriate HTTP error codes on failure, not 200 with empty data

### Safety

- Always set a reasonable byte limit on `axum::body::to_bytes` (e.g., 10MB), never `usize::MAX`
- Never index strings by byte offset (`&s[n..]`). Use `.chars()`, `.char_indices()`, or `&s["literal".len()..]` to stay on char boundaries
- No magic numbers derived from string lengths — use `.len()` on the source string literal
- When comparing string length to a char count, be consistent: use either bytes for both or chars for both

### Database

- Use named structs with `sqlx::FromRow` for query results, not positional tuples
- Extract shared row-conversion logic into helper functions instead of duplicating closures

### Performance

- Don't `.to_vec()` a `Bytes` value — pass it directly since it's already ref-counted

### Design

- Don't introduce traits or dynamic dispatch (`dyn Trait`) until there are at least two implementations
- Prefer concrete types; extract a trait when a second provider actually exists
