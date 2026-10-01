# Pulse Arena · MCP 接入说明书（局域网 + 大模型边界）

面向：**人类主机开局**、**局域网好友浏览器进场**、**大模型经 MCP 操控一台机甲**。

游戏主服零 npm；MCP 仅 `mcp/` 目录有依赖。

---

## 0. 推荐：给大模型一个地址，让它自己读完再开打

启动 `node server.js` 后，直接把下面地址给模型（或让它调 MCP `arena_playbook`）：

| 地址 | 内容 |
|------|------|
| `http://主机局域网IP:4001/agent` | Markdown 说明书（职业属性表 + 战术 + 流程） |
| `http://主机局域网IP:4001/agent/playbook.md` | 同上 |
| `http://主机局域网IP:4001/agent/catalog.json` | 结构化 JSON（给程序/模型解析） |
| `http://127.0.0.1:4001/agent` | 本机访问 |

### 期望模型行为（固定流程）

1. **读** `/agent` 或调用 `arena_playbook`（自己配置边界，不必人肉粘贴长文）  
2. **问用户**：把可选职业属性表 + 战术预设列出来，请用户定：呼号、职业、战术、是否一直打  
3. **`arena_join` → `arena_set_tactics(autopilot=true)`**  
4. **持续玩**：每 1–2 秒 `arena_observe`，**必须**用中文向用户发【战况】+【判断】；用户说停再 `arena_leave`

### 一句话启动提示词（人类复制给模型即可）

```text
请先读取脉冲竞技场 Agent 手册：
http://<主机局域网IP>:4001/agent
（若已配置 MCP，也可直接调用 arena_playbook）

读完后：把可选机甲属性表和战术预设用中文发给我，问我选呼号、职业、战术。
我确认后：arena_join → arena_set_tactics（autopilot true）→ 持续对局。
每次 observe 后都要对我说：
【战况】……
【判断】……（你自己的局势判断和下一步，不要只报数字）
我说停再 arena_leave。不要 WASD 逐帧操控。
```

把 `<主机局域网IP>` 换成控制台打印的 IP。

---

## 1. 局域网怎么玩

### 角色分工

| 角色 | 做什么 | 连哪里 |
|------|--------|--------|
| **主机** | 跑 `node server.js` | 监听 `0.0.0.0:4001`（已默认） |
| **人类玩家** | 浏览器打开游戏页 | `http://主机局域网IP:4001` |
| **观战** | 首页点「观战模式」 | 同上 |
| **大模型** | 通过 MCP tools 进场 | MCP 进程连 `ARENA_HOST:ARENA_PORT` |

启动后看主机控制台里的 **局域网访问** 一行，例如：

```text
本机访问:     http://localhost:4001
局域网访问:   http://192.168.1.28:4001
MCP Agent:   最多 4 · token 已启用/关闭
```

### 主机启动（推荐开 Token）

PowerShell（主机）：

```powershell
cd d:\项目\dshWeb\pulse-arena
$env:AGENT_TOKEN = "改成你们约定的口令"
$env:MAX_MCP_AGENTS = "4"
# 可选：$env:PORT = "4001"
node server.js
```

- 不设 `AGENT_TOKEN`：任意能连上端口的客户端都能 `agentJoin`（仅适合可信内网调试）
- **局域网有外人/多设备时务必设 Token**，并在 MCP 的 `env` 里写同一口令

Windows 防火墙若拦端口，放行 **入站 TCP 4001**（或你改的 `PORT`）。

### 人类进场

1. 手机/电脑连同一 Wi‑Fi / 局域网  
2. 浏览器打开 `http://主机IP:4001`  
3. 自己选昵称、机甲、配色、地图 → **进入竞技场**  
4. 或点 **观战模式**（Tab 切换跟随，F 自由视角，WASD 平移）

地狱 Bot 数量在首页可调（0–3）；与人类、MCP Agent 同场 FFA。

### 大模型侧（MCP 跑在「跑 Cursor / 模型宿主」的那台电脑）

先装一次：

```powershell
cd d:\项目\dshWeb\pulse-arena\mcp
npm install
```

#### 情况 A：Cursor 和游戏在同一台主机

```json
{
  "mcpServers": {
    "pulse-arena": {
      "command": "node",
      "args": ["d:/项目/dshWeb/pulse-arena/mcp/src/server.js"],
      "env": {
        "ARENA_HOST": "127.0.0.1",
        "ARENA_PORT": "4001",
        "AGENT_TOKEN": "改成你们约定的口令"
      }
    }
  }
}
```

#### 情况 B：Cursor 在另一台电脑，游戏在主机（真·局域网 MCP）

把 `args` 里的路径改成**那台电脑上**的 `mcp/src/server.js` 绝对路径，并：

```json
"env": {
  "ARENA_HOST": "192.168.1.28",
  "ARENA_PORT": "4001",
  "AGENT_TOKEN": "改成你们约定的口令"
}
```

`ARENA_HOST` = 主机控制台打印的局域网 IP（不要用 `localhost`，那是模型本机）。

---

## 2. 大模型能操作的边界对照（必读）

模型**只能**通过下列 MCP tools 影响对局；其它一律视为越界。

### 2.1 允许做（CAN）

| 能力 | Tool / 方式 | 说明 |
|------|-------------|------|
| 自读手册 | `arena_playbook` 或 HTTP `/agent` | 职业属性、战术、URL、提问模板 |
| 查服状态 | `arena_status` | 地图、人数、排行、是否在线 |
| 进场占一槽 | `arena_join` | 自选 `name`、职业、配色；一会话一台机甲 |
| 设定战术自动驾驶 | `arena_set_tactics` | preset + autopilot；之后服务端持续刷新意图 |
| 读压缩态势 | `arena_observe` | hp、敌人方位/距离档、拾取、缩圈、当前意图、事件 |
| 临时覆盖意图 | `arena_act` | 见意图表；不设战术时也可用 |
| 退场 | `arena_leave` | 释放槽位 |
| 只读解说 | `arena_spectate_summary` | **不占槽**，拿简报 |
| 间接受益 | （服务端） | 贴脸子弹 **autoDodge**；战术 autopilot 自动交战 |

**合法意图（`arena_act.intent`）**

| intent | 模型语义 | 服务端大致行为 |
|--------|----------|----------------|
| `engage` | 交战输出 | 锁目标、推荐距离、开火 |
| `kite` | 风筝 | 拉远边打边撤 |
| `rush` | 贴脸 | 近身压制 |
| `hold_cover` | 掩体 | 找掩体后射击 |
| `grab_pickup` | 抢物资 | `pickupType`：0治疗 1能量 2加速 3增伤 |
| `dash` | 冲刺一次 | `dashDir`：toward / away / strafe |
| `ability` | 放技能 | 面向目标释放职业技能 |
| `idle` | 停住 | 不移动不射击 |
| `retreat_edge` | 外撤 | 向外圈撤并可还击 |

可选参数：`targetName` / `targetId`、`aggressive`（0–1）、`durationMs`（约 400–5000，默认 ~2000）。

**合法职业 `classKey`**

`assault` `titan` `phantom` `sniper` `engineer` `berserker` `binder` `prism` `beacon` `demolisher` `stormrider` `weaver` `echo` `siphon`

### 2.2 禁止做 / 做不到（CANNOT）

| 越界行为 | 原因 |
|----------|------|
| 发 WASD / 鼠标坐标 / 逐帧 `mx,my,ang,sh` | 无此类 MCP tool；延迟下必崩 |
| 同时操控多台机甲（同一 MCP 会话） | 一会话一槽；要多模型各开 MCP |
| 改机甲数值、目标击杀数、管理员配置 | 不在 MCP 暴露；走 `/admin` |
| 替人类点选图（观战/Agent 无选图权时） | Agent 获胜由服务端短延迟随机选图 |
| 伪造击杀、改血量、秒杀 | 服务端权威，无后门 |
| 看见完整弹道数组 / 像素画面 | 只有压缩 `observe` 文本态势 |
| 无 Token 时硬闯已设 Token 的服 | 返回 `unauthorized` |
| 超过 `MAX_MCP_AGENTS` 再 join | 返回 `full` |
| 死亡中强行有效输出 | `arena_act` → `waiting_respawn`，应 observe 等待 |
| 意图刷屏（>~8 次/秒） | `rate_limited` |
| 长时间不心跳 | ~8s 无活动踢出（`AGENT_IDLE_MS`） |
| 攻击「友军」概念 | 模式是 **FFA**：人类 / Bot / 其它 Agent **都是对手** |

### 2.3 责任分界（对照）

```text
┌──────────────┐     observe/act      ┌──────────────┐     每 tick      ┌──────────────┐
│  大模型      │ ───────────────────► │ Intent 执行器 │ ───────────────► │  物理/伤害   │
│ 战略：打谁、 │                      │ 预瞄·走位·    │                  │  server.js   │
│ 风筝还是Rush │                      │ 开火·躲弹     │                  │              │
└──────────────┘                      └──────────────┘                  └──────────────┘
     慢（0.5–2s）                           快（60Hz）                      权威
```

- **模型负责**：目标选择、节奏、意图切换  
- **执行器负责**：手操精度、LOS、距离带、autoDodge  
- **人类负责**：开服、Token、观战、自己键鼠玩自己的号  

### 2.4 推荐决策循环

```text
arena_status
arena_join(...)
loop 每 0.5–1.5 秒:
  arena_observe
  根据 self.hp / enemies / hazards / score.toWin 选一个 intent
  arena_act(...)
用户叫停或打完 → arena_leave
```

---

## 3. 人类给大模型的提示词

把下面整段复制给模型（可按局改昵称/职业）。模型需已接入 `pulse-arena` MCP。

### 3.1 标准对战提示词（推荐：自读手册）

```text
请先读取脉冲竞技场 Agent 手册 http://<主机IP>:4001/agent
（有 MCP 则优先 arena_playbook）。

【硬性边界】
只用：arena_playbook、arena_status、arena_join、arena_set_tactics、arena_observe、arena_act、arena_leave、arena_spectate_summary。
禁止 WASD/逐帧输入与作弊。意图仅手册列出的那些。FFA：人类也是敌人。

【流程】
1. 读手册后，把职业属性表 + 战术预设发给我，问我：呼号、职业 classKey、战术 preset。
2. 我确认后 arena_join → arena_set_tactics(autopilot=true)。
3. 之后持续对局：每 1–2 秒 arena_observe，每次必须回复我：
【战况】2～4 句事实
【判断】1～2 句你自己的局势判断与下一步
必要时 arena_act 微调。
4. 我说停再 arena_leave。
```

### 3.2 旧版标准提示词（不读 URL 时）

```text
你通过 MCP 工具操控《脉冲竞技场 Pulse Arena》里的一台机甲，和人类、地狱 Bot、其它 Agent 一起 FFA 混战。

【硬性边界】
- 只能使用：arena_playbook、arena_status、arena_join、arena_set_tactics、arena_observe、arena_act、arena_leave、arena_spectate_summary。
- 禁止臆造 WASD/鼠标/逐帧输入；禁止改数值、作弊、多开本会话机体。
- 合法意图仅：engage、kite、rush、hold_cover、grab_pickup、dash、ability、idle、retreat_edge。
- 其他玩家（含人类）都是敌人。死亡时若 act 返回 waiting_respawn，就 observe 等到复活。

【本局任务】
1. arena_playbook 或 arena_status 确认在线。
2. 向用户确认呼号/职业/战术后 arena_join + arena_set_tactics。
3. 持续 observe；目标先到 score.toWin=0。
4. 用户叫停 → arena_leave。
```

### 3.3 解说 / 只看不打

```text
你只做《脉冲竞技场》文字解说，不要进场占槽。
只用 arena_spectate_summary（和必要时 arena_status / arena_playbook）。
每隔几秒拉一次简报，用中文播报：地图、领先者、谁在残血、人类/Bot/Agent 人数。
禁止 arena_join / arena_act。
```

### 3.4 局域网联机（人类已在浏览器里）

```text
先 arena_playbook 或打开 http://<主机IP>:4001/agent。
主机局域网已开服，人类在浏览器里。把职业/战术表发给我确认后：
arena_join → arena_set_tactics(autopilot true) → 持续 observe 直到我说停 → leave。
FFA：浏览器人类也是敌人。
```

### 3.5 短指令（口令式）

```text
读 http://<主机IP>:4001/agent（或 arena_playbook），把属性和战术问我确认，然后进场自动驾驶一直打，我说停再 leave。
```

---

## 4. 排错速查

| 现象 | 处理 |
|------|------|
| 模型连不上 | 主机是否 `node server.js`；`ARENA_HOST` 是否为主机局域网 IP |
| `unauthorized` | 游戏服与 MCP 的 `AGENT_TOKEN` 必须完全一致 |
| `full` | Agent 已满，调大 `MAX_MCP_AGENTS` 或让旧会话 `leave` |
| 浏览器打不开局域网页 | 防火墙放行端口；确认同一网段；用主机控制台打印的 IP |
| Agent 突然消失 | 超过空闲时间被踢；MCP 需保持进程、会自动 heartbeat |
| 站桩不杀人 | 是否定期 `arena_act`；意图超时虽会默认 engage，仍应主动刷新 |

---

## 5. 相关文件

- MCP 进程：`mcp/src/server.js`、`mcp/src/bridge.js`
- 意图执行：`agent-exec.js`
- 游戏协议：`server.js`（`agent*` 消息）
- 英文短 Skill：`mcp/SKILL.md`
- 工具字段详解：`docs/mcp-agent.md`
