<div align="center">

# ⚡ 脉冲竞技场 · Pulse Arena

[🎮 特性](#features) ·[🚀 快速开始](#quick-start) ·[🕹️ 操作](#controls) ·[🗺️ 地图](#maps) ·[🤖 机甲](#mechs) ·[🛠️ 管理后台](#admin) ·[🧱 技术栈](#stack) ·[📁 目录](#structure) ·[🌐 部署](#deploy) ·[🤝 贡献](#contribute) ·[📄 许可](#license)



> ❝ **走位决定生死，时机决定胜负。** ❞
>
> —— 脉冲竞技场

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D14-339933?logo=node.js&logoColor=white)](https://nodejs.org/)[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](#stack)[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

---

零依赖的多人实时联机竞技场网页游戏。打开浏览器即可开玩：驾驶各具特色的机甲，在霓虹太空竞技场里混战，率先达成 **3 杀** 者赢得本回合；开局与回合后均可**自选地图或随机**。

> **Zero-dependency** multiplayer browser arena. Server-authoritative Node.js + handwritten WebSocket; single-file Canvas client. No npm install, no build step.

## 🎮 特性

- 🎮 **操作空间**：俯视角双摇杆式操作（WASD + 鼠标瞄准），冲刺无敌帧、能量管理、掩体走位、弹道预判、技能时机等多层技巧
- ⚔️ **对抗**：自由混战（FFA），实时击杀 / 助攻 / 连杀播报与排行榜；击坠与被击坠都有清晰反馈
- 🎨 **个性化**：进入前可选 **昵称 / 机甲职业 / 配色 / 地图(或随机)**，每局以独一无二的涂装与机体登场
- ⚡ **即开即玩**：仅需 Node.js，`node server.js` 即可；客户端零构建
- 📦 **真正零依赖**：原生 `http` + 手写 WebSocket（RFC 6455），无 npm 包
- 🛰️ **服务端权威**：60 tick/s 快照广播，配合客户端预测、幽灵子弹与远程外推
- 🤖 **14 款机甲 · 8 张地图**：定位差异明显，回合胜利后进入选图（可选/随机，超时随机）
- 🛠️ **热更后台**：`/admin` 可在线调整机甲数值与目标击杀数

<a id="quick-start"></a>

## 🚀 快速开始

### 环境要求

- 🟢 [Node.js](https://nodejs.org/) **≥ 14**（推荐 LTS）
- 🌐 现代浏览器（Chrome / Edge / Firefox / Safari）

### 运行

```bash
git clone https://github.com/<your-name>/pulse-arena.git
cd pulse-arena
node server.js
```

默认监听 `0.0.0.0:4001`。浏览器打开：

| 入口 | 地址 |
| --- | --- |
| 🎮 游戏 | http://localhost:4001 |
| 🛠️ 管理后台 | http://localhost:4001/admin |

局域网内其他设备可用启动日志中打印的 IP 访问。

### 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | HTTP / WebSocket 端口 | `4001` |

```bash
# Windows PowerShell
$env:PORT=8080; node server.js

# Linux / macOS
PORT=8080 node server.js
```

<a id="controls"></a>

## 🕹️ 操作

| 操作 | 效果 |
| --- | --- |
| `WASD` / 方向键 | 移动 |
| 鼠标 | 瞄准 |
| 鼠标左键（按住） | 射击 |
| `空格` / `Shift` | 冲刺（耗能，带无敌帧） |
| 鼠标右键 / `E` | 职业技能 |
| 鼠标滚轮 | 缩放视野 |
| `F3` | 延迟自检面板 |

进入前可自选 **昵称 / 机甲 / 配色**。

<a id="maps"></a>

## 🗺️ 地图（可选 / 随机）

| 地图 | 机制 |
| --- | --- |
| 🗺️ 裂谷环 | 外圈掩体、中心开阔 |
| 🏰 双子堡 | 左右堡垒集群、中路对决 |
| ✚ 十字星门 | 四向通道、转角枪战 |
| 🌀 脉冲井 | **动态缩圈**，圈外持续掉血 |
| 🪨 残骸带 | **可破坏掩体**（射击 / 爆炸打碎） |
| 🧲 引力锚 | 双锚牵引，人与子弹轨迹被轻微拉弯 |
| 🪞 镜面廊 | 窄廊对枪 + 两端**治疗点** |
| 🐝 蜂巢 | 大量小掩体，近战主场 |

<a id="mechs"></a>

## 🤖 机甲

### 原班六定位

| 机甲 | 技能 |
| --- | --- |
| ⚔️ 突击者 | **狂暴**：射速 / 伤害提升 |
| 🛡️ 泰坦 | **护盾**：短暂免疫伤害 |
| 👻 幻影 | **相位**：隐形 + 加速 + 无敌 |
| 🎯 狙击手 | **穿甲弹**：穿透 + 伤害提升 |
| 🔧 工程兵 | **炮台**：自动索敌（最多 2） |
| 🩸 狂战士 | **嗜血**：高吸血 + 伤害 + 移速 |

### 新八职业

| 机甲 | 技能 |
| --- | --- |
| 🕸️ 束缚者 | **重力阱**：区域大幅减速；普攻附带短减速 |
| 💎 折射者 | **折射盾**：短时间把命中自身的子弹弹回 |
| 📡 信标 | **脉冲信标**：自身靠近回能；敌方相位被揭示 |
| 💣 爆破手 | **塑胶炸弹**：延迟范围爆炸（可碎残骸） |
| 🌪️ 风暴骑 | **风暴突进**：沿瞄准冲锋并刮伤途经敌人 |
| 🧵 编织者 | **能量墙**：挡弹不挡人（最多 2 道） |
| 🪞 回响 | **残影**：留下延迟爆炸的残影分身 |
| 💉 汲取者 | **汲取脉冲**：命中窃取移速并削弱目标 |

<a id="admin"></a>

## 🛠️ 管理后台

访问 `/admin`，默认密码为 `123`（见 `server.js` 顶部的 `ADMIN_PW`）。

可热更新全部 14 款机甲属性与回合目标击杀数；修改会写入同目录下的 `config.json`，下次启动自动加载。

> ⚠️ **安全提示**：公开部署前请务必修改 `ADMIN_PW`。默认密码仅适合本机 / 可信局域网调试。

<a id="stack"></a>

## 🧱 技术栈

| 层 | 实现 |
| --- | --- |
| 🖥️ 服务器 | Node.js 原生 `http` 模块 + **手写 WebSocket（RFC 6455）**，零 npm 依赖 |
| 🎨 客户端 | 单文件 `public/index.html`（Canvas 2D + 原生 JS），无需构建 |
| 🛰️ 网络 | 服务端权威，120 tick/s 快照广播 + **客户端预测** + 幽灵子弹 + 远程外推 |
| 📦 依赖 | **无**（无需 `npm install`） |

<a id="structure"></a>

## 📁 目录结构

```
pulse-arena/
├── server.js           # 游戏服务器（HTTP + WebSocket + 权威逻辑）
├── public/
│   ├── index.html      # 游戏客户端
│   └── admin.html      # 管理后台
├── config.json         # 热更配置（运行后按需生成，勿提交敏感内容）
├── LICENSE
└── README.md
```

<a id="deploy"></a>

## 🌐 公网 / 自托管提示

1. 用反向代理（Nginx、Caddy 等）对外暴露 HTTP，并正确转发 WebSocket Upgrade
2. 修改默认管理密码 `ADMIN_PW`
3. 按需用防火墙限制管理页或仅内网访问 `/admin`
4. 建议用进程守护（systemd、pm2 等）保持服务常驻

<a id="contribute"></a>

## 🤝 贡献

欢迎 Issue 与 Pull Request。建议：

1. Fork 本仓库并创建特性分支
2. 尽量保持「零 npm 依赖」约束；大改前可先开 Issue 讨论
3. 提交说明写清动机与验证方式（本机联机、多人、地图/技能回归等）

<a id="license"></a>

## 📄 许可证

本项目采用 [MIT License](./LICENSE) 开源。
