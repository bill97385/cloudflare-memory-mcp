# Cloudflare Memory MCP Server

A cloud-based **MCP (Model Context Protocol) memory server** that gives Claude persistent, cross-device memory. Built on Cloudflare Workers (free tier).

Inspired by [MemPalace](https://github.com/milla-jovovich/mempalace) — a local AI memory system that achieved 96.6% on LongMemEval benchmarks. This project reimplements the core concept (semantic memory storage + retrieval) as a cloud-native MCP server on Cloudflare, enabling access from any device without local dependencies.

## Quick Start (Let AI Deploy For You)

Have Claude Code or any AI assistant deploy this for you. Just paste this prompt:

> I want to deploy my own cloud memory MCP server. Here's the repo: https://github.com/bill97385/cloudflare-memory-mcp
>
> Please:
> 1. Clone the repo and run `npm install`
> 2. Run `wrangler login` (I'll authenticate in the browser)
> 3. Run the deploy script: `bash deploy.sh`
> 4. Add the MCP server to my Claude Code with the token from step 3
>
> I already have a free Cloudflare account.

That's it. The `deploy.sh` script handles everything automatically.

## One-Command Deploy

If you prefer to run it yourself:

```bash
git clone https://github.com/bill97385/cloudflare-memory-mcp.git
cd cloudflare-memory-mcp
npm install
wrangler login
bash deploy.sh
```

The script will:
1. Create D1 database and Vectorize index
2. Update `wrangler.toml` with your database ID
3. Run database migrations
4. Deploy the Worker
5. Generate and set a secure API token
6. Print the `claude mcp add` command to connect

## Connect Claude Code

After deploying, run the command printed by `deploy.sh`:

```bash
claude mcp add --scope user --transport http memory-mcp \
  https://memory-mcp-server.YOUR_SUBDOMAIN.workers.dev/mcp \
  --header "Authorization:Bearer YOUR_TOKEN"
```

On additional computers, just run this same command — all devices share the same cloud memory.

## Connect claude.ai (Web)

1. Go to **claude.ai** → **Customize** → **Connectors**
2. Click **+** → **Add custom connector**
3. Enter your Worker URL with the secret path:
   ```
   https://memory-mcp-server.YOUR_SUBDOMAIN.workers.dev/s/YOUR_TOKEN/sse
   ```
4. Complete the OAuth authorization with your API token

## How Memory Works

The memory system is inspired by [MemPalace](https://github.com/milla-jovovich/mempalace)'s approach to AI memory — storing information semantically so it can be retrieved by meaning, not just keywords.

### Categories

Organize memories into 5 types (following MemPalace's structured approach):

| Category | Purpose | Example |
|----------|---------|---------|
| `user` | Who you are — role, preferences, skills | "I'm a backend engineer who prefers Go" |
| `project` | Active work, decisions, architecture | "Auth service migrating from JWT to sessions" |
| `feedback` | What to do / not do in future work | "Don't mock the DB in integration tests" |
| `reference` | Where to find things in external systems | "Bug tracker is in Linear project PLATFORM" |
| `general` | Everything else | Any uncategorized memory |

### MCP Tools

| Tool | Description |
|------|-------------|
| `memory_store` | Store a new memory with optional category and tags |
| `memory_search` | Semantic search across all memories |
| `memory_list` | List memories with category/tag filters |
| `memory_get` | Retrieve a specific memory by ID |
| `memory_update` | Update an existing memory |
| `memory_delete` | Delete a memory |

### Examples

Once connected, just talk naturally:

- **"Remember that I prefer TypeScript over JavaScript"** → stores a `user` memory
- **"What do you know about my preferences?"** → semantic search
- **"List all project memories"** → filtered list

## Architecture

```
Claude Code / claude.ai / Claude Desktop (any device)
    │
    │  HTTPS (Bearer Token / OAuth / Secret-path SSE)
    ▼
Cloudflare Worker
    │
    ├── D1 (SQLite)         → structured memory storage
    ├── Vectorize           → semantic vector search (768-dim)
    ├── Workers AI          → text embeddings (bge-base-en-v1.5)
    └── Durable Objects     → SSE session management (for claude.ai web)
```

### Three Connection Methods

| Method | Used By | Auth |
|--------|---------|------|
| Streamable HTTP (`/mcp`) | Claude Code CLI | Bearer token in header |
| OAuth 2.0 + PKCE | Standard OAuth clients | Full OAuth flow |
| Secret-path SSE (`/s/<token>/sse`) | claude.ai web | Token in URL path |

## Manual Setup (Step by Step)

If you prefer not to use `deploy.sh`:

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/): `npm install -g wrangler`

### Steps

```bash
# 1. Clone and install
git clone https://github.com/bill97385/cloudflare-memory-mcp.git
cd cloudflare-memory-mcp
npm install

# 2. Login to Cloudflare
wrangler login

# 3. Create D1 database
wrangler d1 create memory-mcp
# Copy the database_id from the output

# 4. Create Vectorize index
wrangler vectorize create memory-vectors --dimensions 768 --metric cosine

# 5. Update wrangler.toml with your database_id
# Replace DATABASE_ID_PLACEHOLDER with the actual ID

# 6. Run migration
npm run db:migrate

# 7. Deploy
npm run deploy

# 8. Set API token
export TOKEN=$(openssl rand -hex 32)
echo "Your token: $TOKEN"
echo "$TOKEN" | wrangler secret put API_TOKEN

# 9. Connect Claude Code
claude mcp add --scope user --transport http memory-mcp \
  https://memory-mcp-server.YOUR_SUBDOMAIN.workers.dev/mcp \
  --header "Authorization:Bearer $TOKEN"
```

## Local Development

```bash
echo 'API_TOKEN=dev-token' > .dev.vars
npm run dev
```

## Cost

Runs entirely on Cloudflare's free tier:

| Service | Free Tier |
|---------|-----------|
| Workers | 100K requests/day |
| D1 | 5M reads/day, 500MB storage |
| Vectorize | 30M queried vectors/month |
| Workers AI | 10K neurons/day |
| Durable Objects | 100K requests/day |

For personal use, this should cost nothing.

## Credits

- Memory architecture inspired by [MemPalace](https://github.com/milla-jovovich/mempalace) by milla-jovovich — the highest-scoring open-source AI memory system (96.6% R@5 on LongMemEval)
- Memory categories (`user`, `project`, `feedback`, `reference`, `general`) adapted from MemPalace's structured palace metaphor (wings, rooms, halls)
- Built with [Cloudflare Workers](https://workers.cloudflare.com/), [D1](https://developers.cloudflare.com/d1/), [Vectorize](https://developers.cloudflare.com/vectorize/), and [Workers AI](https://developers.cloudflare.com/workers-ai/)
- Implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) by Anthropic

## License

MIT
