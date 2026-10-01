'use strict';
/*
 * MCP Agent Intent Executor —— 把大模型高层意图翻译成每 tick 底层输入
 * 复用地狱 Bot 的预瞄 / LOS / 距离表；子弹贴脸时强制 autoDodge
 * 支持 tactics 自动驾驶（意图超时后按战术刷新）
 */
const hell = require('./hell-bots');
const brief = require('./agent-brief');

const INTENT_DEFAULT_MS = 2000;
const VALID_INTENTS = new Set([
  'engage', 'kite', 'rush', 'hold_cover', 'grab_pickup',
  'dash', 'ability', 'idle', 'retreat_edge'
]);

const DIR_BANDS = [
  [22.5, 'E'], [67.5, 'NE'], [112.5, 'N'], [157.5, 'NW'],
  [202.5, 'W'], [247.5, 'SW'], [292.5, 'S'], [337.5, 'SE'], [360, 'E']
];

function bearing(dx, dy) {
  let deg = Math.atan2(-dy, dx) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  for (const [max, label] of DIR_BANDS) {
    if (deg <= max) return label;
  }
  return 'E';
}

function distBand(d) {
  if (d < 180) return 'melee';
  if (d < 400) return 'close';
  if (d < 700) return 'mid';
  if (d < 1000) return 'far';
  return 'extreme';
}

function hpBand(hp, maxHp) {
  const f = maxHp > 0 ? hp / maxHp : 0;
  if (f > 0.7) return 'high';
  if (f > 0.35) return 'mid';
  if (f > 0) return 'low';
  return 'dead';
}

function resolveTarget(agent, players, intent) {
  const params = intent.params || {};
  if (params.targetId != null) {
    const t = players.get(Number(params.targetId));
    if (t && t.alive && t.id !== agent.id) return t;
  }
  if (params.targetName) {
    const name = String(params.targetName);
    for (const o of players.values()) {
      if (o.alive && o.id !== agent.id && o.name === name) return o;
    }
  }
  if (intent.targetId != null) {
    const t = players.get(Number(intent.targetId));
    if (t && t.alive && t.id !== agent.id) return t;
  }
  let best = null, bestD = Infinity;
  for (const o of players.values()) {
    if (!o.alive || o.id === agent.id) continue;
    const d = Math.hypot(o.x - agent.x, o.y - agent.y);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

function tryAutoDodge(agent, ctx) {
  const { now, proj, tryDash } = ctx;
  if (!agent.agent) return false;
  if (now < (agent.agent.dodgeUntil || 0)) return false;
  if (now < agent.dashReadyAt) return false;
  let danger = null, bestT = 0.4;
  for (const b of proj) {
    if (b.ownerId === agent.id) continue;
    const dx = agent.x - b.x, dy = agent.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 300 || dist < 8) continue;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const approach = (b.vx * dx + b.vy * dy) / (sp * dist);
    if (approach < 0.55) continue;
    const tHit = dist / sp;
    if (tHit < bestT) {
      const cross = Math.abs(b.vx * dy - b.vy * dx) / sp;
      if (cross < 28 + (b.r || 4)) { bestT = tHit; danger = b; }
    }
  }
  if (!danger) return false;
  const sp = Math.hypot(danger.vx, danger.vy) || 1;
  let px = -danger.vy / sp, py = danger.vx / sp;
  if ((agent.x - danger.x) * px + (agent.y - danger.y) * py < 0) { px = -px; py = -py; }
  agent.moveX = px; agent.moveY = py;
  agent.angle = Math.atan2(py, px);
  tryDash(agent);
  agent.agent.dodgeUntil = now + 280;
  agent.agent.lastAutoDodge = now;
  return true;
}

function setIntent(agent, type, params, now, durationMs) {
  if (!VALID_INTENTS.has(type)) return { ok: false, err: 'invalid_intent' };
  const ms = Math.max(400, Math.min(5000, durationMs || INTENT_DEFAULT_MS));
  const p = params || {};
  agent.intent = {
    type,
    targetId: p.targetId != null ? Number(p.targetId) : null,
    until: now + ms,
    params: p,
    setAt: now
  };
  // 一次性动作立即标记
  if (type === 'dash' || type === 'ability') agent.intent.fireOnce = true;
  return { ok: true, intent: agent.intent };
}

function updateAgent(agent, ctx) {
  if (!agent.isAgent || !agent.alive) {
    if (agent.isAgent) {
      agent.moveX = 0; agent.moveY = 0; agent.shooting = false;
    }
    return;
  }
  const { now, mapPickUntil, CLASSES, SHIP_R, obstacles, pickups, healPads, safeR, players, tryDash, tryAbility } = ctx;
  if (mapPickUntil) {
    agent.moveX = 0; agent.moveY = 0; agent.shooting = false;
    return;
  }

  if (!agent.intent || now >= agent.intent.until) {
    // 有战术则自动驾驶；否则默认 engage，避免站桩
    if (agent.tactics && agent.tactics.autopilot !== false) {
      const next = brief.nextIntentFromTactics(agent, ctx);
      setIntent(agent, next.type, next.params || {}, now, INTENT_DEFAULT_MS);
    } else {
      setIntent(agent, 'engage', agent.intent ? agent.intent.params : {}, now, INTENT_DEFAULT_MS);
    }
  }

  if (tryAutoDodge(agent, ctx)) {
    agent.shooting = false;
    return;
  }

  const intent = agent.intent;
  const type = intent.type;
  const c = CLASSES[agent.cls];
  const [rmin, rmax] = hell.preferredRange(agent.cls);
  const target = resolveTarget(agent, players, intent);
  const aggressive = clamp01(intent.params && intent.params.aggressive != null ? intent.params.aggressive : 0.6);

  let goalX = agent.x, goalY = agent.y;
  let wantShoot = false;
  let strafe = (agent.agent && agent.agent.strafe) || 1;
  if (agent.agent && now > (agent.agent.flipAt || 0)) {
    agent.agent.strafe = -strafe;
    agent.agent.flipAt = now + 600 + Math.random() * 800;
    strafe = agent.agent.strafe;
  }

  // 缩圈回撤
  const pd = Math.hypot(agent.x, agent.y);
  if (pd > safeR - 100) {
    goalX = agent.x * 0.65;
    goalY = agent.y * 0.65;
  }

  if (type === 'idle') {
    agent.moveX = 0; agent.moveY = 0; agent.shooting = false;
    return;
  }

  if (type === 'retreat_edge') {
    const a = Math.atan2(agent.y, agent.x) || 0;
    goalX = Math.cos(a) * Math.min(pd + 200, safeR - 120);
    goalY = Math.sin(a) * Math.min(pd + 200, safeR - 120);
    if (target) {
      agent.angle = hell.leadAim(agent.x, agent.y, target.x, target.y, target.vx || 0, target.vy || 0, c.pSpeed);
      const dist = Math.hypot(target.x - agent.x, target.y - agent.y);
      wantShoot = hell.hasLOS(agent.x, agent.y, target.x, target.y, obstacles, SHIP_R) && dist < rmax + 120;
    }
  } else if (type === 'grab_pickup') {
    const pkType = intent.params && intent.params.pickupType != null ? Number(intent.params.pickupType) : null;
    const pk = hell.nearestPickup(agent, pickups, pkType);
    if (pk) { goalX = pk.x; goalY = pk.y; }
    else if (healPads[0] && (pkType === 0 || pkType == null)) {
      goalX = healPads[0].x; goalY = healPads[0].y;
    }
    if (target) {
      agent.angle = hell.leadAim(agent.x, agent.y, target.x, target.y, target.vx || 0, target.vy || 0, c.pSpeed);
      const dist = Math.hypot(target.x - agent.x, target.y - agent.y);
      wantShoot = hell.hasLOS(agent.x, agent.y, target.x, target.y, obstacles, SHIP_R) && dist < rmax + 80;
    }
  } else if (type === 'hold_cover') {
    const cover = hell.coverPoint(agent, target, obstacles);
    if (cover) { goalX = cover.x; goalY = cover.y; }
    if (target) {
      agent.angle = hell.leadAim(agent.x, agent.y, target.x, target.y, target.vx || 0, target.vy || 0, c.pSpeed);
      const dist = Math.hypot(target.x - agent.x, target.y - agent.y);
      const los = hell.hasLOS(agent.x, agent.y, target.x, target.y, obstacles, SHIP_R);
      wantShoot = los && dist < rmax + 100;
    }
  } else if (type === 'dash' && intent.fireOnce) {
    intent.fireOnce = false;
    const dir = (intent.params && intent.params.dashDir) || 'away';
    let dx = 0, dy = 0;
    if (target) {
      const tx = target.x - agent.x, ty = target.y - agent.y;
      const d = Math.hypot(tx, ty) || 1;
      const nx = tx / d, ny = ty / d;
      if (dir === 'toward') { dx = nx; dy = ny; }
      else if (dir === 'strafe') { dx = -ny * strafe; dy = nx * strafe; }
      else { dx = -nx; dy = -ny; }
    } else {
      dx = Math.cos(agent.angle); dy = Math.sin(agent.angle);
    }
    agent.moveX = dx; agent.moveY = dy;
    agent.angle = Math.atan2(dy, dx);
    tryDash(agent);
    agent.shooting = false;
    return;
  } else if (type === 'ability' && intent.fireOnce) {
    intent.fireOnce = false;
    if (target) {
      agent.angle = Math.atan2(target.y - agent.y, target.x - agent.x);
    }
    tryAbility(agent);
    // 放完技能后继续 engage 行为
    intent.type = 'engage';
  }

  // engage / kite / rush /（ability 转 engage）共用瞄准与走位
  if (type === 'engage' || type === 'kite' || type === 'rush' || type === 'ability') {
    if (target) {
      const dist = Math.hypot(target.x - agent.x, target.y - agent.y);
      const los = hell.hasLOS(agent.x, agent.y, target.x, target.y, obstacles, SHIP_R);
      agent.angle = hell.leadAim(agent.x, agent.y, target.x, target.y, target.vx || 0, target.vy || 0, c.pSpeed)
        + (Math.random() - 0.5) * 0.03;
      const tx = target.x - agent.x, ty = target.y - agent.y;
      const nx = tx / (dist || 1), ny = ty / (dist || 1);
      const px = -ny * strafe, py = nx * strafe;

      let preferMin = rmin, preferMax = rmax;
      if (type === 'rush') { preferMin = 60; preferMax = Math.min(rmax, 220); }
      if (type === 'kite') { preferMin = rmax * 0.75; preferMax = rmax + 80; }
      preferMin *= (1 - aggressive * 0.15);
      preferMax *= (1 - aggressive * 0.1);

      if (dist > preferMax) {
        goalX = agent.x + nx * 200 + px * 70;
        goalY = agent.y + ny * 200 + py * 70;
      } else if (dist < preferMin) {
        goalX = agent.x - nx * 180 + px * 100;
        goalY = agent.y - ny * 180 + py * 100;
      } else {
        goalX = agent.x + px * 150;
        goalY = agent.y + py * 150;
      }
      wantShoot = los && dist < preferMax + 180 && dist > 35;
      if (agent.cls === 3 && !los) wantShoot = false;
    } else {
      const a = now * 0.00035 + agent.id;
      goalX = Math.cos(a) * 300;
      goalY = Math.sin(a) * 300;
    }
  }

  let mx = goalX - agent.x, my = goalY - agent.y;
  const ml = Math.hypot(mx, my);
  if (ml > 8) { mx /= ml; my /= ml; }
  else { mx = 0; my = 0; }
  agent.moveX = mx;
  agent.moveY = my;
  agent.shooting = wantShoot;
}

function clamp01(v) {
  v = Number(v);
  if (!Number.isFinite(v)) return 0.6;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function buildObserve(agent, ctx, events) {
  const { now, players, proj, pickups, safeR, ARENA_R, CLASSES, TARGET_KILLS, mapMeta, mapPickUntil, SHIP_R, obstacles } = ctx;
  const self = {
    id: agent.id,
    name: agent.name,
    cls: agent.cls,
    classKey: CLASSES[agent.cls] ? CLASSES[agent.cls].key : 'unknown',
    className: CLASSES[agent.cls] ? CLASSES[agent.cls].name : '?',
    alive: !!agent.alive,
    hp: Math.round(agent.hp),
    maxHp: agent.maxHp,
    energy: Math.round(agent.energy),
    x: Math.round(agent.x),
    y: Math.round(agent.y),
    ang: Math.round(agent.angle * 100) / 100,
    dashCd: Math.max(0, Math.round((agent.dashReadyAt - now) / 100) / 10),
    abilityCd: Math.max(0, Math.round((agent.abilityReadyAt - now) / 100) / 10),
    kills: agent.kills || 0,
    deaths: agent.deaths || 0,
    assists: agent.assists || 0,
    streak: agent.streak || 0
  };

  const enemies = [];
  for (const o of players.values()) {
    if (o.id === agent.id || !o.alive) continue;
    const dx = o.x - agent.x, dy = o.y - agent.y;
    const d = Math.hypot(dx, dy);
    const phase = now < o.phaseUntil && now >= o.revealUntil;
    enemies.push({
      id: o.id,
      name: o.name,
      cls: o.cls,
      className: CLASSES[o.cls] ? CLASSES[o.cls].name : '?',
      kind: o.isBot ? 'bot' : o.isAgent ? 'agent' : 'human',
      dist: Math.round(d),
      distBand: distBand(d),
      bearing: bearing(dx, dy),
      hpBand: hpBand(o.hp, o.maxHp),
      phase: !!phase,
      isBot: !!o.isBot,
      isAgent: !!o.isAgent,
      los: hell.hasLOS(agent.x, agent.y, o.x, o.y, obstacles, SHIP_R)
    });
  }
  enemies.sort((a, b) => a.dist - b.dist);
  if (enemies.length > 8) enemies.length = 8;

  let threatBullets = 0;
  for (const b of proj) {
    if (b.ownerId === agent.id) continue;
    const d = Math.hypot(b.x - agent.x, b.y - agent.y);
    if (d < 280) threatBullets++;
  }

  const pkList = [];
  for (const pk of pickups) {
    if (!pk.active) continue;
    const d = Math.hypot(pk.x - agent.x, pk.y - agent.y);
    pkList.push({ type: pk.type, dist: Math.round(d), bearing: bearing(pk.x - agent.x, pk.y - agent.y) });
  }
  pkList.sort((a, b) => a.dist - b.dist);
  if (pkList.length > 4) pkList.length = 4;

  const intent = agent.intent;
  const observe = {
    map: { key: mapMeta.key, name: mapMeta.name, safeR: Math.round(safeR), arenaR: ARENA_R, picking: !!mapPickUntil },
    self,
    enemies,
    hazards: {
      nearbyBullets: threatBullets,
      shrinkPressure: safeR < ARENA_R - 10 ? Math.round((ARENA_R - safeR) / ARENA_R * 100) : 0,
      autoDodgeAt: agent.agent && agent.agent.lastAutoDodge ? agent.agent.lastAutoDodge : 0
    },
    pickups: pkList,
    score: {
      kills: self.kills,
      deaths: self.deaths,
      target: TARGET_KILLS,
      toWin: Math.max(0, TARGET_KILLS - self.kills)
    },
    intent: intent ? {
      type: intent.type,
      targetId: intent.targetId,
      leftMs: Math.max(0, intent.until - now),
      params: intent.params || {}
    } : null,
    tactics: agent.tactics || null,
    clock: { serverTime: now, intentLeftMs: intent ? Math.max(0, intent.until - now) : 0 },
    events: events || []
  };
  observe.report = buildReportCard(observe);
  return observe;
}

function buildReportCard(obs) {
  const s = obs.self;
  const hpPct = s.maxHp > 0 ? Math.round(s.hp / s.maxHp * 100) : 0;
  const nearest = obs.enemies[0] || null;
  const lowEnemies = obs.enemies.filter((e) => e.hpBand === 'low');
  const humans = obs.enemies.filter((e) => e.kind === 'human');
  const facts = [];
  facts.push('地图「' + (obs.map.name || '?') + '」' + (obs.map.picking ? '（选图中）' : ''));
  if (!s.alive) {
    facts.push('我已阵亡，等待复活');
  } else {
    facts.push('我(' + s.className + ') 血量 ' + s.hp + '/' + s.maxHp + '（' + hpPct + '%）· 能量 ' + s.energy +
      ' · 击杀 ' + obs.score.kills + '/' + obs.score.target + '（还差 ' + obs.score.toWin + '）');
    facts.push('当前意图 ' + (obs.intent ? obs.intent.type : '无') +
      (obs.tactics ? ' · 战术 ' + (obs.tactics.preset || obs.tactics.style) : ''));
  }
  if (nearest) {
    facts.push('最近敌人「' + nearest.name + '」[' + nearest.kind + '/' + nearest.className + '] ' +
      nearest.distBand + '·' + nearest.bearing + '·血' + nearest.hpBand + (nearest.los ? '·可见' : '·遮挡'));
  } else {
    facts.push('附近暂无敌方存活单位');
  }
  if (lowEnemies.length) {
    facts.push('残血可追：' + lowEnemies.slice(0, 3).map((e) => e.name).join('、'));
  }
  if (humans.length) {
    facts.push('场上人类：' + humans.map((e) => e.name + '(' + e.hpBand + ')').join('、'));
  }
  if (obs.hazards.nearbyBullets > 0) {
    facts.push('近距来弹约 ' + obs.hazards.nearbyBullets + ' 发');
  }
  if (obs.hazards.shrinkPressure > 0) {
    facts.push('缩圈压力 ' + obs.hazards.shrinkPressure + '%');
  }
  if (obs.pickups.length) {
    const names = ['治疗', '能量', '加速', '增伤'];
    facts.push('近拾取：' + obs.pickups.slice(0, 2).map((p) => (names[p.type] || '?') + '@' + p.dist).join('、'));
  }
  if (obs.events && obs.events.length) {
    const last = obs.events[obs.events.length - 1];
    if (last && last.type) facts.push('近况事件：' + last.type + (last.by ? ' by ' + last.by : '') + (last.victim ? ' → ' + last.victim : ''));
  }

  // 客观提示（不是最终判断；模型须自己写「判断」）
  const hints = [];
  if (!s.alive) hints.push('复活后优先确认最近威胁再交战');
  else if (hpPct <= 35) hints.push('血线危险，优先治疗/掩体或拉开');
  else if (hpPct <= 55 && obs.hazards.nearbyBullets >= 2) hints.push('中血且弹雨，考虑 dash/风筝');
  if (nearest && nearest.hpBand === 'low' && nearest.los && hpPct > 40) hints.push('最近目标残血可见，可追击');
  if (obs.score.toWin <= 1 && s.alive) hints.push('接近胜利，别浪、优先稳杀');
  if (humans.length && (!nearest || nearest.kind !== 'human')) hints.push('有人类在场，可按战术决定是否优先针对');

  return {
    mustTellUser: true,
    format: [
      '【战况】用 2～4 句中文陈述下面 facts（可改写，勿谎报数值）',
      '【判断】用 1～2 句写出你自己的局势判断与下一步打算（必须是你的推理，不要只复读 hints）'
    ],
    facts,
    objectiveHints: hints,
    example:
      '【战况】裂谷环，我血量 62%，击杀 1/3；最近是「地狱·影刃」中距离南方可见。\n' +
      '【判断】对方是狙击，我中血不宜硬刚，先斜向接近掩体再找机会 rush；若看到治疗包优先补血。'
  };
}

function buildStatus(ctx) {
  const { players, spectators, mapMeta, TARGET_KILLS, botCount, botsFight, safeR, mapPickUntil } = ctx;
  let humans = 0, bots = 0, agents = 0;
  const roster = [];
  for (const p of players.values()) {
    if (p.isBot) bots++;
    else if (p.isAgent) agents++;
    else humans++;
    roster.push({
      id: p.id, name: p.name, kind: p.isBot ? 'bot' : p.isAgent ? 'agent' : 'human',
      cls: p.cls, kills: p.kills || 0, alive: !!p.alive
    });
  }
  roster.sort((a, b) => b.kills - a.kills);
  return {
    online: true,
    map: { key: mapMeta.key, name: mapMeta.name, safeR: Math.round(safeR), picking: !!mapPickUntil },
    targetKills: TARGET_KILLS,
    counts: { humans, bots, agents, spectators: spectators ? spectators.size : 0, botSlots: botCount },
    botsFight: !!botsFight,
    leaderboard: roster.slice(0, 10)
  };
}

function buildSpectateSummary(ctx) {
  const status = buildStatus(ctx);
  const { players, CLASSES, now } = ctx;
  const t = now || Date.now();
  const fighters = [];
  for (const p of players.values()) {
    if (!p.alive) continue;
    fighters.push({
      name: p.name,
      kind: p.isBot ? 'bot' : p.isAgent ? 'agent' : 'human',
      className: CLASSES[p.cls] ? CLASSES[p.cls].name : '?',
      hpBand: hpBand(p.hp, p.maxHp),
      kills: p.kills || 0,
      x: Math.round(p.x),
      y: Math.round(p.y)
    });
  }
  return Object.assign({}, status, { fighters, serverTime: t });
}

module.exports = {
  VALID_INTENTS,
  INTENT_DEFAULT_MS,
  setIntent,
  updateAgent,
  buildObserve,
  buildStatus,
  buildSpectateSummary,
  resolveTarget,
  normalizeTactics: brief.normalizeTactics
};
