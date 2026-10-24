#!/usr/bin/env node
/**
 * Run the watch app on each watch model's emulator image and record what works.
 *
 *   python3 tools/compat/make_variant.py          # once: builds watch-compat/
 *   node tools/compat/sweep.mjs [model ...]       # default: every model Zeus builds for
 *
 * For each model: download its firmware (tools/.emu-m/<model>/, deleted afterwards),
 * boot it, install watch-compat (the package Zeus built for that model), open it from
 * the app list, and let it walk itself through Home, Point, Paint and More, taking a
 * screenshot of each. Results: tools/compat/out/results.json and <model>-<screen>.png.
 *
 * The emulator feeds no real sensor data, so it shows whether the app installs, runs,
 * fits and is allowed its APIs on that firmware; whether the watch really has a compass
 * or gyroscope comes from its specifications.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(REPO, 'tools/compat/out');
const LIST = 'https://upload-cdn.huami.com/zeppos/simulator/download/emulatorList.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

fs.mkdirSync(OUT, { recursive: true });
const resultsFile = path.join(OUT, 'results.json');
const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : {};
const save = () => fs.writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`);

// device sources the build has a package for
function builtSources() {
  const zab = fs.readdirSync(path.join(REPO, 'watch-compat/dist')).find((f) => f.endsWith('.zab'));
  const py = `
import zipfile, io, json, sys
z = zipfile.ZipFile(sys.argv[1]); out = []
for n in z.namelist():
    if n.endswith('.zpk'):
        d = zipfile.ZipFile(io.BytesIO(zipfile.ZipFile(io.BytesIO(z.read(n))).read('device.zip')))
        out += [p.get('deviceSource') for p in json.loads(d.read('app.json'))['platforms']]
print(json.dumps(out))`;
  return new Set(JSON.parse(execFileSync('python3', ['-c', py, path.join(REPO, 'watch-compat/dist', zab)]).toString()));
}

function emu(dir, args, env = {}, timeout = 600000) {
  const r = spawnSync('node', [path.join(REPO, 'tools/emu/emu.mjs'), ...args], {
    env: { ...process.env, ZEPP_EMU_DIR: dir, ...env }, encoding: 'utf8', timeout,
  });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

/** Centre of the app's icon on screen (its rufous orange), or null. */
function findIcon(png) {
  const py = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); w, h = im.size; pts = []
for y in range(0, h, 3):
    for x in range(0, w, 3):
        r, g, b = im.getpixel((x, y))
        if r > 190 and 90 < g < 170 and b < 110 and r - b > 110: pts.append((x, y))
if len(pts) < 15: print('none')
else:
    pts.sort(key=lambda p: p[1]); mid = pts[len(pts) // 2]
    near = [p for p in pts if abs(p[1] - mid[1]) < 60]
    print(sum(p[0] for p in near) // len(near), sum(p[1] for p in near) // len(near))`;
  const s = execFileSync('python3', ['-c', py, png]).toString().trim();
  return s === 'none' ? null : s.split(' ').map(Number);
}

const serial = (dir) => { try { return fs.readFileSync(path.join(dir, 'serial.log'), 'latin1'); } catch { return ''; } };

async function runModel(model, built) {
  const name = model.modelName;
  const key = slug(name);
  const dir = path.join(REPO, 'tools/.emu-m', key);
  const rel = model.released.filter((r) => !r.hide)[0];
  const sources = model.device.filter((d) => built.has(d));
  const r = { model: name, firmware: rel.name, os: rel.os_version, api: rel.api_level, screen: model.ratio, sources: model.device, at: new Date().toISOString() };
  results[key] = r;
  if (!sources.length) { r.status = 'not built'; r.note = 'Zeus builds no package for this model'; save(); return; }
  console.log(`\n=== ${name} (${rel.name}, API ${rel.api_level}, ${model.ratio})`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(REPO, 'tools/.emu/qemu'), path.join(dir, 'qemu'), { recursive: true });
  try {
    let x = emu(dir, ['setup'], { ZEPP_EMU_MODEL: name });
    if (!x.ok) { r.status = 'no image'; r.note = x.out.split('\n').pop(); return; }
    x = emu(dir, ['start']);
    if (!x.ok) { r.status = 'did not boot'; r.note = x.out.split('\n').pop(); return; }
    const before = serial(dir).length;
    x = emu(dir, ['install', 'watch-compat', '--no-build'], { ZEPP_DEVICE_SOURCE: String(sources[0]) });
    if (!x.ok) { r.status = 'install failed'; r.note = x.out.split('\n').pop(); return; }
    // open it from the app list
    let opened = false;
    for (let i = 0; i < 4 && !opened; i++) {
      emu(dir, ['key', i % 2 ? 'ret' : 'home']);
      await sleep(3000);
      const png = path.join(OUT, `${key}-list.png`);
      emu(dir, ['shot', png]);
      let at = findIcon(png);
      if (!at) { emu(dir, ['swipe', '200', '380', '200', '120', '900']); emu(dir, ['shot', png]); at = findIcon(png); }
      if (at) {
        emu(dir, ['tap', String(at[0]), String(at[1])]);
        for (let t = 0; t < 10 && !serial(dir).slice(before).includes('KCOMPAT shown home'); t++) await sleep(1000);
        opened = serial(dir).slice(before).includes('KCOMPAT shown home');
      }
      if (!opened) emu(dir, ['key', 'backspace']);
    }
    if (!opened) { r.status = 'not opened'; r.note = 'could not open the app from the app list (see -list.png)'; return; }
    // follow it through its screens
    const shots = new Set();
    const deadline = Date.now() + 100000;
    while (Date.now() < deadline) {
      const log = serial(dir).slice(before);
      for (const m of log.matchAll(/KCOMPAT shown (\w+)/g)) {
        if (shots.has(m[1])) continue;
        shots.add(m[1]);
        await sleep(m[1] === 'home' ? 1200 : 3000);
        emu(dir, ['shot', path.join(OUT, `${key}-${m[1]}.png`)]);
      }
      if (log.includes('KCOMPAT done')) break;
      await sleep(700);
    }
    const log = serial(dir).slice(before);
    r.caps = {};
    for (const m of log.matchAll(/KCOMPAT cap ([\w.]+)=([^\r\n\x1b]*)/g)) r.caps[m[1]] = m[2].trim();
    r.screens = [...shots];
    r.errors = [...new Set([...log.matchAll(/(Mini Program Error[^\n]*|PERMISSION DENIED[^\n]*|KCOMPAT back failed[^\n]*)/g)].map((m) => m[1].trim()))]
      .filter((e) => !e.includes("cannot set property 'exports' of undefined"));
    r.status = log.includes('KCOMPAT done') && ['point', 'paint', 'more'].every((s) => shots.has(s)) && !r.errors.length ? 'ran' : 'problems';
  } catch (e) {
    r.status = 'sweep error';
    r.note = String(e.message || e);
  } finally {
    save();
    try { fs.copyFileSync(path.join(dir, 'serial.log'), path.join(OUT, `${key}-serial.log`)); } catch { /* none */ }
    emu(dir, ['stop']);
    await sleep(2000);
    try { execFileSync('pkill', ['-f', '[q]emu-system-arm']); } catch { /* none left */ }
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`${name}: ${r.status}${r.note ? ` (${r.note})` : ''}`);
  }
}

const list = JSON.parse(execFileSync('curl', ['-fsSL', LIST]).toString());
const built = builtSources();
const wanted = process.argv.slice(2);
for (const model of list) {
  if (wanted.length && !wanted.includes(model.modelName)) continue;
  if (!wanted.length && !model.device.some((d) => built.has(d))) {
    results[slug(model.modelName)] = { model: model.modelName, screen: model.ratio, status: 'not built', note: 'Zeus builds no package for this model (API level below 3.6, or not in its device list)' };
    save();
    continue;
  }
  await runModel(model, built);
}
console.log(`\nresults: ${path.relative(REPO, resultsFile)}`);
