interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  API_TOKEN: string;
  MCP_SESSION: DurableObjectNamespace;
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

const SERVER_INFO = { name: "memory-mcp-server", version: "2.0.0" };
const HALLS = ["facts", "events", "discoveries", "preferences", "advice"] as const;
const WING_TYPES = ["person", "project"] as const;
const ACCESS_TOKEN_TTL_S = 30 * 24 * 60 * 60;
const REFRESH_TOKEN_TTL_S = 90 * 24 * 60 * 60;
const SSE_KEEPALIVE_MS = 15000;
const encoder = new TextEncoder();

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  ...CORS_HEADERS,
};

const TOOLS = [
  {
    name: "memory_store",
    description:
      "Store a new memory in the palace. Optionally place it in a wing (person/project), room (topic), and hall (memory type). Wings and rooms are auto-created if they don't exist.",
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
        wing: { type: "string", description: "Wing name (person or project). Auto-created if new." },
        wing_type: { type: "string", description: "Wing type (only needed when creating new wing)", enum: ["person", "project"] },
        room: { type: "string", description: "Room name (topic within wing). Auto-created if new. Requires wing." },
        hall: {
          type: "string",
          description: "Hall type: facts (decisions), events (milestones), discoveries (insights), preferences (habits), advice (recommendations)",
          enum: ["facts", "events", "discoveries", "preferences", "advice"],
        },
        importance: { type: "number", description: "Importance 0-10 for wake-up context priority (default 0)" },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_search",
    description:
      "Search memories by semantic similarity. Can filter by wing, room, hall, or category.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Semantic search query" },
        category: { type: "string", description: "Filter by category" },
        wing: { type: "string", description: "Filter by wing name" },
        room: { type: "string", description: "Filter by room name" },
        hall: { type: "string", description: "Filter by hall type" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_list",
    description: "List memories with optional filters for category, tag, wing, room, or hall.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Filter by category" },
        tag: { type: "string", description: "Filter by tag" },
        wing: { type: "string", description: "Filter by wing name" },
        room: { type: "string", description: "Filter by room name" },
        hall: { type: "string", description: "Filter by hall type" },
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
    description: "Update an existing memory. Can change content, category, tags, palace location, hall, or importance.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID to update" },
        content: { type: "string", description: "New content" },
        category: { type: "string", description: "New category" },
        tags: { type: "array", items: { type: "string" }, description: "New tags" },
        wing: { type: "string", description: "Move to wing (auto-created if new)" },
        room: { type: "string", description: "Move to room (auto-created if new, requires wing)" },
        hall: { type: "string", description: "Change hall type", enum: ["facts", "events", "discoveries", "preferences", "advice"] },
        importance: { type: "number", description: "Set importance 0-10" },
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
  {
    name: "palace_overview",
    description: "Show the full memory palace structure: wings, rooms, halls, tunnels, and memory counts. Use this to understand the organization of all stored memories.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "palace_manage",
    description: "Manage palace structure: create/delete wings, rooms, or tunnels (cross-references between rooms).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Action to perform",
          enum: ["create_wing", "create_room", "create_tunnel", "delete_wing", "delete_room", "delete_tunnel"],
        },
        wing: { type: "string", description: "Wing name (for create/delete wing or room)" },
        wing_type: { type: "string", description: "Wing type (for create_wing)", enum: ["person", "project"] },
        room: { type: "string", description: "Room name (for create/delete room)" },
        description: { type: "string", description: "Description for the wing, room, or tunnel" },
        room_a: { type: "string", description: "First room (format: 'wing/room') for tunnel" },
        room_b: { type: "string", description: "Second room (format: 'wing/room') for tunnel" },
        id: { type: "string", description: "ID for delete operations" },
      },
      required: ["action"],
    },
  },
  {
    name: "closet_create",
    description: "Create a closet — a summary memory that points to original source memories. Useful for condensing multiple related memories into one overview.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Summary content" },
        source_ids: { type: "array", items: { type: "string" }, description: "Array of memory IDs being summarized" },
        wing: { type: "string", description: "Wing name" },
        room: { type: "string", description: "Room name" },
        hall: { type: "string", description: "Hall type", enum: ["facts", "events", "discoveries", "preferences", "advice"] },
        tags: { type: "array", items: { type: "string" }, description: "Tags" },
      },
      required: ["content", "source_ids"],
    },
  },
  {
    name: "wakeup_context",
    description: "Get the most important memories for session start. Returns high-importance memories across all wings, providing essential context to resume work effectively.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max memories to return (default 10)" },
      },
    },
  },
];

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

function clampImportance(v?: number): number {
  return Math.min(Math.max(v || 0, 0), 10);
}

function validateHall(hall?: string): string {
  if (hall && !(HALLS as readonly string[]).includes(hall)) return "facts";
  return hall || "facts";
}

function formatMemory(r: any, extra?: string): string {
  const tags = JSON.parse(r.tags || "[]").join(", ") || "none";
  const parts = [extra, r.category, r.hall].filter(Boolean).join(", ");
  const location = [r.wing_name, r.room_name].filter(Boolean).join("/");
  const closetFlag = r.is_closet ? " [closet]" : "";
  const impFlag = r.importance > 0 ? ` imp:${r.importance}` : "";
  let text = `**[${r.id}]** (${parts}${closetFlag}${impFlag})`;
  if (location) text += ` 📍${location}`;
  text += `\n${r.content}\nTags: ${tags} | Created: ${r.created_at}`;
  if (r.updated_at && r.updated_at !== r.created_at) {
    text += `\nUpdated: ${r.updated_at}`;
  }
  return text;
}

function formatMemoryResults(results: any[], header?: string): string {
  if (!results.length) return "No memories found.";
  const body = results.map((r) => formatMemory(r)).join("\n\n---\n\n");
  return header ? `${header}\n\n${body}` : body;
}

async function resolveWingRoom(
  env: Env,
  wingName?: string,
  roomName?: string,
  wingType?: string,
  description?: string,
): Promise<{ wingId: string | null; roomId: string | null; created: boolean }> {
  if (!wingName) return { wingId: null, roomId: null, created: false };

  let created = false;
  let wing = (await env.DB.prepare("SELECT id FROM wings WHERE name = ?")
    .bind(wingName).first()) as any;
  if (!wing) {
    const wingId = crypto.randomUUID();
    const wType = (WING_TYPES as readonly string[]).includes(wingType || "") ? wingType : "project";
    await env.DB.prepare(
      "INSERT INTO wings (id, name, type, description, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(wingId, wingName, wType, description || null, new Date().toISOString()).run();
    wing = { id: wingId };
    created = true;
  }

  if (!roomName) return { wingId: wing.id, roomId: null, created };

  let room = (await env.DB.prepare(
    "SELECT id FROM rooms WHERE wing_id = ? AND name = ?",
  ).bind(wing.id, roomName).first()) as any;
  if (!room) {
    const roomId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO rooms (id, wing_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(roomId, wing.id, roomName, description || null, new Date().toISOString()).run();
    room = { id: roomId };
    created = true;
  }

  return { wingId: wing.id, roomId: room.id, created };
}

const MEMORY_SELECT = `SELECT m.*, w.name as wing_name, r.name as room_name
  FROM memories m
  LEFT JOIN wings w ON m.wing_id = w.id
  LEFT JOIN rooms r ON m.room_id = r.id`;

async function deleteEntity(env: Env, table: string, where: string, bind: string) {
  const result = await env.DB.prepare(`DELETE FROM ${table} WHERE ${where}`).bind(bind).run();
  const label = table.replace(/s$/, "");
  return result.meta.changes ? textResult(`Deleted ${label}.`) : textResult(`${label} not found.`);
}

function addPalaceFilters(
  conditions: string[],
  binds: unknown[],
  args: { wing?: string; room?: string; hall?: string },
) {
  if (args.wing) { conditions.push("w.name = ?"); binds.push(args.wing); }
  if (args.room) { conditions.push("r.name = ?"); binds.push(args.room); }
  if (args.hall) { conditions.push("m.hall = ?"); binds.push(args.hall); }
}

function createSseStream(
  endpointUrl: string,
  onController?: (c: ReadableStreamDefaultController<Uint8Array>) => void,
  onCleanup?: () => void,
): ReadableStream<Uint8Array> {
  let keepAlive: ReturnType<typeof setInterval>;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      onController?.(controller);
      controller.enqueue(
        encoder.encode(`event: endpoint\ndata: ${endpointUrl}\n\n`),
      );
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepAlive);
          onCleanup?.();
        }
      }, SSE_KEEPALIVE_MS);
    },
    cancel() {
      clearInterval(keepAlive);
      onCleanup?.();
    },
  });
}

async function handleJsonRpcPost(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await request.json();
  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((r: JsonRpcRequest) => processRequest(r, env)),
    );
    return Response.json(responses.filter(Boolean), { headers: CORS_HEADERS });
  }
  const response = await processRequest(body as JsonRpcRequest, env);
  if (!response) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return Response.json(response, { headers: CORS_HEADERS });
}

function parseBearer(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

// --- OAuth 2.0 + PKCE ---

function protectedResourceMetadata(origin: string) {
  return {
    resource: origin,
    authorization_servers: [origin],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
  };
}

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
  const data = encoder.encode(input);
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

  const code = generateToken();
  const now = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO oauth_codes (code, client_id, redirect_uri, code_challenge, code_challenge_method, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(code, client_id, redirect_uri, code_challenge, code_challenge_method, now)
    .run();

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);

  return Response.redirect(redirectUrl.toString(), 302);
}

async function issueTokenPair(
  env: Env,
  clientId: string,
  extraStatements: D1PreparedStatement[] = [],
): Promise<Response> {
  const access_token = generateToken();
  const refresh_token = generateToken();
  const now = new Date().toISOString();
  const accessExpires = new Date(
    Date.now() + ACCESS_TOKEN_TTL_S * 1000,
  ).toISOString();
  const refreshExpires = new Date(
    Date.now() + REFRESH_TOKEN_TTL_S * 1000,
  ).toISOString();

  await env.DB.batch([
    ...extraStatements,
    env.DB.prepare(
      "INSERT INTO oauth_tokens (token, type, client_id, created_at, expires_at) VALUES (?, 'access', ?, ?, ?)",
    ).bind(access_token, clientId, now, accessExpires),
    env.DB.prepare(
      "INSERT INTO oauth_tokens (token, type, client_id, created_at, expires_at) VALUES (?, 'refresh', ?, ?, ?)",
    ).bind(refresh_token, clientId, now, refreshExpires),
  ]);

  return Response.json(
    {
      access_token,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token,
      scope: "mcp",
    },
    { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
  );
}

async function handleToken(request: Request, env: Env): Promise<Response> {
  const errorHeaders = { "Content-Type": "application/json", ...CORS_HEADERS };

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
  const now = new Date().toISOString();

  // Deferred cleanup — don't block the response
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  void env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_tokens WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM oauth_codes WHERE created_at < ?").bind(fiveMinAgo),
  ]);

  if (grant_type === "authorization_code") {
    const code = params.code;
    const code_verifier = params.code_verifier;

    if (!code) {
      return Response.json({ error: "invalid_request", error_description: "Missing code" }, { status: 400, headers: errorHeaders });
    }

    const stored = (await env.DB.prepare(
      "SELECT * FROM oauth_codes WHERE code = ?",
    )
      .bind(code)
      .first()) as any;

    if (!stored) {
      return Response.json({ error: "invalid_grant", error_description: "Invalid or expired code" }, { status: 400, headers: errorHeaders });
    }

    await env.DB.prepare("DELETE FROM oauth_codes WHERE code = ?")
      .bind(code)
      .run();

    if (stored.code_challenge) {
      if (!code_verifier) {
        return Response.json({ error: "invalid_grant", error_description: "Missing code_verifier" }, { status: 400, headers: errorHeaders });
      }
      const computed = await sha256base64url(code_verifier);
      if (computed !== stored.code_challenge) {
        return Response.json({ error: "invalid_grant", error_description: "Invalid code_verifier" }, { status: 400, headers: errorHeaders });
      }
    }

    return issueTokenPair(env, stored.client_id);
  }

  if (grant_type === "refresh_token") {
    const refresh_token = params.refresh_token;
    if (!refresh_token) {
      return Response.json({ error: "invalid_request", error_description: "Missing refresh_token" }, { status: 400, headers: errorHeaders });
    }

    const stored = (await env.DB.prepare(
      "SELECT * FROM oauth_tokens WHERE token = ? AND type = 'refresh' AND expires_at > ?",
    )
      .bind(refresh_token, now)
      .first()) as any;

    if (!stored) {
      return Response.json({ error: "invalid_grant", error_description: "Invalid or expired refresh token" }, { status: 400, headers: errorHeaders });
    }

    return issueTokenPair(env, stored.client_id, [
      env.DB.prepare("DELETE FROM oauth_tokens WHERE token = ?").bind(refresh_token),
    ]);
  }

  return Response.json(
    { error: "unsupported_grant_type" },
    { status: 400, headers: errorHeaders },
  );
}

async function handleRegister(request: Request): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;
  const client_id = generateToken();
  return Response.json(
    {
      client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: body.client_name || "MCP Client",
      redirect_uris: body.redirect_uris || [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp",
    },
    { status: 201, headers: CORS_HEADERS },
  );
}

// --- Auth ---

async function authenticate(request: Request, env: Env): Promise<boolean> {
  const token = parseBearer(request);
  if (!token) return false;

  if (token === env.API_TOKEN) return true;

  const stored = await env.DB.prepare(
    "SELECT token FROM oauth_tokens WHERE token = ? AND type = 'access' AND expires_at > ?",
  )
    .bind(token, new Date().toISOString())
    .first();

  return !!stored;
}

// --- Embedding ---

async function embed(text: string, env: Env): Promise<number[]> {
  const res = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [text],
  })) as { data: number[][] };
  return res.data[0];
}

// --- Tool implementations ---

async function memoryStore(
  args: {
    content: string; category?: string; tags?: string[];
    wing?: string; wing_type?: string; room?: string;
    hall?: string; importance?: number;
    _isCloset?: boolean; _sourceIds?: string[];
  },
  env: Env,
) {
  const id = crypto.randomUUID();
  const category = args._isCloset ? "reference" : (args.category || "general");
  const tags = JSON.stringify(args.tags || []);
  const hall = validateHall(args.hall);
  const importance = args._isCloset ? clampImportance(args.importance || 5) : clampImportance(args.importance);
  const isCloset = args._isCloset ? 1 : 0;
  const sourceIds = JSON.stringify(args._sourceIds || []);
  const now = new Date().toISOString();

  const [embedding, { wingId, roomId }] = await Promise.all([
    embed(args.content, env),
    resolveWingRoom(env, args.wing, args.room, args.wing_type),
  ]);

  await env.DB.prepare(
    "INSERT INTO memories (id, content, category, tags, wing_id, room_id, hall, is_closet, source_ids, importance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, args.content, category, tags, wingId, roomId, hall, isCloset, sourceIds, importance, now, now)
    .run();

  await env.VECTORIZE.upsert([
    { id, values: embedding, metadata: { category } },
  ]);

  const location = [args.wing, args.room].filter(Boolean).join("/");
  const label = args._isCloset ? "closet" : "memory";
  return textResult(`Stored ${label} [${id}] in ${category}/${hall}${location ? ` 📍${location}` : ""}${importance > 0 ? ` (importance: ${importance})` : ""}`);
}

async function memorySearch(
  args: { query: string; category?: string; wing?: string; room?: string; hall?: string; limit?: number },
  env: Env,
) {
  const limit = Math.min(args.limit || 10, 50);
  const embedding = await embed(args.query, env);

  const filter = args.category ? { category: args.category } : undefined;

  const matches = await env.VECTORIZE.query(embedding, {
    topK: limit,
    filter,
    returnMetadata: "all",
  });

  if (!matches.matches.length) return textResult("No memories found.");

  const ids = matches.matches.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");

  let query = `${MEMORY_SELECT} WHERE m.id IN (${placeholders})`;
  const binds: unknown[] = [...ids];
  const conditions: string[] = [];

  addPalaceFilters(conditions, binds, args);
  if (conditions.length) query += " AND " + conditions.join(" AND ");

  const { results } = await env.DB.prepare(query).bind(...binds).all();

  if (!(results as any[]).length) return textResult("No memories found.");

  const scoreMap = new Map(matches.matches.map((m) => [m.id, m.score]));

  const text = (results as any[])
    .sort((a, b) => (scoreMap.get(b.id) || 0) - (scoreMap.get(a.id) || 0))
    .map((r) => formatMemory(r, `relevance: ${(scoreMap.get(r.id) || 0).toFixed(3)}`))
    .join("\n\n---\n\n");

  return textResult(text);
}

async function memoryList(
  args: { category?: string; tag?: string; wing?: string; room?: string; hall?: string; limit?: number; offset?: number },
  env: Env,
) {
  const limit = Math.min(args.limit || 20, 100);
  const offset = args.offset || 0;

  let query = MEMORY_SELECT;
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (args.category) { conditions.push("m.category = ?"); binds.push(args.category); }
  if (args.tag) { conditions.push("m.tags LIKE ?"); binds.push(`%"${args.tag}"%`); }
  addPalaceFilters(conditions, binds, args);

  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY m.importance DESC, m.created_at DESC LIMIT ? OFFSET ?";
  binds.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return textResult(formatMemoryResults(results as any[]));
}

async function memoryGet(args: { id: string }, env: Env) {
  const r = (await env.DB.prepare(
    `${MEMORY_SELECT} WHERE m.id = ?`,
  ).bind(args.id).first()) as any;

  if (!r) return textResult(`Memory [${args.id}] not found.`);

  let text = formatMemory(r);
  if (r.is_closet && r.source_ids) {
    const sourceIds = JSON.parse(r.source_ids || "[]");
    if (sourceIds.length) text += `\nSources: ${sourceIds.join(", ")}`;
  }
  return textResult(text);
}

async function memoryUpdate(
  args: {
    id: string; content?: string; category?: string; tags?: string[];
    wing?: string; room?: string; hall?: string; importance?: number;
  },
  env: Env,
) {
  const existing = (await env.DB.prepare(
    "SELECT content, category, tags, hall, importance FROM memories WHERE id = ?",
  ).bind(args.id).first()) as any;

  if (!existing) return textResult(`Memory [${args.id}] not found.`);

  const content = args.content || existing.content;
  const category = args.category || existing.category;
  const tags = args.tags ? JSON.stringify(args.tags) : existing.tags;
  const hall = validateHall(args.hall || existing.hall);
  const importance = args.importance !== undefined ? clampImportance(args.importance) : (existing.importance || 0);
  const now = new Date().toISOString();

  const { wingId, roomId } = await resolveWingRoom(env, args.wing, args.room);

  const setClauses = [
    "content = ?", "category = ?", "tags = ?", "hall = ?", "importance = ?", "updated_at = ?",
  ];
  const setBinds: unknown[] = [content, category, tags, hall, importance, now];

  if (wingId !== null) { setClauses.push("wing_id = ?"); setBinds.push(wingId); }
  if (roomId !== null) { setClauses.push("room_id = ?"); setBinds.push(roomId); }

  setBinds.push(args.id);

  if (args.content) {
    const [embedding] = await Promise.all([
      embed(content, env),
      env.DB.prepare(`UPDATE memories SET ${setClauses.join(", ")} WHERE id = ?`).bind(...setBinds).run(),
    ]);
    await env.VECTORIZE.upsert([{ id: args.id, values: embedding, metadata: { category } }]);
  } else {
    await env.DB.prepare(`UPDATE memories SET ${setClauses.join(", ")} WHERE id = ?`).bind(...setBinds).run();
  }

  return textResult(`Updated memory [${args.id}]`);
}

async function memoryDelete(args: { id: string }, env: Env) {
  const result = await env.DB.prepare("DELETE FROM memories WHERE id = ?")
    .bind(args.id)
    .run();

  if (!result.meta.changes) return textResult(`Memory [${args.id}] not found.`);

  await env.VECTORIZE.deleteByIds([args.id]);
  return textResult(`Deleted memory [${args.id}]`);
}

// --- Palace tools ---

async function palaceOverview(env: Env) {
  const [wingsRes, roomsRes, tunnelsRes, unorganized, hallCountsRes] = await Promise.all([
    env.DB.prepare(
      "SELECT w.*, (SELECT COUNT(*) FROM memories WHERE wing_id = w.id) as mem_count FROM wings w ORDER BY w.name",
    ).all(),
    env.DB.prepare(
      "SELECT r.*, w.name as wing_name, (SELECT COUNT(*) FROM memories WHERE room_id = r.id) as mem_count FROM rooms r JOIN wings w ON r.wing_id = w.id ORDER BY w.name, r.name",
    ).all(),
    env.DB.prepare(
      `SELECT t.id, t.description, ra.name as room_a, wa.name as wing_a, rb.name as room_b, wb.name as wing_b
       FROM tunnels t
       JOIN rooms ra ON t.room_a_id = ra.id JOIN wings wa ON ra.wing_id = wa.id
       JOIN rooms rb ON t.room_b_id = rb.id JOIN wings wb ON rb.wing_id = wb.id`,
    ).all(),
    env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM memories WHERE wing_id IS NULL",
    ).first() as Promise<any>,
    env.DB.prepare(
      "SELECT wing_id, room_id, hall, COUNT(*) as cnt FROM memories WHERE wing_id IS NOT NULL GROUP BY wing_id, room_id, hall",
    ).all(),
  ]);

  const wings = wingsRes.results as any[];
  const rooms = roomsRes.results as any[];
  const tunnels = tunnelsRes.results as any[];
  const hallCounts = hallCountsRes.results as any[];

  const hallMap = new Map<string, Map<string, number>>();
  for (const h of hallCounts) {
    const key = h.room_id || h.wing_id;
    if (!hallMap.has(key)) hallMap.set(key, new Map());
    hallMap.get(key)!.set(h.hall || "facts", h.cnt);
  }

  const roomsByWing = new Map<string, any[]>();
  for (const room of rooms) {
    const list = roomsByWing.get(room.wing_name) || [];
    list.push(room);
    roomsByWing.set(room.wing_name, list);
  }

  let text = "# Memory Palace\n\n";

  if (!wings.length && !unorganized?.cnt) return textResult("Palace is empty. Store memories with wing/room to build the structure.");

  for (const wing of wings) {
    text += `## 🏛️ ${wing.name} (${wing.type}) — ${wing.mem_count} memories\n`;
    if (wing.description) text += `  ${wing.description}\n`;

    const wingRooms = roomsByWing.get(wing.name) || [];
    if (wingRooms.length) {
      for (const room of wingRooms) {
        text += `  ### 🚪 ${room.name} — ${room.mem_count} memories\n`;
        const halls = hallMap.get(room.id);
        if (halls) {
          for (const [hall, count] of halls) text += `    - ${hall}: ${count}\n`;
        }
      }
    }

    // Wing memories not in rooms
    const wingHalls = hallMap.get(wing.id);
    if (wingHalls) {
      text += `  ### (no room)\n`;
      for (const [hall, count] of wingHalls) text += `    - ${hall}: ${count}\n`;
    }
    text += "\n";
  }

  if (tunnels.length) {
    text += "## 🔗 Tunnels\n";
    for (const t of tunnels) {
      text += `- ${t.wing_a}/${t.room_a} ↔ ${t.wing_b}/${t.room_b}`;
      if (t.description) text += ` — ${t.description}`;
      text += ` [${t.id}]\n`;
    }
    text += "\n";
  }

  if (unorganized?.cnt > 0) {
    text += `## 📦 Unorganized — ${unorganized.cnt} memories\n`;
  }

  return textResult(text);
}

async function palaceManage(
  args: {
    action: string;
    wing?: string; wing_type?: string; room?: string;
    description?: string; room_a?: string; room_b?: string; id?: string;
  },
  env: Env,
) {
  const now = new Date().toISOString();

  switch (args.action) {
    case "create_wing": {
      if (!args.wing) return textResult("Error: wing name required.");
      const existing = await env.DB.prepare("SELECT id FROM wings WHERE name = ?").bind(args.wing).first();
      if (existing) return textResult(`Wing "${args.wing}" already exists.`);
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO wings (id, name, type, description, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, args.wing, args.wing_type || "project", args.description || null, now).run();
      return textResult(`Created wing "${args.wing}" (${args.wing_type || "project"}) [${id}]`);
    }
    case "create_room": {
      if (!args.wing || !args.room) return textResult("Error: wing and room names required.");
      const wing = (await env.DB.prepare("SELECT id FROM wings WHERE name = ?").bind(args.wing).first()) as any;
      if (!wing) return textResult(`Wing "${args.wing}" not found. Create it first.`);
      const existing = await env.DB.prepare("SELECT id FROM rooms WHERE wing_id = ? AND name = ?").bind(wing.id, args.room).first();
      if (existing) return textResult(`Room "${args.room}" already exists in wing "${args.wing}".`);
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO rooms (id, wing_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, wing.id, args.room, args.description || null, now).run();
      return textResult(`Created room "${args.room}" in wing "${args.wing}" [${id}]`);
    }
    case "create_tunnel": {
      if (!args.room_a || !args.room_b) return textResult("Error: room_a and room_b required (format: 'wing/room').");
      const [wingA, roomA] = args.room_a.split("/");
      const [wingB, roomB] = args.room_b.split("/");
      const roomQuery = "SELECT r.id FROM rooms r JOIN wings w ON r.wing_id = w.id WHERE w.name = ? AND r.name = ?";
      const [rA, rB] = await Promise.all([
        env.DB.prepare(roomQuery).bind(wingA, roomA).first() as Promise<any>,
        env.DB.prepare(roomQuery).bind(wingB, roomB).first() as Promise<any>,
      ]);
      if (!rA || !rB) return textResult("Error: one or both rooms not found.");
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO tunnels (id, room_a_id, room_b_id, description, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, rA.id, rB.id, args.description || null, now).run();
      return textResult(`Created tunnel: ${args.room_a} ↔ ${args.room_b} [${id}]`);
    }
    case "delete_wing": {
      const where = args.id ? "id = ?" : args.wing ? "name = ?" : null;
      if (!where) return textResult("Error: wing id or name required.");
      return deleteEntity(env, "wings", where, (args.id || args.wing)!);
    }
    case "delete_room":
      if (!args.id) return textResult("Error: room id required.");
      return deleteEntity(env, "rooms", "id = ?", args.id);
    case "delete_tunnel":
      if (!args.id) return textResult("Error: tunnel id required.");
      return deleteEntity(env, "tunnels", "id = ?", args.id);
    default:
      return textResult(`Unknown action: ${args.action}`);
  }
}

async function closetCreate(
  args: {
    content: string; source_ids: string[];
    wing?: string; room?: string; hall?: string; tags?: string[];
  },
  env: Env,
) {
  return memoryStore(
    {
      content: args.content,
      tags: args.tags,
      wing: args.wing,
      room: args.room,
      hall: args.hall,
      _isCloset: true,
      _sourceIds: args.source_ids,
    },
    env,
  );
}

async function wakeupContext(args: { limit?: number }, env: Env) {
  const limit = Math.min(args.limit || 10, 30);

  // Single query: important first, then recent as fallback
  const { results } = await env.DB.prepare(
    `${MEMORY_SELECT} ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?`,
  ).bind(limit).all();

  const rows = results as any[];
  const hasImportant = rows.some((r) => r.importance > 0);
  const header = hasImportant ? "# Wake-up Context" : "# Wake-up Context (recent, no importance set)";
  return textResult(formatMemoryResults(rows, header));
}

// --- Tool dispatcher ---

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
    case "palace_overview":
      return palaceOverview(env);
    case "palace_manage":
      return palaceManage(args as any, env);
    case "closet_create":
      return closetCreate(args as any, env);
    case "wakeup_context":
      return wakeupContext(args as any, env);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- JSON-RPC handler ---

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

// --- Main Worker ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Public: health check
    if (path === "/" && request.method === "GET") {
      return Response.json(
        { status: "ok", server: SERVER_INFO },
        { headers: CORS_HEADERS },
      );
    }

    // Public: OAuth discovery (RFC 9728 + RFC 8414)
    if (path === "/.well-known/oauth-protected-resource" && request.method === "GET") {
      return Response.json(protectedResourceMetadata(url.origin), { headers: CORS_HEADERS });
    }
    if (path === "/.well-known/oauth-authorization-server" && request.method === "GET") {
      return Response.json(oauthMetadata(url.origin), { headers: CORS_HEADERS });
    }

    // Public: OAuth endpoints
    if (path === "/authorize" && request.method === "GET") {
      return handleAuthorizeGet(url);
    }
    if (path === "/authorize" && request.method === "POST") {
      return handleAuthorizePost(request, env);
    }
    if (path === "/token" && request.method === "POST") {
      return handleToken(request, env);
    }
    if (path === "/register" && request.method === "POST") {
      return handleRegister(request);
    }

    // Secret-path endpoints (token-in-URL auth for claude.ai web)
    const secretMatch = path.match(/^\/s\/([^/]+)(\/.*)?$/);
    if (secretMatch) {
      const pathToken = secretMatch[1];
      const subPath = secretMatch[2] || "/";

      if (pathToken !== env.API_TOKEN) {
        return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
      }

      if (subPath === "/sse" && request.method === "GET") {
        const sessionId = crypto.randomUUID();
        const doId = env.MCP_SESSION.idFromName(sessionId);
        const stub = env.MCP_SESSION.get(doId);
        const messageUrl = `${url.origin}/s/${pathToken}/message?session=${sessionId}`;
        return stub.fetch(
          new Request(`https://internal/sse?messageUrl=${encodeURIComponent(messageUrl)}`, {
            headers: request.headers,
          }),
        );
      }

      if (subPath.startsWith("/message") && request.method === "POST") {
        const sessionId = url.searchParams.get("session");
        if (!sessionId) {
          return Response.json(
            { error: "Missing session" },
            { status: 400, headers: CORS_HEADERS },
          );
        }
        const doId = env.MCP_SESSION.idFromName(sessionId);
        const stub = env.MCP_SESSION.get(doId);
        return stub.fetch(
          new Request("https://internal/message", {
            method: "POST",
            body: request.body,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if ((subPath === "/mcp" || subPath === "/") && request.method === "POST") {
        return handleJsonRpcPost(request, env);
      }

      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }

    // Bearer-auth protected endpoints
    if (!(await authenticate(request, env))) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer", ...CORS_HEADERS },
      });
    }

    if (path === "/sse" && request.method === "GET") {
      const stream = createSseStream(`${url.origin}/message`);
      return new Response(stream, { headers: SSE_HEADERS });
    }

    if (
      (path === "/message" || path === "/mcp") &&
      request.method === "POST"
    ) {
      return handleJsonRpcPost(request, env);
    }

    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  },
};

// --- Durable Object: McpSession ---
// Maintains SSE stream so POST responses can be pushed through it.
// Required because SSE transport expects responses delivered via the stream,
// not as HTTP response bodies — impossible without shared state across requests.

export class McpSession implements DurableObject {
  private sseController: ReadableStreamDefaultController<Uint8Array> | null =
    null;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/sse" && request.method === "GET") {
      const messageUrl = url.searchParams.get("messageUrl") || "";
      const stream = createSseStream(
        messageUrl,
        (controller) => {
          this.sseController = controller;
        },
        () => this.cleanup(),
      );
      return new Response(stream, { headers: SSE_HEADERS });
    }

    if (url.pathname === "/message" && request.method === "POST") {
      const body = await request.json();

      // Handle batch and single requests
      const requests = Array.isArray(body) ? body : [body];
      const responses: JsonRpcResponse[] = [];

      for (const req of requests as JsonRpcRequest[]) {
        if (req.id === undefined) continue;
        const response = await processRequest(req, this.env);
        if (response) responses.push(response);
      }

      if (this.sseController) {
        for (const response of responses) {
          try {
            const data = JSON.stringify(response);
            this.sseController.enqueue(
              encoder.encode(`event: message\ndata: ${data}\n\n`),
            );
          } catch {
            this.cleanup();
            break;
          }
        }
      }

      return new Response(null, { status: 202 });
    }

    return new Response("Not Found", { status: 404 });
  }

  private cleanup() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    this.sseController = null;
  }
}
