'use strict';
/*
 * 地狱难度 AI —— 预瞄、冲刺躲弹、职业技能时机、掩体与拾取
 * desiredCount / botsFight 由 server 运行时配置（首页可调 0~3）
 */

const DEFAULT_BOT_COUNT = Math.max(0, Math.min(3, Number(process.env.BOT_COUNT) || 3));
const BOT_NAMES = ['地狱·赤炎', '地狱·影刃', '地狱·崩雷', '地狱·虚空'];
// 强势组合：突击 / 狙击 / 狂战 / 幻影
const BOT_CLASSES = [0, 3, 5, 2];

function preferredRange(cls) {
  switch (cls) {
    case 3: return [620, 920];      // 狙击
    case 1: return [280, 480];      // 泰坦
    case 5: return [70, 200];       // 狂战
    case 10: return [90, 260];      // 风暴
    case 2: return [160, 340];      // 幻影
    case 4: return [360, 560];      // 工程
    case 9: return [220, 420];      // 爆破
    case 6: return [260, 480];      // 束缚
    default: return [240, 480];
  }
}

function hasLOS(ax, ay, bx, by, obstacles, shipR) {
  const dx = bx - ax, dy = by - ay;
  const dist = Math.hypot(dx, dy) || 1;
  const steps = Math.max(4, Math.ceil(dist / 28));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + dx * t, y = ay + dy * t;
    for (const o of obstacles) {
      if ((x - o.x) * (x - o.x) + (y - o.y) * (y - o.y) < (o.r + shipR * 0.35) * (o.r + shipR * 0.35)) {
        return false;
      }
    }
  }
  return true;
}

function leadAim(sx, sy, tx, ty, tvx, tvy, bulletSpeed) {
  let px = tx, py = ty;
  for (let i = 0; i < 3; i++) {
    const dx = px - sx, dy = py - sy;
    const dist = Math.hypot(dx, dy);
    const t = dist / Math.max(120, bulletSpeed);
    px = tx + tvx * t;
    py = ty + tvy * t;
  }
  return Math.atan2(py - sy, px - sx);
}

function nearestPickup(bot, pickups, typeFilter) {
  let best = null, bestD = Infinity;
  for (const pk of pickups) {
    if (!pk.active) continue;
    if (typeFilter != null && pk.type !== typeFilter) continue;
    const d = (pk.x - bot.x) * (pk.x - bot.x) + (pk.y - bot.y) * (pk.y - bot.y);
    if (d < bestD) { bestD = d; best = pk; }
  }
  return best;
}

function coverPoint(bot, threat, obstacles) {
  if (!threat || !obstacles.length) return null;
  let best = null, bestScore = -Infinity;
  for (const o of obstacles) {
    const dx = o.x - threat.x, dy = o.y - threat.y;
    const d = Math.hypot(dx, dy) || 1;
    const hx = o.x + (dx / d) * (o.r + 28);
    const hy = o.y + (dy / d) * (o.r + 28);
    const toBot = Math.hypot(hx - bot.x, hy - bot.y);
    const score = 400 - toBot + o.r;
    if (score > bestScore) { bestScore = score; best = { x: hx, y: hy }; }
  }
  return best;
}

function removeBot(ctx, p) {
  const { players } = ctx;
  players.delete(p.id);
  if (Array.isArray(ctx.turrets)) {
    for (let i = ctx.turrets.length - 1; i >= 0; i--) {
      if (ctx.turrets[i].ownerId === p.id) ctx.turrets.splice(i, 1);
    }
  }
  if (Array.isArray(ctx.zones)) {
    for (let i = ctx.zones.length - 1; i >= 0; i--) {
      if (ctx.zones[i].ownerId === p.id) ctx.zones.splice(i, 1);
    }
  }
  if (Array.isArray(ctx.walls)) {
    for (let i = ctx.walls.length - 1; i >= 0; i--) {
      if (ctx.walls[i].ownerId === p.id) ctx.walls.splice(i, 1);
    }
  }
  ctx.log && ctx.log(`🤖 地狱 Bot 撤场: ${p.name}`);
}

function syncBots(ctx, desiredCount) {
  const { players, makePlayer, setStats, COLORS } = ctx;
  const want = Math.max(0, Math.min(3, desiredCount | 0));
  const list = [...players.values()].filter((p) => p.isBot);
  while (list.length > want) {
    const p = list.pop();
    removeBot(ctx, p);
  }
  let bots = list.length;
  while (bots < want) {
    const i = bots;
    const cls = BOT_CLASSES[i % BOT_CLASSES.length];
    const ci = ((i * 3) + 1) % (COLORS ? COLORS.length : 12);
    const p = makePlayer(BOT_NAMES[i % BOT_NAMES.length], cls, ci);
    p.isBot = true;
    p.socket = null;
    p.bot = {
      strafe: (i % 2 ? 1 : -1),
      flipAt: 0,
      lockId: null,
      lockUntil: 0,
      rethinkAt: 0,
      dodgeUntil: 0
    };
    setStats(p);
    players.set(p.id, p);
    list.push(p);
    bots++;
    ctx.log && ctx.log(`🤖 地狱 Bot 登场: ${p.name}(${ctx.CLASSES[p.cls].name})`);
  }
}

function ensureBots(ctx) {
  syncBots(ctx, ctx.botCount != null ? ctx.botCount : DEFAULT_BOT_COUNT);
}

function pickTarget(bot, players, now, obstacles, shipR, botsFight) {
  const b = bot.bot;
  if (b.lockId != null && now < b.lockUntil) {
    const locked = players.get(b.lockId);
    if (locked && locked.alive && locked.id !== bot.id) {
      if (botsFight || !locked.isBot) return locked;
    }
  }
  let best = null, bestScore = Infinity;
  for (const o of players.values()) {
    if (!o.alive || o.id === bot.id) continue;
    if (!botsFight && o.isBot) continue;
    // 相位且未揭示：地狱难度仍「半感知」——仅当很近才锁
    if (now < o.phaseUntil && now >= o.revealUntil) {
      const d2 = (o.x - bot.x) * (o.x - bot.x) + (o.y - bot.y) * (o.y - bot.y);
      if (d2 > 220 * 220) continue;
    }
    const d = Math.hypot(o.x - bot.x, o.y - bot.y);
    const los = hasLOS(bot.x, bot.y, o.x, o.y, obstacles, shipR);
    const hpFrac = o.hp / Math.max(1, o.maxHp);
    const score = d * (los ? 0.55 : 1.35) + hpFrac * 180 - (o.kills || 0) * 12;
    if (score < bestScore) { bestScore = score; best = o; }
  }
  if (best) {
    b.lockId = best.id;
    b.lockUntil = now + 900 + Math.random() * 700;
  }
  return best;
}

function tryDodge(bot, ctx) {
  const { now, proj, tryDash } = ctx;
  if (now < bot.bot.dodgeUntil) return false;
  if (now < bot.dashReadyAt) return false;
  let danger = null, bestT = 0.42;
  for (const b of proj) {
    if (b.ownerId === bot.id) continue;
    const dx = bot.x - b.x, dy = bot.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 320 || dist < 8) continue;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const approach = (b.vx * dx + b.vy * dy) / (sp * dist);
    if (approach < 0.55) continue;
    const tHit = dist / sp;
    if (tHit < bestT) {
      // 横向偏移是否真的擦到
      const cross = Math.abs(b.vx * dy - b.vy * dx) / sp;
      if (cross < 28 + (b.r || 4)) { bestT = tHit; danger = b; }
    }
  }
  if (!danger) return false;
  const sp = Math.hypot(danger.vx, danger.vy) || 1;
  // 垂直于弹道方向冲刺
  let px = -danger.vy / sp, py = danger.vx / sp;
  if ((bot.x - danger.x) * px + (bot.y - danger.y) * py < 0) { px = -px; py = -py; }
  bot.moveX = px; bot.moveY = py;
  bot.angle = Math.atan2(py, px);
  tryDash(bot);
  bot.bot.dodgeUntil = now + 280;
  return true;
}

function useAbility(bot, target, los, dist, ctx) {
  const { now, tryAbility, CLASSES } = ctx;
  if (now < bot.abilityReadyAt || !bot.alive) return;
  const cls = bot.cls;
  const hpFrac = bot.hp / Math.max(1, bot.maxHp);
  let go = false;
  switch (cls) {
    case 0: go = target && los && dist < 520; break;
    case 1: go = hpFrac < 0.55 || (target && dist < 360); break;
    case 2: go = (target && dist < 380) || hpFrac < 0.4; break;
    case 3: go = target && los && dist > 280; break;
    case 4: go = !target || dist < 600; break;
    case 5: go = target && dist < 280; break;
    case 6: go = target && dist < 420; break;
    case 7: go = now < bot.bot.dodgeUntil + 200 || (target && dist < 400); break;
    case 8: go = true; break;
    case 9: go = target && dist < 380; break;
    case 10: go = target && dist < 320 && los; break;
    case 11: go = target && dist < 500; break;
    case 12: go = target && (dist < 360 || hpFrac < 0.5); break;
    case 13: go = target && los && dist < 480; break;
    default: go = !!target;
  }
  if (!go) return;
  // 面向目标再放技能
  if (target) bot.angle = Math.atan2(target.y - bot.y, target.x - bot.x);
  tryAbility(bot);
}

function updateBot(bot, ctx) {
  if (!bot.isBot || !bot.bot) return;
  const {
    now, players, proj, obstacles, pickups, healPads, safeR,
    CLASSES, SHIP_R, tryDash, mapPickUntil
  } = ctx;

  if (mapPickUntil || !bot.alive) {
    bot.moveX = 0; bot.moveY = 0; bot.shooting = false;
    return;
  }

  if (tryDodge(bot, ctx)) {
    bot.shooting = false;
    return;
  }

  const c = CLASSES[bot.cls];
  const [rmin, rmax] = preferredRange(bot.cls);
  const target = pickTarget(bot, players, now, obstacles, SHIP_R, ctx.botsFight !== false);
  const bstate = bot.bot;

  if (now > bstate.flipAt) {
    bstate.strafe *= -1;
    bstate.flipAt = now + 550 + Math.random() * 900;
  }

  let goalX = bot.x, goalY = bot.y;
  let wantShoot = false;
  let dist = 0;
  let los = false;

  // 缩圈边缘回撤
  const pd = Math.hypot(bot.x, bot.y);
  if (pd > safeR - 90) {
    goalX = bot.x * 0.7;
    goalY = bot.y * 0.7;
  }

  const hpFrac = bot.hp / Math.max(1, bot.maxHp);
  if (hpFrac < 0.42) {
    const heal = nearestPickup(bot, pickups, 0) || (healPads[0] ? { x: healPads[0].x, y: healPads[0].y } : null);
    const cover = coverPoint(bot, target, obstacles);
    if (heal && Math.hypot(heal.x - bot.x, heal.y - bot.y) < 700) {
      goalX = heal.x; goalY = heal.y;
    } else if (cover) {
      goalX = cover.x; goalY = cover.y;
    }
  }

  if (bot.energy < 35) {
    const en = nearestPickup(bot, pickups, 1);
    if (en && Math.hypot(en.x - bot.x, en.y - bot.y) < 450) {
      goalX = en.x; goalY = en.y;
    }
  }

  // 抢增伤/加速
  if (hpFrac > 0.5) {
    const buff = nearestPickup(bot, pickups, 3) || nearestPickup(bot, pickups, 2);
    if (buff && Math.hypot(buff.x - bot.x, buff.y - bot.y) < 380) {
      goalX = buff.x; goalY = buff.y;
    }
  }

  if (target) {
    dist = Math.hypot(target.x - bot.x, target.y - bot.y);
    los = hasLOS(bot.x, bot.y, target.x, target.y, obstacles, SHIP_R);
    const ang = leadAim(bot.x, bot.y, target.x, target.y, target.vx || 0, target.vy || 0, c.pSpeed);
    // 地狱级准星：极小抖动
    bot.angle = ang + (Math.random() - 0.5) * 0.018;

    const tx = target.x - bot.x, ty = target.y - bot.y;
    const nx = tx / (dist || 1), ny = ty / (dist || 1);
    const px = -ny * bstate.strafe, py = nx * bstate.strafe;

    if (hpFrac >= 0.42 || !coverPoint(bot, target, obstacles)) {
      if (dist > rmax) {
        goalX = bot.x + nx * 200 + px * 90;
        goalY = bot.y + ny * 200 + py * 90;
      } else if (dist < rmin) {
        goalX = bot.x - nx * 180 + px * 110;
        goalY = bot.y - ny * 180 + py * 110;
      } else {
        goalX = bot.x + px * 160 - nx * 20;
        goalY = bot.y + py * 160 - ny * 20;
      }
    }

    // 贴脸职业强压
    if ((bot.cls === 5 || bot.cls === 10 || bot.cls === 2) && dist > 140 && los) {
      goalX = target.x - nx * 60;
      goalY = target.y - ny * 60;
    }

    wantShoot = los && dist < rmax + 160 && dist > 40;
    // 狙击未开视野不盲射
    if (bot.cls === 3 && !los) wantShoot = false;

    useAbility(bot, target, los, dist, ctx);

    // 进攻性冲刺：贴脸职业切入 / 远程拉开
    if (now >= bot.dashReadyAt && bot.energy >= c.dashCost) {
      if ((bot.cls === 2 || bot.cls === 5 || bot.cls === 10) && dist > 200 && dist < 480 && los) {
        bot.moveX = nx; bot.moveY = ny;
        tryDash(bot);
      } else if ((bot.cls === 3 || bot.cls === 1) && dist < rmin && hpFrac < 0.7) {
        bot.moveX = -nx; bot.moveY = -ny;
        tryDash(bot);
      }
    }
  } else {
    // 无目标：向中心扫场 + 轻微游走
    const a = now * 0.0004 + bot.id;
    goalX = Math.cos(a) * 280;
    goalY = Math.sin(a) * 280;
  }

  let mx = goalX - bot.x, my = goalY - bot.y;
  const ml = Math.hypot(mx, my);
  if (ml > 8) { mx /= ml; my /= ml; }
  else { mx = 0; my = 0; }

  bot.moveX = mx;
  bot.moveY = my;
  bot.shooting = wantShoot;
}

module.exports = {
  DEFAULT_BOT_COUNT,
  syncBots,
  ensureBots,
  updateBot,
  preferredRange,
  hasLOS,
  leadAim,
  nearestPickup,
  coverPoint
};
