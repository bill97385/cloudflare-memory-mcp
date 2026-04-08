# Memory MCP — Claude Code Instructions

You have access to a persistent cloud memory system via MCP tools. Use it to build and maintain long-term memory across all conversations and devices.

## Wake-Up

At the start of every new conversation, call `wakeup_context` to load critical memories. This gives you essential context about the user, active projects, and recent decisions.

## When to Save

Save to memory when you encounter:
- **User preferences** — how they like to work, communication style, tech stack preferences
- **Project decisions** — architecture choices, why something was done a certain way
- **Discoveries** — bugs found, performance insights, non-obvious solutions
- **Important events** — milestones, experiment results, deploy outcomes
- **Advice/lessons** — what worked, what failed, what to avoid next time

Do NOT save: ephemeral task details, code that's already in git, obvious facts derivable from the codebase.

## How to Save

Use `memory_store` with the palace structure:

```
memory_store({
  content: "Verbatim details — be specific, include numbers, file paths, error messages",
  wing: "Project Name",        // person or project
  room: "Topic",               // specific area within the wing
  hall: "facts",               // facts | events | discoveries | preferences | advice
  category: "project",         // user | project | feedback | reference | general
  importance: 7,               // 0-10, higher = loaded in wake-up context
  tags: ["relevant", "tags"]
})
```

### Hall Guide
| Hall | Store here | Example |
|------|-----------|---------|
| facts | Decisions, architecture, configurations | "Auth uses JWT with 24h expiry" |
| events | Milestones, experiment results, incidents | "v2.0 deployed 2026-04-08, Sharpe improved to 3.38" |
| discoveries | Bugs found, insights, non-obvious learnings | "bf16 autocast only works in the thread that created it" |
| preferences | User habits, tool preferences, style | "Prefers Traditional Chinese, uses tmux + Claude Code" |
| advice | Lessons learned, do/don't recommendations | "Don't mock DB in integration tests — burned us last quarter" |

### Importance Guide
| Score | Meaning | Example |
|-------|---------|---------|
| 9-10 | Identity / critical context | User profile, active production strategy |
| 7-8 | Key project knowledge | Architecture decisions, major experiment results |
| 5-6 | Useful reference | API details, config settings, bug workarounds |
| 1-4 | Nice to have | Environment details, minor preferences |
| 0 | Not important for wake-up | Default, won't appear in wake-up context |

## Browsing Memory

- `palace_overview` — see the full palace structure (wings → rooms → halls)
- `memory_search({query: "..."})` — semantic search by meaning
- `memory_list({wing: "...", room: "..."})` — browse by location
- `wakeup_context` — get the most important memories

## Organizing

- Memories auto-create wings and rooms when you specify names that don't exist yet
- Use `closet_create` to summarize multiple related memories into one overview
- Use `palace_manage` to create tunnels (cross-references between rooms in different wings)

## Auto-Save Hooks

Two hooks are installed that trigger automatic saves:
- **Save Hook**: every 15 messages, you'll be asked to save key session information
- **PreCompact Hook**: before context compression, you'll be asked to emergency-save everything

When a hook fires, save thoroughly — include specific details that would be lost after the conversation ends.
