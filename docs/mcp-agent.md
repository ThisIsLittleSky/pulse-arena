# Pulse Arena MCP Agent

让外部大模型通过 MCP tools 加入混战。完整中文说明（局域网、边界对照、提示词）见：

**[mcp-接入说明书.md](./mcp-接入说明书.md)**

游戏主服仍为零 npm 依赖；`mcp/` 单独安装 MCP SDK。

## 快速开始（本机）

```bash
# 终端 1：游戏服（局域网请设 Token）
# PowerShell: $env:AGENT_TOKEN="your-secret"; node server.js
node server.js

# 终端 2
cd mcp && npm install
```

浏览器：`http://localhost:4001` 或控制台打印的 **局域网访问** 地址；可「观战模式」。

### Cursor MCP（本机）

```json
{
  "mcpServers": {
    "pulse-arena": {
      "command": "node",
      "args": ["D:/项目/dshWeb/pulse-arena/mcp/src/server.js"],
      "env": {
        "ARENA_HOST": "127.0.0.1",
        "ARENA_PORT": "4001",
        "AGENT_TOKEN": "your-secret"
      }
    }
  }
}
```

### Cursor MCP（另一台电脑连主机）

把 `ARENA_HOST` 改成主机局域网 IP（与控制台一致），`AGENT_TOKEN` 与主机相同；`args` 指向**本机**上的 `mcp/src/server.js`。

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `ARENA_HOST` | 游戏服地址（MCP 侧） | `127.0.0.1` |
| `ARENA_PORT` | 游戏服端口 | `4001` |
| `AGENT_TOKEN` | 与游戏服一致才允许 Agent 协议 | 空（不校验，局域网慎用） |
| `MAX_MCP_AGENTS` | （游戏服）最大 MCP 机体 | `4` |
| `AGENT_IDLE_MS` | （游戏服）无心跳踢出 | `8000` |
| `PORT` | （游戏服）监听端口 | `4001` |

主机已绑定 `0.0.0.0`，人类用 `http://局域网IP:PORT` 即可联机。

## 推荐游玩循环

```text
arena_status
arena_join(name, classKey)
loop:
  arena_observe
  （思考 0.3–2s）
  arena_act(intent, targetName?, …)
arena_leave
```

## Tools 与边界摘要

**CAN：** status / join / observe / act（合法意图）/ leave / spectate_summary  

**CANNOT：** WASD 逐帧、改数值、作弊、无 Token 闯关、一会话多机体、完整弹幕透视  

意图：`engage` `kite` `rush` `hold_cover` `grab_pickup` `dash` `ability` `idle` `retreat_edge`  

职业 `classKey`：`assault` `titan` `phantom` `sniper` `engineer` `berserker` `binder` `prism` `beacon` `demolisher` `stormrider` `weaver` `echo` `siphon`

提示词模板见 [mcp-接入说明书.md](./mcp-接入说明书.md) §3。

## Tools

### `arena_status`
服务器是否在线、地图、人类/Bot/Agent 人数、排行榜。

### `arena_join`
参数：`name`（必填）、`classKey` 或 `classIndex`、`colorIndex?`、`map?`  
返回：`agentId`、职业信息、初始 `observe`、合法意图列表。

### `arena_observe`
压缩态势（约 1–2KB）：

- `self`：hp / energy / cds / 坐标 / 存活 / 击杀
- `enemies[]`：距离档、方位、血量档、职业、kind、LOS
- `hazards`：近距子弹数、缩圈压力、autoDodge 时间
- `pickups`：最近拾取
- `score`：kills / toWin
- `intent`：当前意图与剩余时间
- `events`：击杀/死亡/复活等

距离档：`melee` · `close` · `mid` · `far` · `extreme`  
血量档：`high` / `mid` / `low` / `dead`  
方位：`N/NE/E/…`（相对自己）

### `arena_act`
高层意图由服务端 Intent Executor 每 tick 转成走位/瞄准/射击，默认持续 ~2s。

### `arena_leave`
退场并释放槽位。

### `arena_spectate_summary`
只读简报，不占槽。

## 协议对照（调试）

- `arena_status` → `{t:'agentStatus'}`
- `arena_join` → `{t:'agentJoin',...}`
- `arena_observe` → `{t:'agentObserve'}`
- `arena_act` → `{t:'agentIntent',...}`
- `arena_leave` → `{t:'agentLeave'}`
- `arena_spectate_summary` → `{t:'agentSpectateSummary'}`

实现：[`agent-exec.js`](../agent-exec.js)、[`server.js`](../server.js)、[`mcp/src/`](../mcp/src/)。
