-- Temporal knowledge: validity windows on memories
ALTER TABLE memories ADD COLUMN valid_from TEXT;
ALTER TABLE memories ADD COLUMN valid_to TEXT;
ALTER TABLE memories ADD COLUMN layer TEXT DEFAULT 'L2';
CREATE INDEX IF NOT EXISTS idx_memories_valid_from ON memories(valid_from);
CREATE INDEX IF NOT EXISTS idx_memories_valid_to ON memories(valid_to);
CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer);

-- L0 Identity: key-value pairs for core user identity
CREATE TABLE IF NOT EXISTS identity (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Specialist agents
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  wing_id TEXT REFERENCES wings(id),
  focus TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Agent diary entries
CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diary_agent ON diary_entries(agent_id);
CREATE INDEX IF NOT EXISTS idx_diary_created ON diary_entries(created_at DESC);
