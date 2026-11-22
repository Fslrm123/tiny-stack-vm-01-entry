// Tiny stack ISA (make.fun ISA.md v1) interpreter: pre-decodes every byte position into typed arrays.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// [byte, immediate bytes, pops, pushes] for every named opcode.
const OPS = [
  [0x00,0,0,0],[0x01,1,0,1],[0x02,4,0,1],[0x03,0,1,0],[0x04,0,1,2],[0x05,0,2,2],[0x06,0,2,3],[0x07,0,3,3],
  [0x10,0,2,1],[0x11,0,2,1],[0x12,0,2,1],[0x13,0,2,1],[0x14,0,2,1],[0x15,0,2,1],[0x16,0,2,1],[0x17,0,1,1],
  [0x18,0,2,1],[0x19,0,2,1],[0x1a,0,2,1],[0x1b,0,1,1],[0x1c,0,2,1],[0x1d,0,2,1],[0x1e,0,2,1],[0x20,0,2,1],
  [0x21,0,2,1],[0x22,0,2,1],[0x30,2,0,0],[0x31,2,1,0],[0x32,2,1,0],[0x33,2,0,0],[0x34,0,0,0],[0x40,0,1,1],
  [0x41,0,2,0],[0x50,0,1,0],[0x51,0,1,0],[0x52,0,0,1],[0x53,0,1,0],
];
const IMM = new Uint8Array(256).fill(255), POPS = new Uint8Array(256), PUSH = new Uint8Array(256);
for (const [b, k, p, q] of OPS) { IMM[b] = k; POPS[b] = p; PUSH[b] = q; }
const DIGS = new Uint8Array(11); // PRINT scratch

function run(p, inp) {
  const n = p.length;
  const op = new Uint8Array(n), imm = new Int32Array(n), nxt = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const b = p[i], k = IMM[b];
    if (k === 255) { op[i] = 0xff; continue; } // unknown byte: trap 5
    if (i + k >= n) { op[i] = 0xfe; continue; } // cut-off immediate: trap 9
    op[i] = b;
    nxt[i] = i + 1 + k;
    if (k === 1) imm[i] = (p[i + 1] << 24) >> 24;
    else if (k === 4) imm[i] = p[i + 1] | (p[i + 2] << 8) | (p[i + 3] << 16) | (p[i + 4] << 24);
    else if (k === 2) imm[i] = b === 0x33 ? p[i + 1] | (p[i + 2] << 8) : ((p[i + 1] | (p[i + 2] << 8)) << 16) >> 16;
  }
  const D = new Int32Array(256), C = new Int32Array(64), M = new Int32Array(256), out = new Uint8Array(65536);
  let sp = 0, csp = 0, olen = 0, ip = 0, pc = 0, steps = 0;
  const done = (code) => ({ out: out.slice(0, olen), code });
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const at = pc, o = op[at];
    if (o >= 0xfe) return done(o === 0xff ? 5 : 9);
    steps++;
    const next = nxt[at];
    if (sp < POPS[o]) return done(2);
    if (sp - POPS[o] + PUSH[o] > 256) return done(3);
    pc = next;
    if (o >= 0x10 && o <= 0x22 && o !== 0x17 && o !== 0x1b) { // binary ops; 0x17/0x1b are unary
      const b = D[sp - 1], a = D[sp - 2];
      let r;
      switch (o) {
        case 0x10: r = (a + b) | 0; break;
        case 0x11: r = (a - b) | 0; break;
        case 0x12: r = Math.imul(a, b); break;
        case 0x13:
          if (b === 0) return done(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
          break;
        case 0x14:
          if (b === 0) return done(4);
          r = b === -1 ? 0 : (a % b) | 0;
          break;
        case 0x15:
          if (b === 0) return done(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
          break;
        case 0x16:
          if (b === 0) return done(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
          break;
        case 0x18: r = a & b; break;
        case 0x19: r = a | b; break;
        case 0x1a: r = a ^ b; break;
        case 0x1c: r = a << (b & 31); break;
        case 0x1d: r = a >> (b & 31); break;
        case 0x1e: r = (a >>> (b & 31)) | 0; break;
        case 0x20: r = a === b ? 1 : 0; break;
        case 0x21: r = a < b ? 1 : 0; break;
        default: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
      }
      sp -= 2;
      D[sp++] = r;
      continue;
    }
    switch (o) {
      case 0x00: return done(0);
      case 0x01:
      case 0x02: D[sp++] = imm[at]; break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = D[sp - 1]; sp++; break;
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 0x06: D[sp] = D[sp - 2]; sp++; break;
      case 0x07: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 0x17: D[sp - 1] = -D[sp - 1] | 0; break;
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break;
      case 0x30: pc = next + imm[at]; break;
      case 0x31: if (D[--sp] === 0) pc = next + imm[at]; break;
      case 0x32: if (D[--sp] !== 0) pc = next + imm[at]; break;
      case 0x33:
        if (csp === 64) return done(7);
        C[csp++] = next;
        pc = imm[at];
        break;
      case 0x34:
        if (csp === 0) return done(8);
        pc = C[--csp];
        break;
      case 0x40: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return done(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return done(6);
        M[addr] = D[sp - 2];
        sp -= 2;
        break;
      }
      case 0x50: { // PRINT (length checked first)
        const v = D[sp - 1];
        let x = v < 0 ? -v : v, t = 11;
        if (x === 0) DIGS[--t] = 48;
        while (x > 0) { DIGS[--t] = 48 + (x % 10); x = (x / 10) | 0; }
        if (v < 0) DIGS[--t] = 45;
        if (olen + (11 - t) > 65536) return done(11);
        sp--;
        for (let i = t; i < 11; i++) out[olen++] = DIGS[i];
        break;
      }
      case 0x51:
        if (olen + 1 > 65536) return done(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 0x52: D[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 0x53: return done(D[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input', O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  let r;
  try { r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin')))); }
  catch { r = { out: new Uint8Array(0), code: 0 }; }
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
