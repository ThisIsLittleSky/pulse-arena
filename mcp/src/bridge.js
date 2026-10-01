'use strict';
/*
 * 原生 WebSocket 客户端 —— 连接 Pulse Arena 游戏服（零额外依赖）
 */
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

function maskFrame(payloadBuf) {
  const mask = crypto.randomBytes(4);
  const len = payloadBuf.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payloadBuf[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

class ArenaBridge extends EventEmitter {
  constructor(opts) {
    super();
    this.host = (opts && opts.host) || process.env.ARENA_HOST || '127.0.0.1';
    this.port = Number((opts && opts.port) || process.env.ARENA_PORT || process.env.PORT || 4001);
    this.token = (opts && opts.token) != null ? opts.token : (process.env.AGENT_TOKEN || '');
    this.socket = null;
    this.buf = Buffer.alloc(0);
    this.upgraded = false;
    this._waiters = new Map(); // type -> [{resolve,reject,timer}]
    this.connected = false;
    this.agentId = null;
  }

  connect() {
    if (this.connected && this.socket && !this.socket.destroyed) return Promise.resolve();
    if (this._connecting) return this._connecting;
    this._connecting = new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        this._connecting = null;
        if (err) reject(err); else resolve();
      };
      const key = crypto.randomBytes(16).toString('base64');
      const sock = net.connect({ host: this.host, port: this.port }, () => {
        sock.write(
          'GET / HTTP/1.1\r\n' +
          'Host: ' + this.host + '\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + key + '\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n'
        );
      });
      this.socket = sock;
      this.upgraded = false;
      this.buf = Buffer.alloc(0);
      sock.on('data', (chunk) => this._onData(chunk, () => done(), (e) => done(e)));
      sock.on('error', (err) => {
        this.connected = false;
        done(err);
        this.emit('error', err);
      });
      sock.on('close', () => {
        this.connected = false;
        this.agentId = null;
        this.emit('close');
        this._rejectAll(new Error('connection closed'));
      });
      setTimeout(() => done(new Error('WS upgrade timeout')), 5000);
    });
    return this._connecting;
  }

  _onData(chunk, resolveUpgrade, rejectUpgrade) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (!this.upgraded) {
      const s = this.buf.toString('utf8');
      const idx = s.indexOf('\r\n\r\n');
      if (idx < 0) return;
      if (!s.startsWith('HTTP/1.1 101')) {
        rejectUpgrade(new Error('WS upgrade failed: ' + s.slice(0, 80)));
        this.socket.destroy();
        return;
      }
      this.upgraded = true;
      this.connected = true;
      this.buf = this.buf.slice(Buffer.byteLength(s.slice(0, idx + 4)));
      resolveUpgrade();
      this.emit('open');
    }
    this._parseFrames();
  }

  _parseFrames() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2)); off = 10;
      }
      if (masked) {
        if (this.buf.length < off + 4) return;
        off += 4;
      }
      if (this.buf.length < off + len) return;
      let payload = this.buf.subarray(off, off + len);
      if (masked) {
        // server shouldn't mask, but tolerate
      }
      this.buf = this.buf.subarray(off + len);
      if (opcode === 0x8) { this.socket.end(); return; }
      if (opcode === 0x9) {
        const h = Buffer.alloc(2); h[0] = 0x8a; h[1] = len;
        this.socket.write(Buffer.concat([h, payload]));
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode !== 0x1) continue;
      let msg;
      try { msg = JSON.parse(payload.toString('utf8')); } catch { continue; }
      this._dispatch(msg);
    }
  }

  _dispatch(msg) {
    this.emit('message', msg);
    if (msg.t === 'ping') {
      this.send({ t: 'pong', ts: msg.ts });
      return;
    }
    const list = this._waiters.get(msg.t);
    if (list && list.length) {
      const w = list[0];
      w.resolve(msg);
    }
  }

  _rejectAll(err) {
    const seen = new Set();
    for (const [, arr] of this._waiters) {
      while (arr.length) {
        const w = arr.shift();
        if (seen.has(w)) continue;
        seen.add(w);
        clearTimeout(w.timer);
        w.reject(err);
      }
    }
    this._waiters.clear();
  }

  waitFor(types, timeoutMs) {
    const set = [...new Set(Array.isArray(types) ? types : [types])];
    return new Promise((resolve, reject) => {
      const entry = { timer: null, resolve: null, reject };
      const cleanup = () => {
        for (const t of set) {
          const arr = this._waiters.get(t);
          if (!arr) continue;
          const i = arr.indexOf(entry);
          if (i >= 0) arr.splice(i, 1);
        }
      };
      entry.resolve = (msg) => {
        clearTimeout(entry.timer);
        cleanup();
        resolve(msg);
      };
      entry.timer = setTimeout(() => {
        cleanup();
        reject(new Error('timeout waiting for ' + set.join('|')));
      }, timeoutMs || 5000);
      for (const t of set) {
        if (!this._waiters.has(t)) this._waiters.set(t, []);
        this._waiters.get(t).push(entry);
      }
    });
  }

  send(obj) {
    if (!this.socket || this.socket.destroyed || !this.connected) {
      throw new Error('not connected to arena');
    }
    const body = Object.assign({}, obj);
    if (this.token && body.token == null) body.token = this.token;
    this.socket.write(maskFrame(Buffer.from(JSON.stringify(body), 'utf8')));
  }

  async request(sendObj, expectTypes, timeoutMs) {
    await this.connect();
    const waiter = this.waitFor(expectTypes, timeoutMs);
    this.send(sendObj);
    return waiter;
  }

  async ensureConnected() {
    try {
      await this.connect();
      return true;
    } catch (e) {
      return false;
    }
  }

  close() {
    if (this.socket) this.socket.destroy();
  }
}

module.exports = { ArenaBridge };
