'use strict';
/*
 * 脉冲竞技场 · Pulse Arena —— 零依赖多人联机竞技场服务器
 * 玩法: 俯视角 2D 太空竞技场自由混战(FFA), WASD 移动 / 鼠标瞄准射击 / 空格冲刺 / 右键技能
 * 技术栈: Node.js 原生 http + 手写 WebSocket(RFC6455) + 服务端权威游戏循环(60 tick/s)
 * 运行:   node server.js   (默认端口 4001, 可用环境变量 PORT 覆盖)
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const hellBots = require('./hell-bots');
const agentExec = require('./agent-exec');
const agentBrief = require('./agent-brief');

const PORT = Number(process.env.PORT) || 4001;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_MCP_AGENTS = Math.max(1, Math.min(8, Number(process.env.MAX_MCP_AGENTS) || 4));
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const AGENT_IDLE_MS = Math.max(3000, Number(process.env.AGENT_IDLE_MS) || 8000);
const AGENT_INTENT_MIN_MS = 1000 / 8; // 最多 8 次意图/秒

/* ============================ 常量 ============================ */
const ARENA_R = 1300;
const TICK_MS = 1000 / 60;
const SHIP_R = 15;
const RESPAWN_MS = 2500;
const SPAWN_GRACE_MS = 1000;
let TARGET_KILLS = 3;
const ENERGY_MAX = 100;
const ENERGY_REGEN = 26;
const PK_R = 16;
const PK_RESPAWN_MS = 12000;
const DASH_MS = 160;
const BULLET_LIFE = 1.7;
const TURRET_R = 16;
const TURRET_HP = 70;
const TURRET_RANGE = 470;
const TURRET_DMG = 8;
const TURRET_FIRE_CD = 0.5;
const TURRET_LIFE = 22;
const TURRET_MAX = 2;

// 14 款机甲: 原 6 + 新 8
const CLASSES = [
  { key: 'assault', name: '突击者', tag: '持续输出 · 均衡',
    hp: 100, speed: 300, fireCd: 0.13, dmg: 9, pSpeed: 700, pR: 4,
    dashCd: 2.0, dashCost: 30, ability: '狂暴', abilityCd: 7 },
  { key: 'titan', name: '泰坦', tag: '重装坦克 · 高额爆发',
    hp: 210, speed: 205, fireCd: 0.75, dmg: 36, pSpeed: 430, pR: 10,
    dashCd: 3.2, dashCost: 45, ability: '护盾', abilityCd: 9 },
  { key: 'phantom', name: '幻影', tag: '刺客 · 位移突袭',
    hp: 65, speed: 360, fireCd: 0.17, dmg: 7, pSpeed: 840, pR: 3,
    dashCd: 1.6, dashCost: 22, ability: '相位', abilityCd: 6 },
  { key: 'sniper', name: '狙击手', tag: '远程精准 · 玻璃大炮',
    hp: 55, speed: 240, fireCd: 1.15, dmg: 60, pSpeed: 1000, pR: 3, pLife: 2.4,
    dashCd: 2.8, dashCost: 35, ability: '穿甲弹', abilityCd: 9 },
  { key: 'engineer', name: '工程兵', tag: '阵地 · 区域控制',
    hp: 90, speed: 275, fireCd: 0.28, dmg: 11, pSpeed: 580, pR: 4,
    dashCd: 2.4, dashCost: 30, ability: '炮台', abilityCd: 8 },
  { key: 'berserker', name: '狂战士', tag: '近战 · 吸血缠斗',
    hp: 150, speed: 335, fireCd: 0.11, dmg: 4, pSpeed: 380, pR: 5, lifesteal: 0.35,
    dashCd: 1.7, dashCost: 25, ability: '嗜血', abilityCd: 8 },
  // —— 新 8 职业 ——
  { key: 'binder', name: '束缚者', tag: '控制 · 减速阱',
    hp: 95, speed: 280, fireCd: 0.22, dmg: 8, pSpeed: 620, pR: 5,
    dashCd: 2.2, dashCost: 28, ability: '重力阱', abilityCd: 8 },
  { key: 'prism', name: '折射者', tag: '反弹 · 弹道博弈',
    hp: 100, speed: 290, fireCd: 0.2, dmg: 10, pSpeed: 680, pR: 4,
    dashCd: 2.0, dashCost: 30, ability: '折射盾', abilityCd: 9 },
  { key: 'beacon', name: '信标', tag: '侦察 · 续航支援',
    hp: 85, speed: 295, fireCd: 0.24, dmg: 9, pSpeed: 650, pR: 4,
    dashCd: 2.3, dashCost: 28, ability: '脉冲信标', abilityCd: 10 },
  { key: 'demolisher', name: '爆破手', tag: '清场 · 延迟爆破',
    hp: 110, speed: 255, fireCd: 0.55, dmg: 22, pSpeed: 480, pR: 9,
    dashCd: 2.6, dashCost: 35, ability: '塑胶炸弹', abilityCd: 9 },
  { key: 'stormrider', name: '风暴骑', tag: '机动坦 · 冲锋刮伤',
    hp: 140, speed: 310, fireCd: 0.3, dmg: 10, pSpeed: 560, pR: 5,
    dashCd: 1.8, dashCost: 25, ability: '风暴突进', abilityCd: 8 },
  { key: 'weaver', name: '编织者', tag: '屏障 · 挡弹不挡人',
    hp: 90, speed: 285, fireCd: 0.26, dmg: 9, pSpeed: 600, pR: 4,
    dashCd: 2.3, dashCost: 30, ability: '能量墙', abilityCd: 7 },
  { key: 'echo', name: '回响', tag: '欺诈 · 残影爆破',
    hp: 80, speed: 320, fireCd: 0.18, dmg: 8, pSpeed: 720, pR: 4,
    dashCd: 1.9, dashCost: 26, ability: '残影', abilityCd: 8 },
  { key: 'siphon', name: '汲取者', tag: '削弱 · 窃取属性',
    hp: 105, speed: 300, fireCd: 0.19, dmg: 9, pSpeed: 640, pR: 4,
    dashCd: 2.1, dashCost: 28, ability: '汲取脉冲', abilityCd: 9 }
];

const COLORS = [
  '#ff5c5c', '#ff9f43', '#ffd166', '#4cd97b', '#3ddc97', '#2eccff',
  '#4aa8ff', '#7c5cff', '#b16cff', '#ff5c8a', '#ff8fa3', '#5cffd1'
];

const PICKUP_TYPES = [
  { icon: '❤️', name: '治疗', color: '#4cd97b' },
  { icon: '⚡', name: '能量', color: '#ffd166' },
  { icon: '🚀', name: '加速', color: '#2eccff' },
  { icon: '💥', name: '增伤', color: '#ff9f43' }
];

/* ============================ 八套地图模板 ============================ */
function circ(x, y, r, extra) {
  return Object.assign({ x, y, r }, extra || {});
}
function ringObstacles(count, dist, rMin, rMax) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + 0.15;
    out.push(circ(Math.cos(a) * dist, Math.sin(a) * dist, rMin + (rMax - rMin) * ((i % 3) / 2)));
  }
  return out;
}

const MAPS = [
  {
    key: 'rift', name: '裂谷环', tag: '外圈掩体 · 中心空地',
    build() {
      return {
        obstacles: ringObstacles(10, 780, 55, 88),
        grav: [], healPads: [], features: { shrink: false, destructible: false }
      };
    }
  },
  {
    key: 'twin', name: '双子堡', tag: '双侧堡垒 · 中路对决',
    build() {
      const obs = [];
      for (const side of [-1, 1]) {
        obs.push(circ(side * 520, 0, 110));
        obs.push(circ(side * 420, -160, 70));
        obs.push(circ(side * 420, 160, 70));
        obs.push(circ(side * 620, -90, 55));
        obs.push(circ(side * 620, 90, 55));
      }
      obs.push(circ(0, -520, 48));
      obs.push(circ(0, 520, 48));
      return { obstacles: obs, grav: [], healPads: [], features: { shrink: false, destructible: false } };
    }
  },
  {
    key: 'cross', name: '十字星门', tag: '四向通道 · 转角枪战',
    build() {
      const obs = [];
      const arms = [
        [0, 1], [0, -1], [1, 0], [-1, 0]
      ];
      for (const [dx, dy] of arms) {
        for (let i = 1; i <= 4; i++) {
          obs.push(circ(dx * i * 180 + dy * 95, dy * i * 180 + dx * 95, 62));
          obs.push(circ(dx * i * 180 - dy * 95, dy * i * 180 - dx * 95, 62));
        }
      }
      // 四角安全袋
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        obs.push(circ(sx * 720, sy * 720, 80));
      }
      return { obstacles: obs, grav: [], healPads: [], features: { shrink: false, destructible: false } };
    }
  },
  {
    key: 'well', name: '脉冲井', tag: '动态缩圈 · 逼合残局',
    build() {
      return {
        obstacles: [
          circ(-380, -220, 70), circ(420, -180, 60), circ(-200, 420, 75),
          circ(280, 360, 55), circ(0, -520, 50), circ(-560, 120, 48)
        ],
        grav: [], healPads: [],
        features: { shrink: true, shrinkStart: ARENA_R, shrinkEnd: 420, shrinkSec: 70, destructible: false }
      };
    }
  },
  {
    key: 'wreck', name: '残骸带', tag: '可破坏掩体 · 改地形',
    build() {
      const obs = [];
      const spots = [
        [0, -400], [0, 400], [-450, 0], [450, 0],
        [-300, -300], [300, -300], [-300, 300], [300, 300],
        [-600, -200], [600, 200], [-150, 0], [150, 180], [0, 0]
      ];
      for (const [x, y] of spots) {
        const r = 40 + Math.abs(x + y) % 40;
        obs.push(circ(x, y, r, { destructible: true, hp: 80 + r, maxHp: 80 + r }));
      }
      return { obstacles: obs, grav: [], healPads: [], features: { shrink: false, destructible: true } };
    }
  },
  {
    key: 'gravity', name: '引力锚', tag: '双锚牵引 · 弹道扭曲',
    build() {
      return {
        obstacles: [
          circ(0, 0, 90), circ(-700, -500, 55), circ(700, 500, 55),
          circ(-700, 500, 55), circ(700, -500, 55), circ(0, -750, 48), circ(0, 750, 48)
        ],
        grav: [{ x: -480, y: 0, str: 220 }, { x: 480, y: 0, str: 220 }],
        healPads: [],
        features: { shrink: false, destructible: false }
      };
    }
  },
  {
    key: 'mirror', name: '镜面廊', tag: '窄廊对枪 · 两端治疗点',
    build() {
      const obs = [];
      for (let i = -3; i <= 3; i++) {
        if (i === 0) continue;
        obs.push(circ(-220, i * 160, 70));
        obs.push(circ(220, i * 160, 70));
      }
      obs.push(circ(-500, -700, 60));
      obs.push(circ(500, 700, 60));
      obs.push(circ(-700, 200, 50));
      obs.push(circ(700, -200, 50));
      return {
        obstacles: obs,
        grav: [],
        healPads: [{ x: 0, y: -900, r: 70 }, { x: 0, y: 900, r: 70 }],
        features: { shrink: false, destructible: false }
      };
    }
  },
  {
    key: 'hive', name: '蜂巢', tag: '密林小掩体 · 近战主场',
    build() {
      const obs = [];
      let n = 0;
      for (let ring = 1; ring <= 4; ring++) {
        const count = 6 + ring * 3;
        const dist = 180 + ring * 200;
        for (let i = 0; i < count; i++) {
          const a = (Math.PI * 2 * i) / count + ring * 0.2;
          obs.push(circ(Math.cos(a) * dist, Math.sin(a) * dist, 28 + (n++ % 3) * 8));
        }
      }
      return { obstacles: obs, grav: [], healPads: [], features: { shrink: false, destructible: false } };
    }
  }
];

/* ============================ 管理员配置 ============================ */
const ADMIN_PW = '123';
const CONFIG_FILE = path.join(__dirname, 'config.json');
const DEFAULT_CLASSES = JSON.parse(JSON.stringify(CLASSES));
const DEFAULT_TARGET_KILLS = TARGET_KILLS;
const allSockets = new Set();
const spectators = new Set();

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const log = (s) => console.log('[' + new Date().toLocaleTimeString() + '] ' + s);

/* ============================ 游戏状态 ============================ */
let players = new Map();
let proj = [];
let pickups = [];
let obstacles = [];
let turrets = [];
let zones = [];       // bind/bomb/beacon/echo
let walls = [];       // weaver energy walls
let gravPoints = [];
let healPads = [];
let mapIndex = 0;
let mapMeta = { key: 'rift', name: '裂谷环', tag: '', features: {} };
let safeR = ARENA_R;
let roundStartedAt = Date.now();
const MAP_PICK_MS = 12000;
let mapPickUntil = 0;
let mapPickWinnerId = null;
let botMapPickAt = 0;
let botCount = hellBots.DEFAULT_BOT_COUNT;
let botsFight = true; // Bot 是否互相攻击
let nextPid = 1;
let nextTurretId = 1;
let nextZoneId = 1;
let nextWallId = 1;
let obstaclesDirty = false; // 掩体仅在变化时随快照下发，避免每 tick 全量重传
let pickupsDirty = true;
let lbDirty = true;
let lastSentSafeR = -1;
let snapSeq = 0; // 偶数 tick 才广播，逻辑 60Hz / 快照 30Hz

const countHumans = () => {
  let n = 0;
  for (const p of players.values()) if (!p.isBot && !p.isAgent) n++;
  return n;
};
const countAgents = () => {
  let n = 0;
  for (const p of players.values()) if (p.isAgent) n++;
  return n;
};
const countBots = () => {
  let n = 0;
  for (const p of players.values()) if (p.isBot) n++;
  return n;
};
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

function packObstacles() {
  return obstacles.map((o) => [o.x, o.y, o.r, o.destructible ? 1 : 0, o.hp || 0, o.maxHp || 0]);
}

function mapsList() {
  return MAPS.map((m) => ({ key: m.key, name: m.name, tag: m.tag }));
}

function resolveMapIndex(choice) {
  if (typeof choice === 'number' && Number.isFinite(choice)) {
    return ((Math.round(choice) % MAPS.length) + MAPS.length) % MAPS.length;
  }
  const key = choice == null ? 'random' : String(choice);
  if (key && key !== 'random') {
    const found = MAPS.findIndex((m) => m.key === key);
    if (found >= 0) return found;
  }
  if (MAPS.length <= 1) return 0;
  let idx = Math.floor(Math.random() * MAPS.length);
  if (idx === mapIndex) idx = (idx + 1 + Math.floor(Math.random() * (MAPS.length - 1))) % MAPS.length;
  return idx;
}

function loadMap(idx) {
  mapIndex = ((idx % MAPS.length) + MAPS.length) % MAPS.length;
  const def = MAPS[mapIndex];
  const built = def.build();
  obstacles = built.obstacles.map((o) => Object.assign({}, o));
  gravPoints = (built.grav || []).map((g) => Object.assign({}, g));
  healPads = (built.healPads || []).map((h) => Object.assign({}, h));
  mapMeta = { key: def.key, name: def.name, tag: def.tag, features: built.features || {} };
  safeR = ARENA_R;
  roundStartedAt = Date.now();
  zones.length = 0;
  walls.length = 0;
  turrets.length = 0;
  proj.length = 0;
  genPickups();
  pickupsDirty = true;
  lbDirty = true;
  lastSentSafeR = -1;
  log(`🗺️ 地图切换 → ${def.name} (${def.tag})`);
}

function mapPickPayload(extra) {
  return Object.assign({
    t: 'mapPick',
    until: mapPickUntil,
    winnerId: mapPickWinnerId,
    maps: mapsList(),
    current: mapMeta.key
  }, extra || {});
}

function startMapPick(winner) {
  const now = Date.now();
  mapPickUntil = now + MAP_PICK_MS;
  mapPickWinnerId = winner ? winner.id : null;
  botMapPickAt = (winner && (winner.isBot || winner.isAgent)) ? now + 1600 : 0;
  for (const pl of players.values()) {
    pl.kills = 0; pl.deaths = 0; pl.assists = 0; pl.streak = 0;
    if (pl.dmgFrom) pl.dmgFrom.clear();
    clearPlayerFx(pl);
    respawn(pl, now);
  }
  obstaclesDirty = false;
  pickupsDirty = true;
  lbDirty = true;
  broadcast(mapPickPayload({
    winner: winner ? winner.name : '',
    ci: winner ? winner.ci : 0
  }));
}

function finishMapPick(choice, pickerName) {
  if (!mapPickUntil) return;
  mapPickUntil = 0;
  mapPickWinnerId = null;
  botMapPickAt = 0;
  const idx = resolveMapIndex(choice);
  loadMap(idx);
  const now = Date.now();
  for (const pl of players.values()) {
    clearPlayerFx(pl);
    respawn(pl, now);
  }
  obstaclesDirty = false;
  pickupsDirty = true;
  lbDirty = true;
  lastSentSafeR = -1;
  broadcast({
    t: 'map',
    map: mapPayload(),
    obstacles: packObstacles(),
    pickedBy: pickerName || '随机'
  });
  log(`🗺️ 选图确认 → ${mapMeta.name}` + (pickerName ? ` (by ${pickerName})` : ' (超时随机)'));
}

function genPickups() {
  pickups = [];
  for (let i = 0; i < 10; i++) {
    pickups.push({ x: 0, y: 0, type: i % 4, active: true, respawnAt: 0 });
    placePickup(pickups[pickups.length - 1]);
  }
}

function placePickup(pk) {
  for (let t = 0; t < 20; t++) {
    const a = rand(0, Math.PI * 2), d = rand(80, Math.min(safeR, ARENA_R) * 0.82);
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    let ok = true;
    for (const o of obstacles) {
      if (dist2(x, y, o.x, o.y) < (o.r + 30) * (o.r + 30)) { ok = false; break; }
    }
    if (ok) { pk.x = x; pk.y = y; return; }
  }
  const a = rand(0, Math.PI * 2), d = rand(0, ARENA_R * 0.6);
  pk.x = Math.cos(a) * d; pk.y = Math.sin(a) * d;
}

function spawnPos() {
  const lim = Math.min(safeR, ARENA_R) * 0.7;
  for (let t = 0; t < 40; t++) {
    const a = rand(0, Math.PI * 2), d = rand(0, lim);
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    let ok = true;
    for (const p of players.values()) {
      if (!p.alive) continue;
      if (dist2(x, y, p.x, p.y) < 220 * 220) { ok = false; break; }
    }
    for (const o of obstacles) {
      if (dist2(x, y, o.x, o.y) < (o.r + SHIP_R + 40) * (o.r + SHIP_R + 40)) { ok = false; break; }
    }
    if (ok) return { x, y };
  }
  return { x: rand(-300, 300), y: rand(-300, 300) };
}

function blankFx() {
  return {
    shieldUntil: 0, overdriveUntil: 0, phaseUntil: 0, speedUntil: 0, dmgUntil: 0, invulnUntil: 0,
    pierceUntil: 0, bloodUntil: 0, reflectUntil: 0, stormUntil: 0, siphonUntil: 0,
    slowUntil: 0, slowMult: 1, revealUntil: 0, stolenUntil: 0, stolenMult: 1
  };
}

function makePlayer(name, cls, ci) {
  const pos = spawnPos();
  const now = Date.now();
  return Object.assign({
    id: nextPid++,
    name: String(name || '飞行员').trim().slice(0, 14) || '飞行员',
    cls: clamp(Number(cls) || 0, 0, CLASSES.length - 1),
    ci: clamp(Number(ci) || 0, 0, COLORS.length - 1),
    x: pos.x, y: pos.y,
    angle: 0,
    hp: CLASSES[0].hp, maxHp: CLASSES[0].hp,
    energy: ENERGY_MAX,
    kills: 0, deaths: 0, wins: 0, assists: 0, streak: 0,
    alive: true, deadAt: 0,
    moveX: 0, moveY: 0, shooting: false,
    fireCd: 0,
    dashReadyAt: 0, abilityReadyAt: 0,
    dashUntil: 0, dashVx: 0, dashVy: 0,
    vx: 0, vy: 0,
    dmgFrom: new Map(),
    ping: 0, jitter: 0,
    socket: null
  }, blankFx(), { invulnUntil: now + SPAWN_GRACE_MS });
}

function setStats(p) {
  const c = CLASSES[p.cls];
  p.maxHp = c.hp;
  p.hp = c.hp;
  p.energy = ENERGY_MAX;
}

function clearPlayerFx(p) {
  const fx = blankFx();
  for (const k of Object.keys(fx)) p[k] = fx[k];
}

function respawn(p, now) {
  const pos = spawnPos();
  p.x = pos.x; p.y = pos.y;
  p.hp = p.maxHp;
  p.energy = ENERGY_MAX;
  p.alive = true;
  p.angle = 0;
  p.fireCd = 0;
  p.dashReadyAt = 0; p.abilityReadyAt = 0;
  p.dashUntil = 0;
  clearPlayerFx(p);
  p.invulnUntil = now + SPAWN_GRACE_MS;
  if (p.dmgFrom) p.dmgFrom.clear();
  if (p.socket) sendJSON(p.socket, { t: 'respawn' });
  if (p.isAgent) {
    pushAgentEvent(p, { type: 'respawn' });
    agentExec.setIntent(p, 'engage', {}, now, agentExec.INTENT_DEFAULT_MS);
  }
}

function mapPayload() {
  return {
    key: mapMeta.key, name: mapMeta.name, tag: mapMeta.tag,
    safeR: Math.round(safeR),
    grav: gravPoints.map((g) => [Math.round(g.x), Math.round(g.y), g.str]),
    healPads: healPads.map((h) => [Math.round(h.x), Math.round(h.y), h.r]),
    features: {
      shrink: !!mapMeta.features.shrink,
      destructible: !!mapMeta.features.destructible
    }
  };
}

/* ============================ WebSocket (RFC6455) ============================ */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsAccept = (key) => crypto.createHash('sha1').update(key + WS_GUID).digest('base64');

function sendFrame(socket, payload) {
  if (!socket || socket.destroyed || !socket.writable) return;
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2); header[0] = 0x81; header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, data]));
}
const sendJSON = (socket, obj) => {
  if (!socket || socket.destroyed) return;
  sendFrame(socket, JSON.stringify(obj));
};

function initPayload(extra) {
  return Object.assign({
    t: 'init', arenaR: ARENA_R, tick: TICK_MS,
    target: TARGET_KILLS, classes: CLASSES, colors: COLORS, pickupTypes: PICKUP_TYPES,
    maps: mapsList(),
    map: mapPayload(),
    obstacles: packObstacles(),
    pickups: pickups.map((k) => [k.x, k.y, k.type, k.active ? 1 : 0]),
    botCount, botsFight,
    mapPick: mapPickUntil ? mapPickPayload({
      winner: (() => {
        const w = players.get(mapPickWinnerId);
        return w ? w.name : '';
      })(),
      ci: (() => {
        const w = players.get(mapPickWinnerId);
        return w ? w.ci : 0;
      })()
    }) : null
  }, extra || {});
}

function applyBotSettings(count, fight, persist) {
  let changed = false;
  if (count != null && Number.isFinite(Number(count))) {
    const n = clamp(Math.round(Number(count)), 0, 3);
    if (n !== botCount) { botCount = n; changed = true; }
  }
  if (fight != null) {
    const f = !!fight;
    if (f !== botsFight) { botsFight = f; changed = true; }
  }
  const world = botWorld(Date.now(), 0);
  hellBots.syncBots(world, botCount);
  lbDirty = true;
  if (persist) saveConfig();
  if (changed) {
    log(`🤖 Bot 设置 → 数量 ${botCount} · 互殴 ${botsFight ? '开' : '关'}`);
    broadcast({ t: 'botSettings', botCount, botsFight });
  }
  return changed;
}

function attach(socket) {
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    socket._lastSeen = Date.now();
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > 1000000n) { socket.destroy(); return; }
        len = Number(big); off = 10;
      }
      let mask;
      if (masked) {
        if (buf.length < off + 4) return;
        mask = buf.subarray(off, off + 4); off += 4;
      }
      if (buf.length < off + len) return;
      let payload = buf.subarray(off, off + len);
      if (masked) {
        const u = Buffer.alloc(len);
        for (let i = 0; i < len; i++) u[i] = payload[i] ^ mask[i & 3];
        payload = u;
      }
      buf = buf.subarray(off + len);
      onFrame(socket, opcode, payload);
    }
  });
}

function onFrame(socket, opcode, payload) {
  if (opcode === 0x8) { socket.end(); return; }
  if (opcode === 0x9) { const h = Buffer.alloc(2); h[0] = 0x8a; h[1] = payload.length; socket.write(Buffer.concat([h, payload])); return; }
  if (opcode === 0xa) return;
  if (opcode !== 0x1 && opcode !== 0x2) return;
  let msg;
  try { msg = JSON.parse(payload.toString('utf8')); } catch { return; }
  handleMessage(socket, msg);
}

function handleMessage(socket, msg) {
  const p = socket._player;
  if (!msg || typeof msg !== 'object') return;

  if (msg.t === 'adminLogin' || msg.t === 'adminGet' || msg.t === 'adminSet' || msg.t === 'adminReset') {
    handleAdmin(socket, msg);
    return;
  }

  if (msg.t === 'spectate') {
    if (p || socket._spectator) return;
    if (msg.botCount != null || msg.botsFight != null) {
      applyBotSettings(msg.botCount, msg.botsFight, true);
    }
    socket._spectator = true;
    spectators.add(socket);
    sendJSON(socket, initPayload({ id: null, spectate: true }));
    log(`👁️ 观战加入 (观战 ${spectators.size} · 人类 ${countHumans()} · Bot ${countBots()} · Agent ${countAgents()})`);
    return;
  }

  // —— MCP Agent 协议 ——
  if (msg.t === 'agentStatus' || msg.t === 'agentSpectateSummary' || msg.t === 'agentJoin'
    || msg.t === 'agentIntent' || msg.t === 'agentObserve' || msg.t === 'agentLeave' || msg.t === 'agentHeartbeat'
    || msg.t === 'agentPlaybook' || msg.t === 'agentTactics') {
    handleAgentMessage(socket, msg);
    return;
  }

  if (msg.t === 'botSettings') {
    applyBotSettings(msg.botCount, msg.botsFight, true);
    sendJSON(socket, { t: 'botSettings', botCount, botsFight });
    return;
  }

  if (msg.t === 'join') {
    if (p || socket._spectator) return;
    if (msg.botCount != null || msg.botsFight != null) {
      applyBotSettings(msg.botCount, msg.botsFight, true);
    }
    const humansBefore = countHumans();
    const player = makePlayer(msg.name, msg.cls, msg.ci);
    setStats(player);
    player.socket = socket;
    socket._player = player;
    players.set(player.id, player);
    lbDirty = true;
    // 仅有 Bot / 空场时，首个人类的选图生效
    if (humansBefore === 0 && !mapPickUntil) {
      loadMap(resolveMapIndex(msg.map));
    }
    sendJSON(socket, initPayload({ id: player.id, spectate: false }));
    log(`🟢 ${player.name}(${CLASSES[player.cls].name}) 进入 · ${mapMeta.name} (人类 ${countHumans()} · 总 ${players.size})`);
  } else if (msg.t === 'pickMap' && p) {
    if (!mapPickUntil) return;
    finishMapPick(msg.map, p.name);
  } else if (msg.t === 'i' && p) {
    if (mapPickUntil) return;
    const mx = Number(msg.mx), my = Number(msg.my);
    if (Number.isFinite(mx)) p.moveX = clamp(mx, -1, 1);
    if (Number.isFinite(my)) p.moveY = clamp(my, -1, 1);
    if (Number.isFinite(msg.ang)) p.angle = msg.ang;
    p.shooting = !!msg.sh;
  } else if (msg.t === 'e' && p) {
    if (mapPickUntil) return;
    if (msg.e === 'dash') tryDash(p);
    else if (msg.e === 'ability') tryAbility(p);
  } else if (msg.t === 'pong' && p) {
    const ts = Number(msg.ts);
    if (Number.isFinite(ts) && ts > 0) {
      const rtt = Date.now() - ts;
      if (rtt >= 0 && rtt < 5000) {
        const prev = p.ping || rtt;
        p.ping = Math.round(prev * 0.7 + rtt * 0.3);
        const dev = Math.abs(rtt - p.ping);
        p.jitter = Math.round((p.jitter || dev) * 0.7 + dev * 0.3);
      }
    }
  }
}

function agentAuthOk(msg) {
  if (!AGENT_TOKEN) return true;
  return msg && msg.token === AGENT_TOKEN;
}

function resolveClassIndex(msg) {
  if (msg.classIndex != null && Number.isFinite(Number(msg.classIndex))) {
    return clamp(Math.round(Number(msg.classIndex)), 0, CLASSES.length - 1);
  }
  if (msg.cls != null && Number.isFinite(Number(msg.cls))) {
    return clamp(Math.round(Number(msg.cls)), 0, CLASSES.length - 1);
  }
  if (msg.classKey) {
    const key = String(msg.classKey);
    const idx = CLASSES.findIndex((c) => c.key === key);
    if (idx >= 0) return idx;
  }
  return 0;
}

function agentWorld(now) {
  return {
    now, players, proj, obstacles, pickups, healPads, safeR, zones, walls,
    spectators, CLASSES, COLORS, SHIP_R, ENERGY_MAX, ARENA_R, TARGET_KILLS,
    mapMeta, mapPickUntil, botCount, botsFight,
    tryDash, tryAbility
  };
}

function pushAgentEvent(p, ev) {
  if (!p || !p.isAgent) return;
  if (!p.agentEvents) p.agentEvents = [];
  p.agentEvents.push(Object.assign({ at: Date.now() }, ev));
  if (p.agentEvents.length > 20) p.agentEvents.splice(0, p.agentEvents.length - 20);
}

function removeAgentPlayer(p, reason) {
  if (!p || !p.isAgent) return;
  players.delete(p.id);
  turrets = turrets.filter((t) => t.ownerId !== p.id);
  zones = zones.filter((z) => z.ownerId !== p.id);
  walls = walls.filter((w) => w.ownerId !== p.id);
  lbDirty = true;
  log(`🟣 Agent 离场: ${p.name} (${reason || 'leave'}) · 剩余 Agent ${countAgents()}`);
}

function agentCatalogCtx() {
  return {
    CLASSES, COLORS, MAPS, TARGET_KILLS, PORT,
    lanIP, AGENT_TOKEN, MAX_MCP_AGENTS,
    botCount, botsFight, mapMeta,
    countHumans, countBots, countAgents
  };
}

function handleAgentMessage(socket, msg) {
  if (!agentAuthOk(msg)) {
    sendJSON(socket, { t: 'agentErr', err: 'unauthorized', msg: 'AGENT_TOKEN 不匹配' });
    return;
  }

  if (msg.t === 'agentPlaybook') {
    const catalog = agentBrief.buildCatalog(agentCatalogCtx());
    sendJSON(socket, {
      t: 'agentPlaybook',
      catalog,
      playbook: agentBrief.buildPlaybookMarkdown(catalog)
    });
    return;
  }

  if (msg.t === 'agentStatus') {
    sendJSON(socket, { t: 'agentStatus', status: agentExec.buildStatus(agentWorld(Date.now())) });
    return;
  }

  if (msg.t === 'agentSpectateSummary') {
    sendJSON(socket, {
      t: 'agentSpectateSummary',
      summary: agentExec.buildSpectateSummary(Object.assign(agentWorld(Date.now()), { now: Date.now() }))
    });
    return;
  }

  if (msg.t === 'agentJoin') {
    if (socket._spectator) {
      sendJSON(socket, { t: 'agentErr', err: 'spectator' });
      return;
    }
    if (socket._player) {
      sendJSON(socket, { t: 'agentErr', err: 'already_joined', agentId: socket._player.id });
      return;
    }
    if (countAgents() >= MAX_MCP_AGENTS) {
      sendJSON(socket, { t: 'agentErr', err: 'full', max: MAX_MCP_AGENTS });
      return;
    }
    const cls = resolveClassIndex(msg);
    const ci = clamp(Number(msg.ci) || Number(msg.colorIndex) || 0, 0, COLORS.length - 1);
    const humansBefore = countHumans();
    const player = makePlayer(msg.name || 'MCP特工', cls, ci);
    setStats(player);
    player.isAgent = true;
    player.socket = socket;
    player.agent = { strafe: 1, flipAt: 0, dodgeUntil: 0, lastAutoDodge: 0, lastIntentAt: 0, lastAutoAbility: 0 };
    player.agentEvents = [];
    player.lastAgentSeen = Date.now();
    player.tactics = agentBrief.normalizeTactics({ preset: 'balanced', autopilot: true });
    agentExec.setIntent(player, 'engage', {}, Date.now(), agentExec.INTENT_DEFAULT_MS);
    socket._player = player;
    players.set(player.id, player);
    lbDirty = true;
    if (humansBefore === 0 && countAgents() === 1 && !mapPickUntil && msg.map) {
      loadMap(resolveMapIndex(msg.map));
    }
    const obs = agentExec.buildObserve(player, agentWorld(Date.now()), []);
    sendJSON(socket, {
      t: 'agentJoined',
      agentId: player.id,
      name: player.name,
      cls: player.cls,
      classKey: CLASSES[player.cls].key,
      className: CLASSES[player.cls].name,
      observe: obs,
      intents: [...agentExec.VALID_INTENTS],
      hint: 'After join: set_tactics, then loop observe and ALWAYS tell the user 【战况】+【判断】.'
    });
    log(`🟣 Agent 进场: ${player.name}(${CLASSES[player.cls].name}) · Agent ${countAgents()}/${MAX_MCP_AGENTS}`);
    return;
  }

  const p = socket._player;
  if (!p || !p.isAgent) {
    if (msg.t !== 'agentJoin') {
      sendJSON(socket, { t: 'agentErr', err: 'not_joined' });
    }
    return;
  }
  p.lastAgentSeen = Date.now();

  if (msg.t === 'agentHeartbeat') {
    sendJSON(socket, { t: 'agentOk', alive: p.alive, agentId: p.id, tactics: p.tactics || null });
    return;
  }

  if (msg.t === 'agentTactics') {
    p.tactics = agentBrief.normalizeTactics(msg.tactics || msg);
    // 立刻按新战术刷一条意图
    const next = agentBrief.nextIntentFromTactics(p, agentWorld(Date.now()));
    agentExec.setIntent(p, next.type, next.params || {}, Date.now(), agentExec.INTENT_DEFAULT_MS);
    log(`🟣 [Agent] ${p.name} 战术=${p.tactics.preset} autopilot=${p.tactics.autopilot}`);
    sendJSON(socket, { t: 'agentTacticsOk', tactics: p.tactics, intent: p.intent });
    return;
  }

  if (msg.t === 'agentLeave') {
    removeAgentPlayer(p, 'leave');
    socket._player = null;
    sendJSON(socket, { t: 'agentLeft', ok: true });
    return;
  }

  if (msg.t === 'agentObserve') {
    const since = Number(msg.sinceSeq) || 0;
    let events = p.agentEvents || [];
    if (since > 0) events = events.filter((e) => (e.seq || e.at) > since);
    const obs = agentExec.buildObserve(p, agentWorld(Date.now()), events.slice(-12));
    obs.seq = Date.now();
    sendJSON(socket, { t: 'agentObserve', observe: obs });
    return;
  }

  if (msg.t === 'agentIntent') {
    if (mapPickUntil) {
      sendJSON(socket, { t: 'agentActResult', ok: false, err: 'map_pick' });
      return;
    }
    if (!p.alive) {
      sendJSON(socket, { t: 'agentActResult', ok: false, err: 'waiting_respawn' });
      return;
    }
    const now = Date.now();
    if (now - (p.agent.lastIntentAt || 0) < AGENT_INTENT_MIN_MS) {
      sendJSON(socket, { t: 'agentActResult', ok: false, err: 'rate_limited' });
      return;
    }
    p.agent.lastIntentAt = now;
    const type = String(msg.intent || msg.type || 'engage');
    const params = msg.params || {};
    if (msg.targetId != null) params.targetId = msg.targetId;
    if (msg.targetName) params.targetName = msg.targetName;
    if (msg.aggressive != null) params.aggressive = msg.aggressive;
    if (msg.dashDir) params.dashDir = msg.dashDir;
    if (msg.pickupType != null) params.pickupType = msg.pickupType;
    const dur = msg.durationMs != null ? Number(msg.durationMs) : agentExec.INTENT_DEFAULT_MS;
    const res = agentExec.setIntent(p, type, params, now, dur);
    if (!res.ok) {
      sendJSON(socket, { t: 'agentActResult', ok: false, err: res.err, valid: [...agentExec.VALID_INTENTS] });
      return;
    }
    log(`🟣 [Agent] ${p.name} 意图=${type}` + (params.targetName || params.targetId != null ? ` target=${params.targetName || params.targetId}` : ''));
    sendJSON(socket, {
      t: 'agentActResult',
      ok: true,
      intent: { type: res.intent.type, until: res.intent.until, leftMs: res.intent.until - now, params: res.intent.params }
    });
    return;
  }
}

/* ============================ 技能 / 冲刺 ============================ */
function tryDash(p) {
  const now = Date.now();
  const c = CLASSES[p.cls];
  if (!p.alive) return;
  if (now < p.dashReadyAt) return;
  if (p.energy < c.dashCost) return;
  p.energy -= c.dashCost;
  p.dashReadyAt = now + c.dashCd * 1000;
  let dx = p.moveX, dy = p.moveY;
  const mlen = Math.hypot(dx, dy);
  if (mlen < 0.2) { dx = Math.cos(p.angle); dy = Math.sin(p.angle); }
  else { dx /= mlen; dy /= mlen; }
  const dashSpeed = c.speed * 3.4;
  p.dashVx = dx * dashSpeed; p.dashVy = dy * dashSpeed;
  p.dashUntil = now + DASH_MS;
  p.invulnUntil = now + DASH_MS;
}

function tryAbility(p) {
  const now = Date.now();
  if (!p.alive) return;
  if (now < p.abilityReadyAt) return;
  const c = CLASSES[p.cls];
  p.abilityReadyAt = now + c.abilityCd * 1000;
  switch (p.cls) {
    case 0: p.overdriveUntil = now + 2500; break;
    case 1: p.shieldUntil = now + 1800; break;
    case 2: p.phaseUntil = now + 1300; break;
    case 3: p.pierceUntil = now + 3000; break;
    case 4: deployTurret(p); break;
    case 5: p.bloodUntil = now + 2500; break;
    case 6: // 束缚者: 重力阱
      zones.push({ id: nextZoneId++, kind: 'bind', x: p.x + Math.cos(p.angle) * 120, y: p.y + Math.sin(p.angle) * 120, r: 160, ownerId: p.id, ci: p.ci, until: now + 3500 });
      break;
    case 7: // 折射者
      p.reflectUntil = now + 1600;
      break;
    case 8: { // 信标
      const owned = zones.filter((z) => z.kind === 'beacon' && z.ownerId === p.id);
      for (const z of owned) zones.splice(zones.indexOf(z), 1);
      zones.push({ id: nextZoneId++, kind: 'beacon', x: p.x, y: p.y, r: 220, ownerId: p.id, ci: p.ci, until: now + 12000 });
      break;
    }
    case 9: // 爆破手炸弹
      zones.push({ id: nextZoneId++, kind: 'bomb', x: p.x + Math.cos(p.angle) * 40, y: p.y + Math.sin(p.angle) * 40, r: 28, blastR: 170, dmg: 55, ownerId: p.id, ci: p.ci, until: now + 1200 });
      break;
    case 10: // 风暴突进
      p.stormUntil = now + 750;
      p.invulnUntil = Math.max(p.invulnUntil, now + 200);
      break;
    case 11: { // 能量墙
      const owned = walls.filter((w) => w.ownerId === p.id);
      while (owned.length >= 2) {
        const old = owned.shift();
        walls.splice(walls.indexOf(old), 1);
      }
      const ang = p.angle + Math.PI / 2;
      const len = 110;
      const cx = p.x + Math.cos(p.angle) * 55;
      const cy = p.y + Math.sin(p.angle) * 55;
      walls.push({
        id: nextWallId++, ownerId: p.id, ci: p.ci,
        x1: cx - Math.cos(ang) * len, y1: cy - Math.sin(ang) * len,
        x2: cx + Math.cos(ang) * len, y2: cy + Math.sin(ang) * len,
        until: now + 6000, hp: 90
      });
      break;
    }
    case 12: // 残影
      zones.push({ id: nextZoneId++, kind: 'echo', x: p.x, y: p.y, r: 18, blastR: 150, dmg: 42, ownerId: p.id, ci: p.ci, until: now + 1500, ang: p.angle });
      break;
    case 13: // 汲取脉冲
      p.siphonUntil = now + 3500;
      break;
  }
}

function deployTurret(p) {
  const owned = turrets.filter((t) => t.ownerId === p.id);
  if (owned.length >= TURRET_MAX) {
    const old = owned[0];
    turrets.splice(turrets.indexOf(old), 1);
  }
  turrets.push({
    id: nextTurretId++, ownerId: p.id, x: p.x, y: p.y, angle: p.angle,
    hp: TURRET_HP, maxHp: TURRET_HP, fireCd: 0, life: TURRET_LIFE, ci: p.ci
  });
}

function fire(p, now) {
  const c = CLASSES[p.cls];
  const over = now < p.overdriveUntil;
  const cd = over ? c.fireCd * 0.38 : c.fireCd;
  let dmg = c.dmg;
  if (over) dmg *= 1.25;
  if (now < p.pierceUntil) dmg *= 1.4;
  if (now < p.bloodUntil) dmg *= 1.3;
  if (now < p.dmgUntil) dmg *= 1.5;
  const ls = now < p.bloodUntil ? 0.7 : (c.lifesteal || 0);
  const pierce = now < p.pierceUntil;
  const slowShot = p.cls === 6; // 束缚者普攻附带减速
  const siphonShot = now < p.siphonUntil;
  p.fireCd = cd;
  const ang = p.angle;
  const nx = p.x + Math.cos(ang) * (SHIP_R + c.pR + 3);
  const ny = p.y + Math.sin(ang) * (SHIP_R + c.pR + 3);
  proj.push({
    x: nx, y: ny,
    vx: Math.cos(ang) * c.pSpeed, vy: Math.sin(ang) * c.pSpeed,
    r: c.pR, dmg: Math.round(dmg), ownerId: p.id, life: c.pLife || BULLET_LIFE,
    pierce, ls, hit: pierce ? new Set() : null,
    slowShot, siphonShot
  });
}

function applyPickup(p, type, now) {
  if (type === 0) p.hp = Math.min(p.maxHp, p.hp + 45);
  else if (type === 1) p.energy = Math.min(ENERGY_MAX, p.energy + 60);
  else if (type === 2) p.speedUntil = now + 5000;
  else if (type === 3) p.dmgUntil = now + 5000;
}

function constrainCircle(p) {
  const d = Math.hypot(p.x, p.y) || 0.0001;
  const maxR = ARENA_R - SHIP_R;
  if (d > maxR) { p.x *= maxR / d; p.y *= maxR / d; }
}

function collideObstacles(p) {
  for (const o of obstacles) {
    const rr = SHIP_R + o.r;
    if (dist2(p.x, p.y, o.x, o.y) < rr * rr) {
      const dx = p.x - o.x, dy = p.y - o.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      p.x = o.x + dx / d * rr;
      p.y = o.y + dy / d * rr;
    }
  }
}

function segmentHit(px, py, qx, qy, x1, y1, x2, y2, rad) {
  // 线段到点的距离是否 < rad (近似: 点到线段)
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = x1 + dx * t, cy = y1 + dy * t;
  return dist2(px, py, cx, cy) < rad * rad;
}

function hurtPlayer(p, dmg, ownerId, dirX, dirY, now, opts) {
  opts = opts || {};
  if (!p.alive) return false;
  const owner = ownerId ? players.get(ownerId) : null;
  if (!botsFight && owner && owner.isBot && p.isBot) return false;
  const immune = now < p.shieldUntil || now < p.invulnUntil || now < p.phaseUntil;
  if (immune && !opts.ignoreImmune) return false;

  // 折射盾: 弹回给攻击者方向的新弹
  if (now < p.reflectUntil && opts.bullet) {
    const b = opts.bullet;
    const sp = Math.hypot(b.vx, b.vy) || 500;
    const nx = -b.vx / sp, ny = -b.vy / sp;
    proj.push({
      x: p.x + nx * (SHIP_R + b.r + 4), y: p.y + ny * (SHIP_R + b.r + 4),
      vx: nx * sp * 1.05, vy: ny * sp * 1.05,
      r: b.r, dmg: Math.round(b.dmg * 0.85), ownerId: p.id, life: 1.2,
      pierce: false, ls: 0, hit: null
    });
    return 'reflect';
  }

  p.hp -= dmg;
  if (!p.dmgFrom) p.dmgFrom = new Map();
  if (ownerId) p.dmgFrom.set(ownerId, now);
  if (dirX != null && dirY != null) {
    const bl = Math.hypot(dirX, dirY) || 1;
    p.x += dirX / bl * 4.5; p.y += dirY / bl * 4.5;
    constrainCircle(p);
  }
  if (opts.slow) {
    p.slowUntil = now + (opts.slowMs || 900);
    p.slowMult = opts.slowMult || 0.55;
  }
  if (opts.siphon && ownerId) {
    if (owner && owner.alive) {
      owner.stolenUntil = now + 2200;
      owner.stolenMult = 1.25;
      p.slowUntil = now + 2200;
      p.slowMult = 0.7;
    }
  }
  if (opts.ls > 0 && owner && owner.alive) {
    owner.hp = Math.min(owner.maxHp, owner.hp + dmg * opts.ls);
  }
  if (p.socket) sendJSON(p.socket, { t: 'hit', dmg, dir: Math.atan2(dirY || 0, dirX || 1) });
  if (owner && owner.socket) {
    sendJSON(owner.socket, { t: 'hc', x: Math.round(p.x), y: Math.round(p.y), dmg });
  }
  if (p.hp <= 0) kill(p, ownerId, now);
  return true;
}

function aoeDamage(x, y, r, dmg, ownerId, now) {
  for (const p of players.values()) {
    if (!p.alive || p.id === ownerId) continue;
    if (dist2(p.x, p.y, x, y) < (r + SHIP_R) * (r + SHIP_R)) {
      hurtPlayer(p, dmg, ownerId, p.x - x, p.y - y, now, { ignoreImmune: false });
    }
  }
  for (const t of turrets) {
    if (t.ownerId === ownerId) continue;
    if (dist2(t.x, t.y, x, y) < (r + TURRET_R) * (r + TURRET_R)) t.hp -= dmg;
  }
  // 残骸带: 爆炸也可碎掩体
  if (mapMeta.features.destructible) {
    let hit = false;
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      if (!o.destructible) continue;
      if (dist2(o.x, o.y, x, y) < (r + o.r) * (r + o.r)) {
        o.hp -= dmg;
        hit = true;
        if (o.hp <= 0) obstacles.splice(i, 1);
      }
    }
    if (hit) obstaclesDirty = true;
  }
}

/* ============================ 击杀 / 回合 ============================ */
function kill(p, killerId, now) {
  p.alive = false;
  p.deadAt = now;
  p.deaths++;
  p.hp = 0;
  p.streak = 0;
  clearPlayerFx(p);
  if (p.dmgFrom) {
    for (const [aid, t] of p.dmgFrom) {
      if (aid === killerId || now - t > 5000) continue;
      const asst = players.get(aid);
      if (asst) asst.assists = (asst.assists || 0) + 1;
    }
    p.dmgFrom.clear();
  }
  const killer = players.get(killerId);
  const kname = killer ? killer.name : '未知';
  let streak = 0;
  if (killer) {
    killer.kills++;
    killer.streak = (killer.streak || 0) + 1;
    streak = killer.streak;
  }
  if (p.socket) sendJSON(p.socket, { t: 'death', by: kname });
  if (p.isAgent) pushAgentEvent(p, { type: 'death', by: kname });
  if (killer && killer.isAgent) pushAgentEvent(killer, { type: 'kill', victim: p.name, streak });
  broadcast({ t: 'kill', k: kname, v: p.name, ci: killer ? killer.ci : 0, streak });
  lbDirty = true;
  if (killer && killer.kills >= TARGET_KILLS && !mapPickUntil) roundWin(killer);
}

function roundWin(p) {
  p.wins = (p.wins || 0) + 1;
  broadcast({ t: 'round', winner: p.name, ci: p.ci });
  startMapPick(p);
  log(`🏆 ${p.name} 率先达成 ${TARGET_KILLS} 杀, 进入选图`);
}

function botWorld(now, dt) {
  return {
    now, dt, players, proj, obstacles, pickups, healPads, safeR, zones, walls,
    turrets, CLASSES, COLORS, SHIP_R, ENERGY_MAX, mapPickUntil,
    botCount, botsFight,
    tryDash, tryAbility, makePlayer, setStats, log,
    dist2, clamp, rand
  };
}

/* ============================ 游戏循环 ============================ */
function tick(now, dt) {
  if (mapPickUntil) {
    if (botMapPickAt && now >= botMapPickAt) {
      botMapPickAt = 0;
      const w = players.get(mapPickWinnerId);
      finishMapPick('random', w ? w.name : null);
      return;
    }
    if (now >= mapPickUntil) finishMapPick('random', null);
    return;
  }

  // 地狱 Bot + MCP Agent 决策（写入 moveX/moveY/angle/shooting，再走同一套物理）
  const world = botWorld(now, dt);
  for (const p of players.values()) {
    if (p.isBot) hellBots.updateBot(p, world);
    else if (p.isAgent) agentExec.updateAgent(p, world);
  }

  // 脉冲井缩圈
  if (mapMeta.features.shrink) {
    const f = mapMeta.features;
    const t = Math.min(1, (now - roundStartedAt) / (f.shrinkSec * 1000));
    safeR = f.shrinkStart + (f.shrinkEnd - f.shrinkStart) * t;
  } else {
    safeR = ARENA_R;
  }

  for (const p of players.values()) {
    if (!p.alive) {
      if (now - p.deadAt >= RESPAWN_MS) respawn(p, now);
      continue;
    }
    const c = CLASSES[p.cls];
    const prevX = p.x, prevY = p.y;

    if (p.fireCd > 0) p.fireCd -= dt;
    p.energy = Math.min(ENERGY_MAX, p.energy + ENERGY_REGEN * dt);

    // 信标回能 + 反隐
    for (const z of zones) {
      if (z.kind !== 'beacon' || now >= z.until) continue;
      if (dist2(p.x, p.y, z.x, z.y) < z.r * z.r) {
        if (z.ownerId === p.id) p.energy = Math.min(ENERGY_MAX, p.energy + 18 * dt);
        else if (now < p.phaseUntil) p.revealUntil = now + 200;
      }
    }

    // 治疗点
    for (const h of healPads) {
      if (dist2(p.x, p.y, h.x, h.y) < h.r * h.r) {
        p.hp = Math.min(p.maxHp, p.hp + 22 * dt);
      }
    }

    // 束缚阱减速
    for (const z of zones) {
      if (z.kind !== 'bind' || now >= z.until || z.ownerId === p.id) continue;
      if (dist2(p.x, p.y, z.x, z.y) < z.r * z.r) {
        p.slowUntil = Math.max(p.slowUntil, now + 100);
        p.slowMult = Math.min(p.slowMult || 1, 0.45);
      }
    }

    let mvx = p.moveX, mvy = p.moveY;
    const mlen = Math.hypot(mvx, mvy);
    if (mlen > 1) { mvx /= mlen; mvy /= mlen; }

    if (now < p.stormUntil) {
      // 风暴突进: 沿瞄准方向高速推进, 刮伤节流避免刷屏
      const sp = c.speed * 2.8;
      p.x += Math.cos(p.angle) * sp * dt;
      p.y += Math.sin(p.angle) * sp * dt;
      if (!p._stormHitAt) p._stormHitAt = 0;
      if (now - p._stormHitAt > 90) {
        let hitAny = false;
        for (const oth of players.values()) {
          if (!oth.alive || oth.id === p.id) continue;
          if (dist2(p.x, p.y, oth.x, oth.y) < (SHIP_R * 2 + 10) * (SHIP_R * 2 + 10)) {
            hurtPlayer(oth, 12, p.id, Math.cos(p.angle), Math.sin(p.angle), now, {});
            hitAny = true;
          }
        }
        if (hitAny) p._stormHitAt = now;
      }
    } else if (now < p.dashUntil) {
      p.x += p.dashVx * dt; p.y += p.dashVy * dt;
    } else {
      let mult = 1;
      if (now < p.phaseUntil) mult *= 1.5;
      if (now < p.speedUntil) mult *= 1.35;
      if (now < p.bloodUntil) mult *= 1.25;
      if (now < p.stolenUntil) mult *= p.stolenMult || 1.25;
      if (now < p.slowUntil) mult *= p.slowMult || 0.55;
      p.x += mvx * c.speed * mult * dt;
      p.y += mvy * c.speed * mult * dt;
    }

    // 地图引力
    for (const g of gravPoints) {
      const dx = g.x - p.x, dy = g.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 520) {
        const f = (g.str * (1 - d / 520)) / d;
        p.x += dx * f * dt * 0.02;
        p.y += dy * f * dt * 0.02;
      }
    }

    constrainCircle(p);
    collideObstacles(p);

    // 缩圈伤害
    const pd = Math.hypot(p.x, p.y);
    if (pd > safeR - SHIP_R) {
      p.hp -= 18 * dt;
      if (p.hp <= 0) kill(p, null, now);
    }

    p.vx = (p.x - prevX) / Math.max(dt, 0.001);
    p.vy = (p.y - prevY) / Math.max(dt, 0.001);

    if (p.alive && p.shooting && p.fireCd <= 0) fire(p, now);
  }

  // 子弹
  for (let i = proj.length - 1; i >= 0; i--) {
    const b = proj[i];
    // 轻引力弯曲
    for (const g of gravPoints) {
      const dx = g.x - b.x, dy = g.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 480) {
        const f = g.str * 0.35 * (1 - d / 480) / d;
        b.vx += dx * f * dt;
        b.vy += dy * f * dt;
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;
    let dead = b.life <= 0 || (b.x * b.x + b.y * b.y) > ARENA_R * ARENA_R;

    if (!dead) {
      for (const o of obstacles) {
        const rr = o.r + b.r;
        if (dist2(b.x, b.y, o.x, o.y) < rr * rr) {
          if (o.destructible) {
            o.hp -= b.dmg;
            obstaclesDirty = true;
            if (o.hp <= 0) {
              const idx = obstacles.indexOf(o);
              if (idx >= 0) obstacles.splice(idx, 1);
            }
          }
          if (!b.pierce) { dead = true; break; }
        }
      }
    }

    // 能量墙挡弹
    if (!dead) {
      for (let wi = walls.length - 1; wi >= 0; wi--) {
        const w = walls[wi];
        if (now >= w.until) continue;
        if (w.ownerId === b.ownerId) continue;
        if (segmentHit(b.x, b.y, b.x, b.y, w.x1, w.y1, w.x2, w.y2, b.r + 6)) {
          w.hp -= b.dmg;
          if (w.hp <= 0) walls.splice(wi, 1);
          if (!b.pierce) { dead = true; break; }
        }
      }
    }

    if (!dead) {
      for (const p of players.values()) {
        if (!p.alive || p.id === b.ownerId) continue;
        if (b.hit && b.hit.has(p.id)) continue;
        const rr = SHIP_R + b.r;
        if (dist2(b.x, b.y, p.x, p.y) < rr * rr) {
          const res = hurtPlayer(p, b.dmg, b.ownerId, b.vx, b.vy, now, {
            bullet: b, ls: b.ls || 0,
            slow: b.slowShot, slowMs: 700, slowMult: 0.6,
            siphon: b.siphonShot
          });
          if (res === 'reflect') { dead = true; break; }
          if (res) {
            if (b.pierce) b.hit.add(p.id);
            else { dead = true; break; }
          } else if (!b.pierce) {
            // 免疫吞弹
            dead = true; break;
          }
        }
      }
    }
    if (!dead) {
      for (const t of turrets) {
        if (t.ownerId === b.ownerId) continue;
        const rr = TURRET_R + b.r;
        if (dist2(b.x, b.y, t.x, t.y) < rr * rr) {
          t.hp -= b.dmg;
          if (!b.pierce) { dead = true; break; }
        }
      }
    }
    if (dead) proj.splice(i, 1);
  }

  // 炮台
  for (let i = turrets.length - 1; i >= 0; i--) {
    const t = turrets[i];
    t.life -= dt;
    if (t.fireCd > 0) t.fireCd -= dt;
    let target = null, best = TURRET_RANGE * TURRET_RANGE;
    for (const p of players.values()) {
      if (!p.alive || p.id === t.ownerId) continue;
      if (!botsFight) {
        const owner = players.get(t.ownerId);
        if (owner && owner.isBot && p.isBot) continue;
      }
      // 相位且未被揭示则不锁
      if (Date.now() < p.phaseUntil && Date.now() >= p.revealUntil) continue;
      const d2 = dist2(t.x, t.y, p.x, p.y);
      if (d2 < best) { best = d2; target = p; }
    }
    if (target) {
      t.angle = Math.atan2(target.y - t.y, target.x - t.x);
      if (t.fireCd <= 0) {
        t.fireCd = TURRET_FIRE_CD;
        const nx = t.x + Math.cos(t.angle) * (TURRET_R + 4);
        const ny = t.y + Math.sin(t.angle) * (TURRET_R + 4);
        proj.push({ x: nx, y: ny, vx: Math.cos(t.angle) * 520, vy: Math.sin(t.angle) * 520, r: 4, dmg: TURRET_DMG, ownerId: t.ownerId, life: 0.9, pierce: false, ls: 0, hit: null });
      }
    }
    if (t.life <= 0 || t.hp <= 0) turrets.splice(i, 1);
  }

  // 区域实体
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    if (now >= z.until) {
      if (z.kind === 'bomb' || z.kind === 'echo') {
        aoeDamage(z.x, z.y, z.blastR, z.dmg, z.ownerId, now);
      }
      zones.splice(i, 1);
    }
  }
  for (let i = walls.length - 1; i >= 0; i--) {
    if (now >= walls[i].until || walls[i].hp <= 0) walls.splice(i, 1);
  }

  // 拾取物
  for (const pk of pickups) {
    if (!pk.active) {
      if (now >= pk.respawnAt) { pk.active = true; placePickup(pk); pickupsDirty = true; }
      continue;
    }
    for (const p of players.values()) {
      if (!p.alive) continue;
      if (dist2(p.x, p.y, pk.x, pk.y) < (SHIP_R + PK_R) * (SHIP_R + PK_R)) {
        applyPickup(p, pk.type, now);
        pk.active = false;
        pk.respawnAt = now + PK_RESPAWN_MS;
        pickupsDirty = true;
        break;
      }
    }
  }

  // 逻辑 60Hz，快照 30Hz，减半下行带宽
  snapSeq++;
  if ((snapSeq & 1) === 0) broadcastState(now);
}

function packFlags(pl, now) {
  const phaseVis = (now < pl.phaseUntil && now >= pl.revealUntil) ? 1 : (now < pl.phaseUntil ? 2 : 0);
  let f = 0;
  if (pl.alive) f |= 1;
  if (now < pl.shieldUntil) f |= 2;
  f |= (phaseVis & 3) << 2;
  if (now < pl.overdriveUntil) f |= 16;
  if (now < pl.speedUntil) f |= 32;
  if (now < pl.pierceUntil) f |= 64;
  if (now < pl.bloodUntil) f |= 128;
  if (now < pl.reflectUntil) f |= 256;
  if (now < pl.stormUntil) f |= 512;
  if (now < pl.siphonUntil) f |= 1024;
  if (now < pl.slowUntil) f |= 2048;
  if (now < pl.stolenUntil) f |= 4096;
  return f;
}

function broadcastState(now) {
  const pArr = [];
  for (const pl of players.values()) {
    // [id,x10,y10,ang100,hp,cls,ci,name,flags,vx,vy,ping] —— flags 打包原一串 0/1
    pArr.push([
      pl.id,
      Math.round(pl.x * 10), Math.round(pl.y * 10), Math.round(pl.angle * 100),
      Math.max(0, Math.round(pl.hp)), pl.cls, pl.ci, pl.name,
      packFlags(pl, now),
      Math.round(pl.vx), Math.round(pl.vy),
      pl.ping || 0
    ]);
  }
  const bArr = proj.map((b) => {
    const owner = players.get(b.ownerId);
    return [
      Math.round(b.x * 10), Math.round(b.y * 10), Math.round(b.vx), Math.round(b.vy),
      b.r, owner ? owner.ci : 0, b.pierce ? 1 : 0, b.ownerId
    ];
  });

  const base = { t: 's', p: pArr, b: bArr };
  if (turrets.length) {
    base.tr = turrets.map((t) => [t.id, Math.round(t.x), Math.round(t.y), Math.round(t.angle * 100), Math.round(t.hp), t.ci, t.ownerId]);
  }
  if (zones.length) {
    base.zn = zones.map((z) => [z.id, z.kind, Math.round(z.x), Math.round(z.y), Math.round(z.r), z.ci || 0, z.ownerId, Math.max(0, z.until - now), z.blastR || 0, Math.round((z.ang || 0) * 100)]);
  }
  if (walls.length) {
    base.wl = walls.map((w) => [w.id, Math.round(w.x1), Math.round(w.y1), Math.round(w.x2), Math.round(w.y2), w.ci || 0, Math.round(w.hp)]);
  }
  if (pickupsDirty) {
    base.pk = pickups.map((k) => [Math.round(k.x), Math.round(k.y), k.type, k.active ? 1 : 0]);
    pickupsDirty = false;
  }
  if (lbDirty) {
    base.lb = [...players.values()]
      .filter((p) => p.alive)
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .slice(0, 8)
      .map((p) => [p.name, p.kills, p.deaths, p.ci, p.wins || 0, p.assists || 0]);
    lbDirty = false;
  }
  const sr = Math.round(safeR);
  if (sr !== lastSentSafeR) {
    base.safeR = sr;
    lastSentSafeR = sr;
  }
  if (obstaclesDirty) {
    base.ob = packObstacles();
    obstaclesDirty = false;
  }

  const shared = JSON.stringify(base);
  const sharedHead = shared.slice(0, -1);
  for (const pl of players.values()) {
    if (!pl.socket) continue;
    // my: [hp,maxHp,energy,kills,deaths,wins,assists,streak,dashCdCs,abilityCdCs,alive,ping,jitter]
    const my = JSON.stringify([
      Math.max(0, Math.round(pl.hp)), pl.maxHp, Math.round(pl.energy),
      pl.kills, pl.deaths, pl.wins || 0, pl.assists || 0, pl.streak || 0,
      Math.max(0, Math.round((pl.dashReadyAt - now) / 10)),
      Math.max(0, Math.round((pl.abilityReadyAt - now) / 10)),
      pl.alive ? 1 : 0, pl.ping || 0, pl.jitter || 0
    ]);
    sendFrame(pl.socket, sharedHead + ',"my":' + my + '}');
  }
  // 观战端只收公共快照
  if (spectators.size) {
    for (const s of spectators) sendFrame(s, shared);
  }
}

function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const p of players.values()) {
    if (p.socket) sendFrame(p.socket, payload);
  }
  for (const s of spectators) sendFrame(s, payload);
}

/* ============================ 管理员配置(热更新) ============================ */
const ADMIN_FIELDS = ['hp', 'speed', 'fireCd', 'dmg', 'pSpeed', 'pR', 'dashCd', 'dashCost', 'abilityCd', 'lifesteal'];
const ADMIN_LIMITS = {
  hp: [1, 10000], speed: [0, 2000], fireCd: [0.01, 10], dmg: [0, 1000], pSpeed: [0, 3000],
  pR: [1, 60], dashCd: [0, 30], dashCost: [0, 100], abilityCd: [0, 60], lifesteal: [0, 3]
};

function handleAdmin(socket, msg) {
  if (msg.t === 'adminLogin') {
    if (String(msg.pw) === ADMIN_PW) {
      socket._isAdmin = true;
      sendJSON(socket, { t: 'adminOk', config: getConfigPayload() });
    } else {
      sendJSON(socket, { t: 'adminErr', msg: '密码错误' });
    }
    return;
  }
  if (!socket._isAdmin) { sendJSON(socket, { t: 'adminErr', msg: '未登录' }); return; }

  if (msg.t === 'adminGet') {
    sendJSON(socket, { t: 'adminOk', config: getConfigPayload() });
  } else if (msg.t === 'adminSet') {
    const err = applyConfig(msg.config);
    if (err) { sendJSON(socket, { t: 'adminErr', msg: err }); return; }
    saveConfig();
    broadcastConfig();
    sendJSON(socket, { t: 'adminOk', config: getConfigPayload() });
  } else if (msg.t === 'adminReset') {
    resetConfig();
    saveConfig();
    broadcastConfig();
    sendJSON(socket, { t: 'adminOk', config: getConfigPayload() });
  }
}

function getConfigPayload() {
  return {
    targetKills: TARGET_KILLS,
    botCount,
    botsFight,
    map: mapPayload(),
    maps: mapsList(),
    classes: CLASSES.map((c) => ({
      key: c.key, name: c.name, tag: c.tag, ability: c.ability,
      hp: c.hp, speed: c.speed, fireCd: c.fireCd, dmg: c.dmg, pSpeed: c.pSpeed, pR: c.pR,
      dashCd: c.dashCd, dashCost: c.dashCost, abilityCd: c.abilityCd, lifesteal: c.lifesteal || 0
    }))
  };
}

function resyncPlayers() {
  for (const p of players.values()) {
    const c = CLASSES[p.cls];
    p.maxHp = c.hp;
    if (p.hp > p.maxHp) p.hp = p.maxHp;
  }
}

function applyConfig(cfg) {
  if (!cfg || !Array.isArray(cfg.classes) || cfg.classes.length !== CLASSES.length) return '配置格式错误(职业数量需为 ' + CLASSES.length + ')';
  for (let i = 0; i < cfg.classes.length; i++) {
    const src = cfg.classes[i], dst = CLASSES[i];
    for (const k of ADMIN_FIELDS) {
      const v = Number(src == null || src[k] == null ? 0 : src[k]);
      if (!Number.isFinite(v)) return `职业 ${i + 1} 的字段 ${k} 非法`;
      dst[k] = clamp(v, ADMIN_LIMITS[k][0], ADMIN_LIMITS[k][1]);
    }
  }
  const tk = Number(cfg.targetKills);
  if (Number.isFinite(tk)) TARGET_KILLS = clamp(Math.round(tk), 1, 1000);
  if (cfg.botCount != null && Number.isFinite(Number(cfg.botCount))) {
    botCount = clamp(Math.round(Number(cfg.botCount)), 0, 3);
  }
  if (cfg.botsFight != null) botsFight = !!cfg.botsFight;
  resyncPlayers();
  return null;
}

function resetConfig() {
  for (let i = 0; i < CLASSES.length; i++) {
    const d = DEFAULT_CLASSES[i];
    for (const k in d) CLASSES[i][k] = d[k];
  }
  TARGET_KILLS = DEFAULT_TARGET_KILLS;
  resyncPlayers();
}

function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(getConfigPayload(), null, 2)); }
  catch (e) { log('保存配置失败: ' + e.message); }
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      const err = applyConfig(cfg);
      if (err) log('配置读取失败(使用默认): ' + err);
    }
  } catch (e) { log('配置读取失败(使用默认): ' + e.message); }
}

function broadcastConfig() {
  const payload = JSON.stringify(Object.assign({ t: 'config' }, getConfigPayload()));
  for (const s of allSockets) sendFrame(s, payload);
}

/* ============================ HTTP + upgrade ============================ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(getConfigPayload()));
    return;
  }
  if (url === '/agent' || url === '/agent/' || url === '/agent/playbook.md') {
    const catalog = agentBrief.buildCatalog(agentCatalogCtx());
    const md = agentBrief.buildPlaybookMarkdown(catalog);
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(md);
    return;
  }
  if (url === '/agent/catalog.json') {
    const catalog = agentBrief.buildCatalog(agentCatalogCtx());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(catalog, null, 2));
    return;
  }
  const file = url === '/' ? '/index.html'
    : (url === '/admin' ? '/admin.html'
    : (url === '/favicon.ico' ? '/favicon.svg' : url));
  const filePath = path.normalize(path.join(PUBLIC_DIR, file));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
  );
  socket._player = null;
  socket._lastSeen = Date.now();
  socket.setNoDelay(true);
  allSockets.add(socket);
  socket.on('close', () => onClose(socket));
  socket.on('error', () => {});
  attach(socket);
});

function onClose(socket) {
  allSockets.delete(socket);
  if (socket._spectator) {
    spectators.delete(socket);
    log(`👁️ 观战离开 (观战 ${spectators.size})`);
    return;
  }
  const p = socket._player;
  if (!p) return;
  if (p.isAgent) {
    removeAgentPlayer(p, 'disconnect');
    return;
  }
  players.delete(p.id);
  turrets = turrets.filter((t) => t.ownerId !== p.id);
  zones = zones.filter((z) => z.ownerId !== p.id);
  walls = walls.filter((w) => w.ownerId !== p.id);
  lbDirty = true;
  log(`🔴 ${p.name} 离开竞技场 (人类 ${countHumans()} · 总 ${players.size})`);
}

setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) {
    if (p.isAgent) {
      if (now - (p.lastAgentSeen || 0) > AGENT_IDLE_MS) {
        const sock = p.socket;
        removeAgentPlayer(p, 'idle');
        if (sock) {
          try { sock._player = null; } catch (_) {}
        }
      }
      continue;
    }
    if (!p.socket) continue;
    if (now - p.socket._lastSeen > 60000) { p.socket.destroy(); continue; }
    const h = Buffer.alloc(2); h[0] = 0x89; h[1] = 0;
    p.socket.write(h);
  }
  for (const s of spectators) {
    if (now - s._lastSeen > 60000) { s.destroy(); continue; }
    const h = Buffer.alloc(2); h[0] = 0x89; h[1] = 0;
    s.write(h);
  }
}, 2000);

setInterval(() => {
  const ts = Date.now();
  const payload = JSON.stringify({ t: 'ping', ts });
  for (const p of players.values()) {
    if (p.socket) sendFrame(p.socket, payload);
  }
  for (const s of spectators) sendFrame(s, payload);
}, 1000);

function lanIP() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of ifs[name]) {
      if (it.family === 'IPv4' && !it.internal) return it.address;
    }
  }
  return '127.0.0.1';
}

loadMap(0);
loadConfig();
hellBots.syncBots(botWorld(Date.now(), 0), botCount);

server.listen(PORT, HOST, () => {
  console.log('========================================================');
  console.log('  ⚡ 脉冲竞技场 Pulse Arena —— 多人联机竞技场服务器');
  console.log('  本机访问:     http://localhost:' + PORT);
  console.log('  局域网访问:   http://' + lanIP() + ':' + PORT);
  console.log('  地图: ' + MAPS.map((m) => m.name).join(' / '));
  console.log('  职业: ' + CLASSES.length + ' 款 · 开局/回合后可选图或随机');
  console.log('  地狱 Bot:    ' + botCount + ' 台 · 互殴 ' + (botsFight ? '开' : '关') + ' (首页可调)');
  console.log('  MCP Agent:   最多 ' + MAX_MCP_AGENTS + ' · token ' + (AGENT_TOKEN ? '已启用' : '关闭(建议局域网设 AGENT_TOKEN)'));
  console.log('  Agent手册:   http://localhost:' + PORT + '/agent');
  console.log('              http://' + lanIP() + ':' + PORT + '/agent');
  console.log('  MCP 接入:    docs/mcp-接入说明书.md');
  if (!AGENT_TOKEN) {
    console.log('  ⚠ 未设置 AGENT_TOKEN：局域网内任意客户端可 agentJoin');
  }
  console.log('========================================================');
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, (now - lastTick) / 1000);
  lastTick = now;
  tick(now, dt);
}, TICK_MS);
