interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  API_TOKEN: string;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

const SERVER_INFO = { name: "memory-mcp-server", version: "1.0.0" };

const TOOLS = [
  {
    name: "memory_store",
    description:
      "Store a new memory. Use this to save important information, user preferences, project context, decisions, or anything that should persist across conversations.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The memory content to store" },
        category: {
          type: "string",
          description: "Memory category",
          enum: ["user", "project", "feedback", "reference", "general"],
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for organizing and filtering",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_search",
    description:
      "Search memories by semantic similarity. Returns the most relevant memories matching the query meaning.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Semantic search query" },
        category: { type: "string", description: "Filter by category" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_list",
    description: "List all memories, optionally filtered by category or tag.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Filter by category" },
        tag: { type: "string", description: "Filter by tag" },
        limit: { type: "number", description: "Max results (default 20)" },
        offset: { type: "number", description: "Pagination offset" },
      },
    },
  },
  {
    name: "memory_get",
    description: "Retrieve a specific memory by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_update",
    description: "Update an existing memory by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID to update" },
        content: { type: "string", description: "New content" },
        category: { type: "string", description: "New category" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "New tags",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_delete",
    description: "Delete a memory by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID to delete" },
      },
      required: ["id"],
    },
  },
];

// =====================
// OAuth 2.0 + PKCE
// =====================

function oauthMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp"],
  };
}

async function sha256base64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function authorizeHTML(params: {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  error?: string;
}): string {
  const errorBlock = params.error
    ? `<div class="error">${params.error}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Memory MCP - Authorize</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;max-width:420px;margin:60px auto;padding:20px;background:#f5f5f5;color:#333}
.card{background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
h1{font-size:1.4em;margin:0 0 8px}
p{color:#666;font-size:.95em;margin:0 0 20px}
label{font-size:.9em;font-weight:500;display:block;margin-bottom:6px}
input[type=password]{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:1em;margin-bottom:16px}
input[type=password]:focus{outline:none;border-color:#0066cc;box-shadow:0 0 0 3px rgba(0,102,204,.15)}
button{width:100%;padding:12px;background:#0066cc;color:#fff;border:none;border-radius:6px;font-size:1em;cursor:pointer;font-weight:500}
button:hover{background:#0052a3}
.error{background:#fee;color:#c00;padding:10px;border-radius:6px;margin-bottom:16px;font-size:.9em}
.info{font-size:.8em;color:#999;margin-top:16px;text-align:center}
</style>
</head>
<body>
<div class="card">
<h1>Memory MCP Server</h1>
<p>An application is requesting access to your memory server.</p>
${errorBlock}
<form method="POST" action="/authorize">
<input type="hidden" name="client_id" value="${params.client_id}">
<input type="hidden" name="redirect_uri" value="${params.redirect_uri}">
<input type="hidden" name="state" value="${params.state}">
<input type="hidden" name="code_challenge" value="${params.code_challenge}">
<input type="hidden" name="code_challenge_method" value="${params.code_challenge_method}">
<input type="hidden" name="scope" value="${params.scope}">
<label for="token">Enter your API Token to authorize:</label>
<input type="password" id="token" name="token" placeholder="API Token" required autofocus>
<button type="submit">Authorize</button>
</form>
<div class="info">Only authorize applications you trust.</div>
</div>
</body>
</html>`;
}

function handleAuthorizeGet(url: URL): Response {
  const html = authorizeHTML({
    client_id: url.searchParams.get("client_id") || "",
    redirect_uri: url.searchParams.get("redirect_uri") || "",
    state: url.searchParams.get("state") || "",
    code_challenge: url.searchParams.get("code_challenge") || "",
    code_challenge_method: url.searchParams.get("code_challenge_method") || "",
    scope: url.searchParams.get("scope") || "",
  });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function handleAuthorizePost(
  request: Request,
  env: Env,
): Promise<Response> {
  const form = await request.formData();
  const token = (form.get("token") as string) || "";
  const client_id = (form.get("client_id") as string) || "";
  const redirect_uri = (form.get("redirect_uri") as string) || "";
  const state = (form.get("state") as string) || "";
  const code_challenge = (form.get("code_challenge") as string) || "";
  const code_challenge_method =
    (form.get("code_challenge_method") as string) || "";
  const scope = (form.get("scope") as string) || "";

  if (!redirect_uri) {
    return new Response("Missing redirect_uri", { status: 400 });
  }

  // Validate token
  if (token !== env.API_TOKEN) {
    const html = authorizeHTML({
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      scope,
      error: "Invalid API Token. Please try again.",
    });
    return new Response(html, {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Generate auth code
  const code = generateToken();
  const now = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO oauth_codes (code, client_id, redirect_uri, code_challenge, code_challenge_method, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(code, client_id, redirect_uri, code_challenge, code_challenge_method, now)
    .run();

  // Redirect back with code
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);

  return Response.redirect(redirectUrl.toString(), 302);
}

async function handleToken(request: Request, env: Env): Promise<Response> {
  const headers = { "Content-Type": "application/json", ...corsHeaders() };

  // Parse body (support both form and JSON)
  let params: Record<string, string>;
  const ct = request.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) {
    params = (await request.json()) as Record<string, string>;
  } else {
    const fd = await request.formData();
    params = {};
    fd.forEach((v, k) => {
      params[k] = v as string;
    });
  }

  const grant_type = params.grant_type;

  // Cleanup expired codes/tokens
  const now = new Date().toISOString();
  await env.DB.prepare("DELETE FROM oauth_tokens WHERE expires_at < ?")
    .bind(now)
    .run();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await env.DB.prepare("DELETE FROM oauth_codes WHERE created_at < ?")
    .bind(fiveMinAgo)
    .run();

  if (grant_type === "authorization_code") {
    const code = params.code;
    const code_verifier = params.code_verifier;

    if (!code) {
      return Response.json({ error: "invalid_request", error_description: "Missing code" }, { status: 400, headers });
    }

    // Look up code
    const stored = (await env.DB.prepare(
      "SELECT * FROM oauth_codes WHERE code = ?",
    )
      .bind(code)
      .first()) as any;

    if (!stored) {
      return Response.json({ error: "invalid_grant", error_description: "Invalid or expired code" }, { status: 400, headers });
    }

    // Delete used code immediately
    await env.DB.prepare("DELETE FROM oauth_codes WHERE code = ?")
      .bind(code)
      .run();

    // Verify PKCE if code_challenge was provided
    if (stored.code_challenge) {
      if (!code_verifier) {
        return Response.json({ error: "invalid_grant", error_description: "Missing code_verifier" }, { status: 400, headers });
      }
      const computed = await sha256base64url(code_verifier);
      if (computed !== stored.code_challenge) {
        return Response.json({ error: "invalid_grant", error_description: "Invalid code_verifier" }, { status: 400, headers });
      }
    }

    // Generate tokens
    const access_token = generateToken();
    const refresh_token = generateToken();
    const accessExpires = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString(); // 30 days
    const refreshExpires = new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000,
    ).toISOString(); // 90 days

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO oauth_tokens (token, type, client_id, created_at, expires_at) VALUES (?, 'access', ?, ?, ?)",
      ).bind(access_token, stored.client_id, now, accessExpires),
      env.DB.prepare(
        "INSERT INTO oauth_tokens (token, type, client_id, created_at, expires_at) VALUES (?, 'refresh', ?, ?, ?)",
      ).bind(refresh_token, stored.client_id, now, refreshExpires),
    ]);

    return Response.json(
      {
        access_token,
        token_type: "Bearer",
        expires_in: 30 * 24 * 60 * 60,
        refresh_token,
        scope: "mcp",
      },
      { headers },
    );
  }

  if (grant_type === "refresh_token") {
    const refresh_token = params.refresh_token;
    if (!refresh_token) {
      return Response.json({ error: "invalid_request", error_description: "Missing refresh_token" }, { status: 400, headers });
    }

    const stored = (await env.DB.prepare(
      "SELECT * FROM oauth_tokens WHERE token = ? AND type = 'refresh' AND expires_at > ?",
    )
      .bind(refresh_token, now)
      .first()) as any;

    if (!stored) {
      return Response.json({ error: "invalid_grant", error_description: "Invalid or expired refresh token" }, { status: 400, headers });
    }

    // Rotate: delete old refresh token, issue new access + refresh
    const new_access = generateToken();
    const new_refresh = generateToken();
    const accessExpires = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const refreshExpires = new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await env.DB.batch([
      env.DB.prepare("DELETE FROM oauth_tokens WHERE token = ?").bind(
        refresh_token,
      ),
      env.DB.prepare(
        "INSERT INTO oauth_tokens (token, type, client_id, created_at, expires_at) VALUES (?, 'access', ?, ?, ?)",
      ).bind(new_access, stored.client_id, now, accessExpires),
      env.DB.prepare(
        "INSERT INTO oauth_tokens (token, type, client_id, created_at, expires_at) VALUES (?, 'refresh', ?, ?, ?)",
      ).bind(new_refresh, stored.client_id, now, refreshExpires),
    ]);

    return Response.json(
      {
        access_token: new_access,
        token_type: "Bearer",
        expires_in: 30 * 24 * 60 * 60,
        refresh_token: new_refresh,
        scope: "mcp",
      },
      { headers },
    );
  }

  return Response.json(
    { error: "unsupported_grant_type" },
    { status: 400, headers },
  );
}

// Dynamic client registration (simplified - accepts any registration)
async function handleRegister(request: Request): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;
  const client_id = generateToken();
  return Response.json(
    {
      client_id,
      client_name: body.client_name || "MCP Client",
      redirect_uris: body.redirect_uris || [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers: corsHeaders() },
  );
}

// =====================
// Auth (supports both static token & OAuth)
// =====================

async function authenticate(request: Request, env: Env): Promise<boolean> {
  const auth = request.headers.get("Authorization");
  if (!auth) return false;
  const token = auth.replace("Bearer ", "");

  // Static API token (Claude Code CLI)
  if (token === env.API_TOKEN) return true;

  // OAuth access token
  const stored = await env.DB.prepare(
    "SELECT token FROM oauth_tokens WHERE token = ? AND type = 'access' AND expires_at > ?",
  )
    .bind(token, new Date().toISOString())
    .first();

  return !!stored;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// =====================
// Embedding
// =====================

async function embed(text: string, env: Env): Promise<number[]> {
  const res = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [text],
  })) as { data: number[][] };
  return res.data[0];
}

// =====================
// Tool implementations
// =====================

async function memoryStore(
  args: { content: string; category?: string; tags?: string[] },
  env: Env,
) {
  const id = crypto.randomUUID();
  const category = args.category || "general";
  const tags = JSON.stringify(args.tags || []);
  const now = new Date().toISOString();

  const embedding = await embed(args.content, env);

  await env.DB.prepare(
    "INSERT INTO memories (id, content, category, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, args.content, category, tags, now, now)
    .run();

  await env.VECTORIZE.upsert([
    { id, values: embedding, metadata: { category } },
  ]);

  return {
    content: [
      {
        type: "text",
        text: `Stored memory [${id}] in category "${category}"`,
      },
    ],
  };
}

async function memorySearch(
  args: { query: string; category?: string; limit?: number },
  env: Env,
) {
  const limit = Math.min(args.limit || 10, 50);
  const embedding = await embed(args.query, env);

  const filter: Record<string, string> = {};
  if (args.category) filter.category = args.category;

  const matches = await env.VECTORIZE.query(embedding, {
    topK: limit,
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    returnMetadata: "all",
  });

  if (!matches.matches.length) {
    return { content: [{ type: "text", text: "No memories found." }] };
  }

  const ids = matches.matches.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT * FROM memories WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all();

  const scoreMap = new Map(matches.matches.map((m) => [m.id, m.score]));

  const text = (results as any[])
    .sort((a, b) => (scoreMap.get(b.id) || 0) - (scoreMap.get(a.id) || 0))
    .map((r) => {
      const score = (scoreMap.get(r.id) || 0).toFixed(3);
      const t = JSON.parse(r.tags || "[]").join(", ") || "none";
      return `**[${r.id}]** (relevance: ${score}, category: ${r.category})\n${r.content}\nTags: ${t} | Created: ${r.created_at}`;
    })
    .join("\n\n---\n\n");

  return { content: [{ type: "text", text }] };
}

async function memoryList(
  args: { category?: string; tag?: string; limit?: number; offset?: number },
  env: Env,
) {
  const limit = Math.min(args.limit || 20, 100);
  const offset = args.offset || 0;

  let query = "SELECT * FROM memories";
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (args.category) {
    conditions.push("category = ?");
    binds.push(args.category);
  }
  if (args.tag) {
    conditions.push("tags LIKE ?");
    binds.push(`%"${args.tag}"%`);
  }

  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  binds.push(limit, offset);

  const { results } = await env.DB.prepare(query)
    .bind(...binds)
    .all();

  if (!(results as any[]).length) {
    return { content: [{ type: "text", text: "No memories found." }] };
  }

  const text = (results as any[])
    .map((r) => {
      const t = JSON.parse(r.tags || "[]").join(", ") || "none";
      return `**[${r.id}]** (${r.category})\n${r.content}\nTags: ${t} | Created: ${r.created_at}`;
    })
    .join("\n\n---\n\n");

  return { content: [{ type: "text", text }] };
}

async function memoryGet(args: { id: string }, env: Env) {
  const r = (await env.DB.prepare("SELECT * FROM memories WHERE id = ?")
    .bind(args.id)
    .first()) as any;

  if (!r) {
    return {
      content: [{ type: "text", text: `Memory [${args.id}] not found.` }],
    };
  }

  const t = JSON.parse(r.tags || "[]").join(", ") || "none";
  return {
    content: [
      {
        type: "text",
        text: `**[${r.id}]** (${r.category})\n${r.content}\nTags: ${t}\nCreated: ${r.created_at}\nUpdated: ${r.updated_at}`,
      },
    ],
  };
}

async function memoryUpdate(
  args: { id: string; content?: string; category?: string; tags?: string[] },
  env: Env,
) {
  const existing = (await env.DB.prepare(
    "SELECT * FROM memories WHERE id = ?",
  )
    .bind(args.id)
    .first()) as any;

  if (!existing) {
    return {
      content: [{ type: "text", text: `Memory [${args.id}] not found.` }],
    };
  }

  const content = args.content || existing.content;
  const category = args.category || existing.category;
  const tags = args.tags ? JSON.stringify(args.tags) : existing.tags;
  const now = new Date().toISOString();

  await env.DB.prepare(
    "UPDATE memories SET content = ?, category = ?, tags = ?, updated_at = ? WHERE id = ?",
  )
    .bind(content, category, tags, now, args.id)
    .run();

  if (args.content) {
    const embedding = await embed(content, env);
    await env.VECTORIZE.upsert([
      { id: args.id, values: embedding, metadata: { category } },
    ]);
  }

  return {
    content: [{ type: "text", text: `Updated memory [${args.id}]` }],
  };
}

async function memoryDelete(args: { id: string }, env: Env) {
  const existing = await env.DB.prepare(
    "SELECT id FROM memories WHERE id = ?",
  )
    .bind(args.id)
    .first();

  if (!existing) {
    return {
      content: [{ type: "text", text: `Memory [${args.id}] not found.` }],
    };
  }

  await env.DB.prepare("DELETE FROM memories WHERE id = ?")
    .bind(args.id)
    .run();
  await env.VECTORIZE.deleteByIds([args.id]);

  return {
    content: [{ type: "text", text: `Deleted memory [${args.id}]` }],
  };
}

// =====================
// Tool dispatcher
// =====================

async function callTool(name: string, args: Record<string, unknown>, env: Env) {
  switch (name) {
    case "memory_store":
      return memoryStore(args as any, env);
    case "memory_search":
      return memorySearch(args as any, env);
    case "memory_list":
      return memoryList(args as any, env);
    case "memory_get":
      return memoryGet(args as any, env);
    case "memory_update":
      return memoryUpdate(args as any, env);
    case "memory_delete":
      return memoryDelete(args as any, env);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// =====================
// JSON-RPC handler
// =====================

async function processRequest(
  req: JsonRpcRequest,
  env: Env,
): Promise<JsonRpcResponse | null> {
  if (req.id === undefined) return null;

  try {
    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: { tools: TOOLS },
        };

      case "tools/call": {
        const { name, arguments: toolArgs } = req.params as {
          name: string;
          arguments?: Record<string, unknown>;
        };
        const result = await callTool(name, toolArgs || {}, env);
        return { jsonrpc: "2.0", id: req.id, result };
      }

      case "ping":
        return { jsonrpc: "2.0", id: req.id, result: {} };

      default:
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32603, message },
    };
  }
}

// =====================
// Main Worker
// =====================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // --- Public endpoints (no auth) ---

    // Health check
    if (path === "/" && request.method === "GET") {
      return Response.json(
        { status: "ok", server: SERVER_INFO },
        { headers: corsHeaders() },
      );
    }

    // OAuth discovery (RFC 8414)
    if (path === "/.well-known/oauth-authorization-server" && request.method === "GET") {
      return Response.json(oauthMetadata(url.origin), { headers: corsHeaders() });
    }

    // OAuth authorize
    if (path === "/authorize" && request.method === "GET") {
      return handleAuthorizeGet(url);
    }
    if (path === "/authorize" && request.method === "POST") {
      return handleAuthorizePost(request, env);
    }

    // OAuth token
    if (path === "/token" && request.method === "POST") {
      return handleToken(request, env);
    }

    // Dynamic client registration
    if (path === "/register" && request.method === "POST") {
      return handleRegister(request);
    }

    // --- Protected endpoints (require auth) ---

    if (!(await authenticate(request, env))) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-authorization-server"`,
          ...corsHeaders(),
        },
      });
    }

    // SSE transport: endpoint discovery
    if (path === "/sse" && request.method === "GET") {
      const encoder = new TextEncoder();
      const baseUrl = url.origin;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(`event: endpoint\ndata: ${baseUrl}/message\n\n`),
          );
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          ...corsHeaders(),
        },
      });
    }

    // POST: /message (SSE), /mcp (Streamable HTTP)
    if (
      (path === "/message" || path === "/mcp") &&
      request.method === "POST"
    ) {
      const body = await request.json();

      if (Array.isArray(body)) {
        const responses = await Promise.all(
          body.map((r: JsonRpcRequest) => processRequest(r, env)),
        );
        return Response.json(responses.filter(Boolean), {
          headers: corsHeaders(),
        });
      }

      const response = await processRequest(body as JsonRpcRequest, env);
      if (!response) {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      return Response.json(response, { headers: corsHeaders() });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  },
};
