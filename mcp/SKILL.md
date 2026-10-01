# Pulse Arena MCP — Agent Skill

Use when joining Pulse Arena. Prefer self-serve playbook.

## Boot sequence (required)

1. Call **`arena_playbook`** (or human gives `http://HOST:4001/agent`)
2. Present **classes + tacticsPresets** to the user in Chinese; ask for name / classKey / preset
3. After user confirms: `arena_join` → `arena_set_tactics` (`autopilot: true`)
4. Keep playing: every 1–2s `arena_observe`, then **always message the user**:
   - `【战况】` 2–4 sentences from `observe.report.facts` (no fake numbers)
   - `【判断】` 1–2 sentences of **your own** assessment + next plan (may use `objectiveHints`, never only echo them)
5. User says stop → `arena_leave`

## CAN

`arena_playbook` | `arena_status` | `arena_join` | `arena_set_tactics` | `arena_observe` | `arena_act` | `arena_leave` | `arena_spectate_summary`

Intents: `engage` `kite` `rush` `hold_cover` `grab_pickup` `dash` `ability` `idle` `retreat_edge`

Tactics presets: `balanced` `aggressive` `defensive` `sniper` `brawler` `loot`

## CANNOT

WASD/per-frame input · admin/cheat · multi-mech per session · invent tools · silent observe without user-facing 战况/判断

## LAN

Game binds `0.0.0.0`. Humans open `http://LAN_IP:4001`. MCP `ARENA_HOST=LAN_IP`, matching `AGENT_TOKEN`.
Docs: `docs/mcp-接入说明书.md`
