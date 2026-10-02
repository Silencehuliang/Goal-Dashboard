#!/usr/bin/env node
// Independent verification helper: read the DSH desktop app.asar header and
// extract selected entries to disk so their code can be inspected for real.
// Usage: node scripts/verify-asar.mjs [asarPath] [outDir]
import { openSync, readSync, closeSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const asar = resolve(process.argv[2] ?? 'E:/Development/Tool/dsh/resources/app.asar');
const outDir = resolve(process.argv[3] ?? 'tmp/verify/asar');

const fd = openSync(asar, 'r');
const head = Buffer.alloc(16);
readSync(fd, head, 0, 16, 0);
const a = head.readUInt32LE(0);      // pickle size field (=4)
const b = head.readUInt32LE(4);      // header payload size
const c = head.readUInt32LE(8);      // header string size
const d = head.readUInt32LE(12);     // header string length (used by all clients)
console.log(`asar=${asar} size=${statSync(asar).size}`);
console.log(`pickle header words: [0]=${a} [4]=${b} [8]=${c} [12]=${d}`);
const headerSize = d;
const hbuf = Buffer.alloc(headerSize);
readSync(fd, hbuf, 0, headerSize, 16);
let json = hbuf.toString('utf8');
json = json.replace(/\u0000+$/, '');
const hdr = JSON.parse(json);
console.log(`header keys=${Object.keys(hdr)} files=${Object.keys(hdr.files).length}`);
const dataStart = 16 + headerSize;

// flatten
const entries = [];
(function walk(node, prefix) {
  for (const [name, val] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (val.files) walk(val, p);
    else if (val.offset !== undefined) entries.push({ path: p, size: val.size, offset: Number(val.offset) });
  }
})(hdr, '');
console.log(`total file entries=${entries.length}`);

// versions of interest
for (const pat of [/^package\.json$/, /@deepseek-ai\/dsh\/package\.json$/, /@deepseek-ai\/dsh-desktop\/package\.json$/]) {
  const hits = entries.filter((e) => pat.test(e.path));
  for (const h of hits) {
    const buf = Buffer.alloc(h.size);
    readSync(fd, buf, 0, h.size, dataStart + h.offset);
    try {
      const j = JSON.parse(buf.toString('utf8'));
      console.log(`VERSION ${h.path} :: name=${j.name} version=${j.version}`);
    } catch (e) {
      console.log(`VERSION ${h.path} :: unparsable ${e.message}`);
    }
  }
}

const extractDirs = [
  /dsh-client-modules\//,
  /dsh-web-frontend\//,
  /dsh-web-app\//,
  /dsh-host-frontend-static\//,
  /@deepseek-ai\/dsh\/(lib|package\.json)/,
];
let extracted = 0;
for (const e of entries) {
  if (!extractDirs.some((re) => re.test(e.path))) continue;
  const dest = join(outDir, e.path);
  mkdirSync(dirname(dest), { recursive: true });
  const buf = Buffer.alloc(e.size);
  readSync(fd, buf, 0, e.size, dataStart + e.offset);
  writeFileSync(dest, buf);
  extracted++;
}
closeSync(fd);
console.log(`extracted ${extracted} files to ${outDir}`);

// app.asar.unpacked sanity
const unpacked = asar.replace(/app\.asar$/, 'app.asar.unpacked');
console.log(`app.asar.unpacked exists=${existsSync(unpacked)}`);
