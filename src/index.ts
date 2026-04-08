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

// --- Auth ---

function authenticate(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization");
  if (!auth) return false;
  return auth.replace("Bearer ", "") === env.API_TOKEN;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
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
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// --- JSON-RPC handler ---

async function processRequest(
  req: JsonRpcRequest,
  env: Env,
): Promise<JsonRpcResponse | null> {
  if (req.id === undefined) return null; // notification

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
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // Health check (no auth)
    if (url.pathname === "/" && request.method === "GET") {
      return Response.json(
        { status: "ok", server: SERVER_INFO },
        { headers: corsHeaders() },
      );
    }

    // Auth
    if (!authenticate(request, env)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: corsHeaders(),
      });
    }

    // SSE transport: endpoint discovery
    if (url.pathname === "/sse" && request.method === "GET") {
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

    // POST endpoints: /message (SSE transport) and /mcp (Streamable HTTP)
    if (
      (url.pathname === "/message" || url.pathname === "/mcp") &&
      request.method === "POST"
    ) {
      const body = await request.json();

      // Batch support
      if (Array.isArray(body)) {
        const responses = await Promise.all(
          body.map((r: JsonRpcRequest) => processRequest(r, env)),
        );
        return Response.json(
          responses.filter(Boolean),
          { headers: corsHeaders() },
        );
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
