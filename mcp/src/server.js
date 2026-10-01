#!/usr/bin/env node
'use strict';
/*
 * Pulse Arena MCP Server (stdio)
 * Tools: arena_playbook / arena_status / arena_join / arena_set_tactics /
 *        arena_observe / arena_act / arena_leave / arena_spectate_summary
 */
const path = require('path');
const { ArenaBridge } = require('./bridge');

async function main() {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { z } = await import('zod');

  const bridge = new ArenaBridge();
  const server = new McpServer({
    name: 'pulse-arena',
    version: '1.0.0'
  });

  function text(obj) {
    return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
  }

  function errText(e) {
    return text({ ok: false, error: e && e.message ? e.message : String(e) });
  }

  server.tool(
    'arena_playbook',
    'FIRST TOOL TO CALL. Fetch live agent playbook + class stats + tactic presets + URLs. Then list options to the human user and ask them to choose name/class/tactics before join.',
    {},
    async () => {
      try {
        const ok = await bridge.ensureConnected();
        if (!ok) {
          return text({
            online: false,
            hint: 'Start: node server.js — then open http://HOST:4001/agent or retry this tool'
          });
        }
        const msg = await bridge.request({ t: 'agentPlaybook' }, ['agentPlaybook', 'agentErr'], 5000);
        if (msg.t === 'agentErr') return text(msg);
        return text({
          online: true,
          urls: msg.catalog.urls,
          askUser: msg.catalog.askUserTemplate,
          workflow: msg.catalog.workflow,
          classes: msg.catalog.classes,
          tacticsPresets: msg.catalog.tacticsPresets,
          rules: msg.catalog.rules,
          live: msg.catalog.live,
          playbookMarkdown: msg.playbook
        });
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.tool(
    'arena_status',
    'Check whether Pulse Arena is online and summarize map / humans / bots / MCP agents / leaderboard.',
    {},
    async () => {
      try {
        const ok = await bridge.ensureConnected();
        if (!ok) return text({ online: false, hint: 'Start game with: node server.js (port 4001)' });
        const msg = await bridge.request({ t: 'agentStatus' }, ['agentStatus', 'agentErr'], 4000);
        if (msg.t === 'agentErr') return text(msg);
        return text(msg.status);
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.tool(
    'arena_join',
    'Join Pulse Arena as an MCP agent mech. You choose name and class. Then loop observe→act.',
    {
      name: z.string().min(1).max(14).describe('Callsign / nickname'),
      classKey: z.string().optional().describe('Class key e.g. assault, sniper, berserker, phantom'),
      classIndex: z.number().int().min(0).max(13).optional().describe('Or class index 0-13'),
      colorIndex: z.number().int().min(0).max(11).optional(),
      map: z.string().optional().describe('Map key or random (only applies when no humans yet)')
    },
    async ({ name, classKey, classIndex, colorIndex, map }) => {
      try {
        await bridge.connect();
        if (bridge.agentId != null) {
          return text({ ok: false, err: 'already_joined', agentId: bridge.agentId, hint: 'Call arena_leave first' });
        }
        const payload = { t: 'agentJoin', name };
        if (classKey) payload.classKey = classKey;
        if (classIndex != null) payload.classIndex = classIndex;
        if (colorIndex != null) payload.ci = colorIndex;
        if (map) payload.map = map;
        const msg = await bridge.request(payload, ['agentJoined', 'agentErr'], 5000);
        if (msg.t === 'agentErr') return text(msg);
        bridge.agentId = msg.agentId;
        return text({
          ok: true,
          agentId: msg.agentId,
          name: msg.name,
          classKey: msg.classKey,
          className: msg.className,
          intents: msg.intents,
          hint: msg.hint,
          observe: msg.observe
        });
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.tool(
    'arena_set_tactics',
    'Set autopilot tactics after join so the mech keeps fighting without per-frame control. Call right after arena_join.',
    {
      preset: z.enum(['balanced', 'aggressive', 'defensive', 'sniper', 'brawler', 'loot']).describe('Tactic preset key'),
      aggressive: z.number().min(0).max(1).optional(),
      preferAbility: z.boolean().optional(),
      lowHpPickup: z.boolean().optional(),
      focusHumans: z.boolean().optional().describe('Prefer targeting human players'),
      autopilot: z.boolean().optional().describe('Default true: server refreshes intents continuously'),
      notes: z.string().max(200).optional()
    },
    async (args) => {
      try {
        await bridge.connect();
        const msg = await bridge.request(
          { t: 'agentTactics', tactics: args },
          ['agentTacticsOk', 'agentErr'],
          4000
        );
        return text(msg);
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.tool(
    'arena_observe',
    'Observe battlefield. After EVERY call you MUST message the human user in Chinese with 【战况】facts then 【判断】your own assessment (see observe.report). Do not only dump JSON.',
    {
      sinceSeq: z.number().optional().describe('Only return events newer than this seq/timestamp')
    },
    async ({ sinceSeq }) => {
      try {
        await bridge.connect();
        const msg = await bridge.request(
          { t: 'agentObserve', sinceSeq: sinceSeq || 0 },
          ['agentObserve', 'agentErr'],
          4000
        );
        if (msg.t === 'agentErr') return text(msg);
        const o = msg.observe;
        return text({
          ...o,
          _reminder: '现在用中文对用户输出【战况】+【判断】。战况依据 report.facts；判断必须是你自己的推理。'
        });
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.tool(
    'arena_act',
    'Set a high-level intent. Server executor converts it to movement/aim/shoot each tick for ~2s. Types: engage, kite, rush, hold_cover, grab_pickup, dash, ability, idle, retreat_edge.',
    {
      intent: z.enum(['engage', 'kite', 'rush', 'hold_cover', 'grab_pickup', 'dash', 'ability', 'idle', 'retreat_edge']),
      targetName: z.string().optional(),
      targetId: z.number().optional(),
      aggressive: z.number().min(0).max(1).optional().describe('0=cautious 1=aggressive'),
      dashDir: z.enum(['toward', 'away', 'strafe']).optional(),
      pickupType: z.number().int().min(0).max(3).optional().describe('0 heal 1 energy 2 speed 3 dmg'),
      durationMs: z.number().int().min(400).max(5000).optional()
    },
    async (args) => {
      try {
        await bridge.connect();
        const payload = {
          t: 'agentIntent',
          intent: args.intent,
          targetName: args.targetName,
          targetId: args.targetId,
          aggressive: args.aggressive,
          dashDir: args.dashDir,
          pickupType: args.pickupType,
          durationMs: args.durationMs
        };
        const msg = await bridge.request(payload, ['agentActResult', 'agentErr'], 4000);
        return text(msg);
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.tool(
    'arena_leave',
    'Leave the arena and free your agent slot.',
    {},
    async () => {
      try {
        await bridge.connect();
        const msg = await bridge.request({ t: 'agentLeave' }, ['agentLeft', 'agentErr'], 4000);
        bridge.agentId = null;
        return text(msg);
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.tool(
    'arena_spectate_summary',
    'Read-only spectator brief: counts, leaderboard, living fighters. Does not occupy a slot.',
    {},
    async () => {
      try {
        const ok = await bridge.ensureConnected();
        if (!ok) return text({ online: false });
        const msg = await bridge.request(
          { t: 'agentSpectateSummary' },
          ['agentSpectateSummary', 'agentErr'],
          4000
        );
        if (msg.t === 'agentErr') return text(msg);
        return text(msg.summary);
      } catch (e) {
        return errText(e);
      }
    }
  );

  // Keep agent alive while MCP session runs
  const hb = setInterval(() => {
    if (!bridge.connected || bridge.agentId == null) return;
    try { bridge.send({ t: 'agentHeartbeat' }); } catch (_) {}
  }, 2500);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    clearInterval(hb);
    try {
      if (bridge.agentId != null) bridge.send({ t: 'agentLeave' });
    } catch (_) {}
    bridge.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
