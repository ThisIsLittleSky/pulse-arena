'use strict';
/*
 * Agent 自助说明书 / 目录 —— 供 HTTP 与 MCP 下发
 * 大模型先读这里，再向用户确认昵称/职业/战术，然后进场持续对局
 */

const TACTIC_PRESETS = [
  {
    key: 'balanced',
    name: '均衡交战',
    desc: '默认交战距离输出，残血找治疗/掩体',
    style: 'balanced',
    aggressive: 0.6,
    preferAbility: true,
    lowHpPickup: true
  },
  {
    key: 'aggressive',
    name: '猛攻贴脸',
    desc: 'rush 为主，适合狂战/风暴/幻影',
    style: 'aggressive',
    aggressive: 0.9,
    preferAbility: true,
    lowHpPickup: true
  },
  {
    key: 'defensive',
    name: '稳健防守',
    desc: '掩体风筝，少硬刚，适合泰坦/编织',
    style: 'defensive',
    aggressive: 0.35,
    preferAbility: true,
    lowHpPickup: true
  },
  {
    key: 'sniper',
    name: '远程风筝',
    desc: 'kite + 技能，适合狙击/束缚',
    style: 'sniper',
    aggressive: 0.45,
    preferAbility: true,
    lowHpPickup: true
  },
  {
    key: 'brawler',
    name: '近战绞杀',
    desc: '持续 rush，适合狂战/汲取',
    style: 'brawler',
    aggressive: 0.85,
    preferAbility: true,
    lowHpPickup: false
  },
  {
    key: 'loot',
    name: '抢包发育',
    desc: '优先拾取，再交战',
    style: 'loot',
    aggressive: 0.5,
    preferAbility: false,
    lowHpPickup: true
  }
];

function buildCatalog(ctx) {
  const {
    CLASSES, COLORS, MAPS, TARGET_KILLS, PORT, lanIP, AGENT_TOKEN,
    MAX_MCP_AGENTS, botCount, botsFight, mapMeta, countHumans, countBots, countAgents
  } = ctx;
  const hostLan = lanIP();
  const baseLocal = 'http://127.0.0.1:' + PORT;
  const baseLan = 'http://' + hostLan + ':' + PORT;

  const classes = CLASSES.map((c, i) => ({
    index: i,
    key: c.key,
    name: c.name,
    tag: c.tag,
    ability: c.ability,
    abilityCd: c.abilityCd,
    hp: c.hp,
    speed: c.speed,
    fireCd: c.fireCd,
    dpsHint: Math.round((c.dmg / c.fireCd) * 10) / 10,
    dmg: c.dmg,
    pSpeed: c.pSpeed,
    dashCd: c.dashCd,
    dashCost: c.dashCost,
    lifesteal: c.lifesteal || 0,
    tips: classTips(i)
  }));

  return {
    game: 'Pulse Arena',
    version: 1,
    urls: {
      play: baseLan + '/',
      playLocal: baseLocal + '/',
      agentHome: baseLan + '/agent',
      playbook: baseLan + '/agent/playbook.md',
      playbookLocal: baseLocal + '/agent/playbook.md',
      catalog: baseLan + '/agent/catalog.json',
      catalogLocal: baseLocal + '/agent/catalog.json'
    },
    connection: {
      arenaHostHint: hostLan,
      arenaPort: PORT,
      agentTokenRequired: !!AGENT_TOKEN,
      maxMcpAgents: MAX_MCP_AGENTS,
      note: 'MCP env: ARENA_HOST=' + hostLan + ' ARENA_PORT=' + PORT + (AGENT_TOKEN ? ' AGENT_TOKEN=<same as server>' : '')
    },
    rules: {
      mode: 'FFA',
      targetKills: TARGET_KILLS,
      everyoneIsEnemy: true,
      toolsOnly: [
        'arena_playbook', 'arena_status', 'arena_join', 'arena_set_tactics',
        'arena_observe', 'arena_act', 'arena_leave', 'arena_spectate_summary'
      ],
      intentsOnly: [
        'engage', 'kite', 'rush', 'hold_cover', 'grab_pickup', 'dash', 'ability', 'idle', 'retreat_edge'
      ],
      cannot: [
        'WASD/mouse per-frame input',
        'admin config / cheat',
        'multi-mech in one MCP session'
      ]
    },
    live: {
      map: mapMeta ? { key: mapMeta.key, name: mapMeta.name } : null,
      humans: countHumans(),
      bots: countBots(),
      agents: countAgents(),
      botSlots: botCount,
      botsFight: !!botsFight
    },
    classes,
    colors: COLORS.map((hex, i) => ({ index: i, hex })),
    maps: MAPS.map((m) => ({ key: m.key, name: m.name, tag: m.tag })),
    tacticsPresets: TACTIC_PRESETS,
    workflow: [
      '1. 读取 /agent/playbook.md 或调用 arena_playbook',
      '2. 把 classes + tacticsPresets 用中文列给用户，请用户选定：昵称、职业、战术、是否一直打',
      '3. arena_join → arena_set_tactics（开启 autopilot）',
      '4. 持续循环：每隔 1–2 秒 arena_observe；每次必须用中文向用户输出【战况】+【判断】；必要时 arena_act 微调',
      '5. 用户叫停 → arena_leave'
    ],
    reportDuty: {
      everyObserve: true,
      sections: ['战况', '判断'],
      rules: [
        '战况：基于 observe.report.facts，2～4 句，数值勿瞎编',
        '判断：必须是模型自己的局势推理与下一步打算，1～2 句；可参考 objectiveHints 但不要照抄',
        '不要只回 tool JSON 给用户；要对用户说话'
      ]
    },
    askUserTemplate: [
      '呼号（昵称，≤14字）？',
      '职业：看下面属性表选一个 classKey？',
      '战术预设：balanced / aggressive / defensive / sniper / brawler / loot？',
      '额外战术备注（可选，如：优先打人类、残血必撤）？',
      '确认后我将进场，持续对局，并定期汇报战况与我的判断，直到你说停。'
    ]
  };
}

function classTips(i) {
  const tips = {
    0: '均衡持续输出，技能狂暴加射速',
    1: '高血坦克，护盾硬抗',
    2: '刺客，相位切入切出',
    3: '超远高爆，穿甲弹清线',
    4: '炮台阵地战',
    5: '近战吸血绞肉',
    6: '减速控制',
    7: '反弹弹道博弈',
    8: '回能与反隐',
    9: '范围爆破',
    10: '冲锋刮伤',
    11: '能量墙挡弹',
    12: '残影欺诈爆炸',
    13: '窃取移速削弱'
  };
  return tips[i] || '';
}

function buildPlaybookMarkdown(catalog) {
  const lines = [];
  lines.push('# Pulse Arena · Agent 自助 Playbook');
  lines.push('');
  lines.push('> 大模型：先读本文或 `arena_playbook`，再向**用户**确认昵称/职业/战术，然后进场**持续对局**。');
  lines.push('');
  lines.push('## 入口地址');
  lines.push('');
  lines.push('| 用途 | URL |');
  lines.push('|------|-----|');
  lines.push('| 说明书(本页) | `' + catalog.urls.playbook + '` |');
  lines.push('| 结构化目录 | `' + catalog.urls.catalog + '` |');
  lines.push('| 人类游戏/观战 | `' + catalog.urls.play + '` |');
  lines.push('| 本机说明书 | `' + catalog.urls.playbookLocal + '` |');
  lines.push('');
  lines.push('MCP 连接：`' + catalog.connection.note + '`');
  lines.push('');
  lines.push('## 你必须遵守的边界');
  lines.push('');
  lines.push('- **只用** tools：' + catalog.rules.toolsOnly.join(', '));
  lines.push('- **意图仅限**：' + catalog.rules.intentsOnly.join(', '));
  lines.push('- **禁止**：' + catalog.rules.cannot.join('；'));
  lines.push('- 模式 **FFA**：人类 / Bot / 其它 Agent 都是敌人；先到 **' + catalog.rules.targetKills + '** 杀获胜');
  lines.push('');
  lines.push('## 标准工作流');
  lines.push('');
  catalog.workflow.forEach((w) => lines.push('- ' + w));
  lines.push('');
  lines.push('## 向用户提问（直接发给用户）');
  lines.push('');
  catalog.askUserTemplate.forEach((q, i) => lines.push((i + 1) + '. ' + q));
  lines.push('');
  lines.push('## 可选职业与属性');
  lines.push('');
  lines.push('| # | key | 名称 | 定位 | 生命 | 移速 | 伤害 | 攻速间隔 | 技能 | 提示 |');
  lines.push('|---|-----|------|------|------|------|------|----------|------|------|');
  for (const c of catalog.classes) {
    lines.push(
      '| ' + c.index + ' | `' + c.key + '` | ' + c.name + ' | ' + c.tag +
      ' | ' + c.hp + ' | ' + c.speed + ' | ' + c.dmg + ' | ' + c.fireCd +
      's | ' + c.ability + '(' + c.abilityCd + 's) | ' + c.tips + ' |'
    );
  }
  lines.push('');
  lines.push('## 战术预设（arena_set_tactics.preset）');
  lines.push('');
  for (const t of catalog.tacticsPresets) {
    lines.push('- **' + t.key + '** · ' + t.name + '：' + t.desc +
      '（aggressive=' + t.aggressive + ', preferAbility=' + t.preferAbility + '）');
  }
  lines.push('');
  lines.push('## 持续对局与战况汇报（必做）');
  lines.push('');
  lines.push('1. `arena_join` 后立刻 `arena_set_tactics`（`autopilot: true`）。');
  lines.push('2. 服务端会按战术自动刷新意图（一直在打），MCP 会自动 heartbeat。');
  lines.push('3. **每隔约 1–2 秒** `arena_observe`，然后**必须对用户说话**，格式固定：');
  lines.push('');
  lines.push('```text');
  lines.push('【战况】……（2～4 句，引用 observe.report.facts，勿谎报）');
  lines.push('【判断】……（1～2 句，你自己的局势判断 + 下一步打算；可参考 report.objectiveHints，禁止只复读）');
  lines.push('```');
  lines.push('');
  lines.push('4. 必要时再用 `arena_act` 覆盖一波意图。');
  lines.push('5. 用户说「停 / 退出」→ `arena_leave`。');
  lines.push('');
  lines.push('汇报示例：');
  lines.push('');
  lines.push('> 【战况】裂谷环，我血量六成，1/3 杀；最近「地狱·影刃」在南侧中距离可见。');
  lines.push('> 【判断】对方是狙击且我中血，先绕掩体接近，不直线冲锋；看到治疗包就补。');
  lines.push('');
  lines.push('## 当前战场快照');
  lines.push('');
  lines.push('- 地图：' + (catalog.live.map ? catalog.live.map.name : '?'));
  lines.push('- 人类 ' + catalog.live.humans + ' · Bot ' + catalog.live.bots +
    ' · Agent ' + catalog.live.agents + ' · Bot槽 ' + catalog.live.botSlots);
  lines.push('');
  lines.push('## 地图');
  lines.push('');
  for (const m of catalog.maps) {
    lines.push('- `' + m.key + '` ' + m.name + ' — ' + m.tag);
  }
  lines.push('');
  return lines.join('\n');
}

function normalizeTactics(input) {
  const raw = input || {};
  const presetKey = String(raw.preset || raw.style || 'balanced');
  const preset = TACTIC_PRESETS.find((t) => t.key === presetKey) || TACTIC_PRESETS[0];
  const aggressive = raw.aggressive != null ? Number(raw.aggressive) : preset.aggressive;
  return {
    preset: preset.key,
    name: preset.name,
    style: preset.style,
    aggressive: Math.max(0, Math.min(1, Number.isFinite(aggressive) ? aggressive : 0.6)),
    preferAbility: raw.preferAbility != null ? !!raw.preferAbility : preset.preferAbility,
    lowHpPickup: raw.lowHpPickup != null ? !!raw.lowHpPickup : preset.lowHpPickup,
    autopilot: raw.autopilot !== false,
    focusHumans: !!raw.focusHumans,
    notes: String(raw.notes || '').slice(0, 200)
  };
}

function nextIntentFromTactics(agent, ctx) {
  const t = agent.tactics || normalizeTactics({});
  const now = ctx.now;
  const hpFrac = agent.maxHp > 0 ? agent.hp / agent.maxHp : 1;
  const params = { aggressive: t.aggressive };

  if (t.focusHumans) {
    let human = null, best = Infinity;
    for (const o of ctx.players.values()) {
      if (!o.alive || o.id === agent.id || o.isBot || o.isAgent) continue;
      const d = Math.hypot(o.x - agent.x, o.y - agent.y);
      if (d < best) { best = d; human = o; }
    }
    if (human) {
      params.targetId = human.id;
      params.targetName = human.name;
    }
  }

  if (t.lowHpPickup && hpFrac < 0.4) {
    return { type: 'grab_pickup', params: Object.assign({ pickupType: 0 }, params) };
  }

  // 周期性放技能
  if (t.preferAbility && now >= agent.abilityReadyAt && (!agent.agent || now - (agent.agent.lastAutoAbility || 0) > 4000)) {
    if (agent.agent) agent.agent.lastAutoAbility = now;
    return { type: 'ability', params: params };
  }

  switch (t.style) {
    case 'aggressive':
    case 'brawler':
      return { type: 'rush', params: params };
    case 'defensive':
      return { type: hpFrac < 0.55 ? 'hold_cover' : 'kite', params: params };
    case 'sniper':
      return { type: 'kite', params: params };
    case 'loot':
      return { type: 'grab_pickup', params: Object.assign({ pickupType: hpFrac < 0.7 ? 0 : 3 }, params) };
    default:
      return { type: 'engage', params: params };
  }
}

module.exports = {
  TACTIC_PRESETS,
  buildCatalog,
  buildPlaybookMarkdown,
  normalizeTactics,
  nextIntentFromTactics
};
