# Sentinel

A flight recorder for AI agent workflows. Capture everything, observe coordination, enable checkpoints.

## Vision

When running AI agents (like Claude Code, LangChain agents, or custom implementations), you want complete observability into what they're doing:

- **What prompts are being sent?**
- **What is the agent thinking?** (via thinking blocks)
- **What decisions is it making?**
- **What files is it changing?**
- **How are multiple agents coordinating?**

Sentinel acts as a transparent proxy that captures all LLM API traffic, giving you a complete flight recorder of agent activity. Combined with optional MCP integration for semantic labeling, you get both raw data and structured understanding of agent behavior.

## Features

- **Transparent Proxy**: Zero agent modification required - just set an environment variable
- **Complete Capture**: Every prompt, response, thinking block, and tool call
- **Semantic Labeling**: Optional MCP tools for agents to add structured context (phases, decisions, checkpoints)
- **Multi-Agent Support**: Track sessions with multiple coordinating agents
- **Checkpoint/Resume**: Export conversation state to resume crashed agents
- **Queryable Storage**: SQLite-backed with filtering by agent, event type, and labels

## Quick Start

### Installation

```bash
cargo install sentinel
```

### Usage

1. Start the Sentinel proxy:

```bash
sentinel start --port 9000
```

2. Run your agent through the proxy:

```bash
# For Claude Code
ANTHROPIC_API_URL=http://localhost:9000 claude

# For other tools using the Anthropic SDK
ANTHROPIC_BASE_URL=http://localhost:9000 python your_agent.py
```

3. View captured logs:

```bash
# Recent events
sentinel logs

# Specific session
sentinel logs --session <session-id>

# Filter by event type
sentinel logs --type tool_call
```

### MCP Integration (Optional)

For semantic labeling, add Sentinel to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "sentinel": {
      "command": "sentinel",
      "args": ["mcp"]
    }
  }
}
```

This exposes tools like `sentinel_phase`, `sentinel_decision`, and `sentinel_checkpoint` that agents can use to add structured context to the flight log.

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                      Sentinel                           │
│                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │ Proxy Layer │    │ MCP Server  │    │  Storage    │ │
│  │ (capture)   │    │ (labeling)  │    │  (sqlite)   │ │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘ │
│         │                  │                  │        │
│         └──────────────────┴──────────────────┘        │
│                           │                            │
│                    ┌──────▼──────┐                     │
│                    │ Flight Log  │                     │
│                    │ (unified)   │                     │
│                    └─────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

1. **Proxy Layer**: Intercepts all LLM API calls, logs them, forwards to real API
2. **MCP Server**: Provides tools for agents to add semantic labels
3. **Storage**: SQLite database with unified event timeline
4. **Flight Log**: Queryable record of everything that happened

## Use Cases

### Debugging Agent Behavior

When an agent does something unexpected, review the exact sequence of prompts and responses to understand why.

### Audit Trail

Maintain a complete record of what agents did for compliance or accountability.

### Checkpoint/Resume

If an agent crashes mid-task, export its conversation history and resume from where it left off.

### Multi-Agent Coordination

Observe how multiple agents work together, identify bottlenecks or coordination issues.

## Configuration

Sentinel stores its data in `~/.sentinel/` by default:

- `~/.sentinel/sentinel.db` - SQLite database
- `~/.sentinel/config.toml` - Configuration (optional)

Override the data directory with `SENTINEL_DATA_DIR` environment variable.

## License

MIT
