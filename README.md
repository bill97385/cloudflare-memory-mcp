# Cloudflare Memory MCP Server

A cloud-based **MCP (Model Context Protocol) memory server** that lets Claude Code (or any MCP client) store and retrieve memories from anywhere. Built on Cloudflare Workers with D1 (SQLite) for storage and Vectorize + Workers AI for semantic search.

## Why

Local memory systems only work on one machine. This server runs in the cloud — add it to Claude Code on any computer and share the same memory across all devices and conversations.

## Features

- **Semantic search** — find memories by meaning, not just keywords (powered by Vectorize + Workers AI embeddings)
- **Categorized storage** — organize memories as `user`, `project`, `feedback`, `reference`, or `general`
- **Tag filtering** — tag memories and filter by tags
- **Bearer token auth** — simple API key authentication
- **Zero dependencies** — runs entirely on Cloudflare's free tier

## Architecture

```
Claude Code (any device)
    │
    │  HTTPS + Bearer Token
    ▼
Cloudflare Worker ─── MCP Protocol (Streamable HTTP / SSE)
    │
    ├── D1 (SQLite)      → structured memory storage
    ├── Vectorize         → semantic vector search
    └── Workers AI        → text embedding generation
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `memory_store` | Store a new memory with optional category and tags |
| `memory_search` | Semantic search across all memories |
| `memory_list` | List memories with category/tag filters |
| `memory_get` | Retrieve a specific memory by ID |
| `memory_update` | Update an existing memory |
| `memory_delete` | Delete a memory |

## Setup

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/cloudflare-memory-mcp.git
cd cloudflare-memory-mcp
npm install
```

### 2. Authenticate with Cloudflare

```bash
wrangler login
```

### 3. Create cloud resources

```bash
# Create D1 database
wrangler d1 create memory-mcp

# Copy the database_id from the output and update wrangler.toml

# Create Vectorize index (768 dimensions for bge-base-en-v1.5)
wrangler vectorize create memory-vectors --dimensions 768 --metric cosine
```

### 4. Update wrangler.toml

Replace `DATABASE_ID_PLACEHOLDER` with your actual D1 database ID.

### 5. Run database migration

```bash
npm run db:migrate
```

### 6. Deploy

```bash
npm run deploy
```

### 7. Set API token

```bash
# Generate a secure token
export TOKEN=$(openssl rand -hex 32)
echo "Your token: $TOKEN"

# Set it as a Worker secret
wrangler secret put API_TOKEN
# Paste your token when prompted
```

### 8. Connect Claude Code

```bash
# Streamable HTTP transport (recommended)
claude mcp add --scope user --transport http memory-mcp \
  https://memory-mcp-server.YOUR_SUBDOMAIN.workers.dev/mcp \
  --header "Authorization:Bearer YOUR_TOKEN"
```

Replace `YOUR_SUBDOMAIN` with your Cloudflare Workers subdomain and `YOUR_TOKEN` with the token from step 7.

## Usage

Once connected, Claude Code will automatically have access to the memory tools. Examples:

- **"Remember that I prefer TypeScript over JavaScript"** → `memory_store`
- **"What do you know about my preferences?"** → `memory_search`
- **"List all project memories"** → `memory_list`

## Local Development

```bash
# Create a .dev.vars file with your token
echo 'API_TOKEN=dev-token' > .dev.vars

# Run locally
npm run dev
```

## Cost

All Cloudflare services used have generous free tiers:

| Service | Free Tier |
|---------|-----------|
| Workers | 100K requests/day |
| D1 | 5M reads/day, 500MB storage |
| Vectorize | 30M queried vectors/month |
| Workers AI | 10K neurons/day |

For personal use, this should be entirely free.

## License

MIT
