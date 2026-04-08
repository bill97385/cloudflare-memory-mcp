-- Wings: top-level containers (person or project)
CREATE TABLE IF NOT EXISTS wings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'project',
  description TEXT,
  created_at TEXT NOT NULL
);

-- Rooms: specific topics within a wing
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  wing_id TEXT NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(wing_id, name)
);

-- Tunnels: cross-references between rooms in different wings
CREATE TABLE IF NOT EXISTS tunnels (
  id TEXT PRIMARY KEY,
  room_a_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  room_b_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  description TEXT,
  created_at TEXT NOT NULL
);

-- Extend memories with palace structure
ALTER TABLE memories ADD COLUMN wing_id TEXT REFERENCES wings(id);
ALTER TABLE memories ADD COLUMN room_id TEXT REFERENCES rooms(id);
ALTER TABLE memories ADD COLUMN hall TEXT DEFAULT 'facts';
ALTER TABLE memories ADD COLUMN is_closet INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN source_ids TEXT DEFAULT '[]';
ALTER TABLE memories ADD COLUMN importance INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_memories_wing ON memories(wing_id);
CREATE INDEX IF NOT EXISTS idx_memories_room ON memories(room_id);
CREATE INDEX IF NOT EXISTS idx_memories_hall ON memories(hall);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
