#!/usr/bin/env bun
/**
 * Web RGB controller for the Akko Multi-modes keyboard — two zones.
 *
 *   bun --hot server.ts   ->   http://localhost:3000
 *
 * Zones: main keys (SET_LEDPARAM 0x07) and side bars (SET_SLEDPARAM 0x08).
 * options nibble (this board): 0x08 = single solid color, 0x07 = dazzle (rainbow).
 */

import HID from "node-hid";

const VID = 0x3151;
const PID = 0x5002;
const VENDOR_USAGE_PAGE = 0xffff;
const LEN = 64;

// per-zone command opcode
const ZONE_CMD = { main: 0x07, side: 0x08 } as const;
type Zone = keyof typeof ZONE_CMD;

function checksum(data: number[], at: number): number[] {
  const d = [...data];
  const sum = d.slice(0, at).reduce((a, b) => a + b, 0);
  d[at] = (255 - (sum & 255)) & 255;
  return d;
}

function openVendor(): HID.HID {
  const dev = HID.devices(VID, PID).find(
    (d) => d.usagePage === VENDOR_USAGE_PAGE && d.interface === 2,
  );
  if (!dev?.path) throw new Error("keyboard vendor interface not found");
  return new HID.HID(dev.path);
}

async function setLed(o: {
  zones: Zone[];
  mode: number;
  speed: number;
  r: number;
  g: number;
  b: number;
  brightness: number;
  dazzle: boolean;
}) {
  const bri = Math.max(0, Math.min(4, o.brightness | 0));
  const mode = Math.max(0, Math.min(25, o.mode | 0));
  const speed = Math.max(0, Math.min(4, o.speed | 0)); // UI speed: 4 = fastest
  let first = true;
  for (const z of o.zones) {
    // side bars only support modes 0-5 — skip them for higher modes (apply only where it works)
    if (z === "side" && mode > 5) continue;
    // main zone speed byte is INVERTED (4 = slowest); side bars are normal
    const speedByte = z === "main" ? 4 - speed : speed;
    // side bars only animate Ripple (5) with dazzle — force it there regardless
    const forceDazzle = z === "side" && mode === 5;
    const options = o.dazzle || forceDazzle ? 0x07 : 0x08; // 0x07 rainbow, 0x08 RGB
    const frame = checksum(
      [ZONE_CMD[z], mode, speedByte, bri, options, o.r & 255, o.g & 255, o.b & 255],
      8,
    ).concat(new Array(LEN - 9).fill(0));
    // Each zone in its own open/close with a small gap — sending two feature
    // reports back-to-back on one handle drops the 2nd intermittently.
    if (!first) await sleep(15);
    first = false;
    const hid = openVendor();
    try {
      hid.sendFeatureReport([0x00, ...frame]);
    } finally {
      hid.close();
    }
  }
}

// --- read current state (live, no cache) ---------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MODES = [
  "Off", "Constant", "Breathing", "Neon", "Wave", "Ripple", "Raindrop", "Snake",
  "Reactive", "Converge", "Sine Wave", "Kaleidoscope", "Line Wave", "User Picture",
  "Laser", "Circle Wave", "Rainbow", "Rain Down", "Meteor", "Reactive Off",
  "Music Patterns", "Screen Sync", "Music Bars", "Train", "Fireworks", "Per-Key Color",
];

/** Send a GET command (Bit7 checksum) and read the live response. */
async function readZone(hid: HID.HID, cmd: number): Promise<number[] | null> {
  const frame = checksum([cmd, 0, 0, 0, 0, 0, 0, 0], 7).concat(
    new Array(LEN - 8).fill(0),
  );
  hid.sendFeatureReport([0x00, ...frame]);
  for (let i = 0; i < 5; i++) {
    await sleep(70);
    const resp = hid.getFeatureReport(0, LEN + 1);
    const body = resp[0] === 0 ? resp.slice(1) : resp;
    if (body[0] === cmd) return body;
  }
  return null;
}

function decodeZone(body: number[] | null, zone: "main" | "side") {
  if (!body) return null;
  const [mode, speed, brightness, options, r, g, b] = body.slice(1, 8);
  const hex = "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  const low = options & 0x0f;
  return {
    mode,
    modeName: MODES[mode] ?? `mode ${mode}`,
    speed,
    speedUi: zone === "main" ? 4 - speed : speed, // normalized: 4 = fastest
    brightness,
    options,
    // color source: 0x00-0x06 = preset palette index, 0x07 = dazzle, 0x08 = custom RGB
    source: low <= 6 ? "palette" : low === 7 ? "dazzle" : low === 8 ? "rgb" : "unknown",
    palette: low <= 6 ? low : null,
    dazzle: low === 7,
    solid: low === 8,
    color: hex,
    rgb: { r, g, b },
    raw: body.slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join(" "),
  };
}

/** Open the device, read both zones live, close. */
async function readState() {
  const hid = openVendor();
  try {
    return {
      main: decodeZone(await readZone(hid, 0x87), "main"),
      side: decodeZone(await readZone(hid, 0x88), "side"),
    };
  } finally {
    hid.close();
  }
}

// --- page ----------------------------------------------------------------
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Akko · Light Console</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0E1015; --panel:#171A21; --well:#1E222B; --line:#2A2F3A;
    --text:#E7E9EE; --muted:#828A99; --glow:#FFA200; --radius:14px;
  }
  @property --glow { syntax:'<color>'; inherits:true; initial-value:#FFA200; }

  *{ box-sizing:border-box; }
  html,body{ height:100%; }
  body{
    margin:0; background:var(--bg); color:var(--text);
    font-family:'Chakra Petch',system-ui,sans-serif;
    display:grid; place-items:center; padding:26px; position:relative; overflow-x:hidden;
  }
  /* ambient light spill, tinted live by the chosen color */
  body::before{
    content:''; position:fixed; inset:-25%; z-index:0; pointer-events:none;
    background:radial-gradient(42% 38% at 50% 28%, color-mix(in srgb, var(--glow) 26%, transparent), transparent 70%);
  }

  .console{
    position:relative; z-index:1; width:min(680px,100%);
    background:var(--panel); border:1px solid var(--line);
    border-radius:calc(var(--radius) + 6px);
    box-shadow:0 34px 90px -34px rgba(0,0,0,.85), inset 0 1px 0 rgba(255,255,255,.04);
    padding:22px 24px;
  }

  .bar{ display:flex; align-items:center; gap:12px; padding-bottom:18px; border-bottom:1px solid var(--line); }
  .led{ width:11px; height:11px; border-radius:50%; background:var(--glow);
        box-shadow:0 0 16px 1px var(--glow); flex:none; }
  .brand{ font-weight:700; letter-spacing:.16em; text-transform:uppercase; font-size:.92rem;
          display:flex; gap:.6ch; align-items:center; }
  .brand i{ color:var(--glow); font-style:normal; }
  .brand span{ color:var(--muted); font-weight:500; letter-spacing:.2em; font-size:.82em; }
  .dev{ margin-left:auto; font-family:'JetBrains Mono',monospace; font-size:.76rem; color:var(--muted); letter-spacing:.06em; }

  .grid{ display:grid; grid-template-columns:196px 1fr; gap:28px; padding:26px 0; }
  .eyebrow{ font-size:.64rem; font-weight:600; letter-spacing:.24em; text-transform:uppercase;
            color:var(--muted); margin-bottom:11px; }
  .eyebrow b{ color:var(--text); font-family:'JetBrains Mono',monospace; font-weight:700; }

  .light{ display:flex; flex-direction:column; }
  .well{
    position:relative; aspect-ratio:1/1; width:100%; border-radius:var(--radius);
    border:1px solid var(--line); overflow:hidden; cursor:pointer;
    box-shadow:0 0 54px -8px color-mix(in srgb,var(--glow) 78%, transparent),
               inset 0 0 0 1px rgba(255,255,255,.05);
    transition:box-shadow .25s ease;
  }
  #picker{ position:absolute; inset:0; width:100%; height:100%; border:0; padding:0; background:none; cursor:pointer; }
  #picker::-webkit-color-swatch-wrapper{ padding:0; }
  #picker::-webkit-color-swatch{ border:none; }
  #picker::-moz-color-swatch{ border:none; }
  html.rainbow .well{ background:conic-gradient(from 0deg,#ff3b3b,#ff9f1c,#ffe600,#34d399,#3b82f6,#a855f7,#ff3b3b); }
  html.rainbow #picker{ opacity:0; }

  #hex{
    margin-top:13px; font-family:'JetBrains Mono',monospace; text-transform:lowercase;
    text-align:center; letter-spacing:.1em; padding:.55rem; width:100%;
    background:var(--well); color:var(--text); border:1px solid var(--line); border-radius:10px;
  }
  .toggle{ margin-top:15px; display:flex; align-items:center; gap:.6ch; font-size:.82rem;
           color:var(--muted); cursor:pointer; user-select:none; }
  .toggle input{ accent-color:var(--glow); width:16px; height:16px; }

  .panel{ display:flex; flex-direction:column; gap:21px; }
  .seg{ display:flex; gap:6px; background:var(--well); padding:5px; border-radius:11px; border:1px solid var(--line); }
  .seg button{ flex:1; font:inherit; font-size:.8rem; padding:.5rem .2rem; border:0; border-radius:7px;
               background:transparent; color:var(--muted); cursor:pointer; transition:.18s; }
  .seg button.active{ background:color-mix(in srgb,var(--glow) 16%, var(--well)); color:var(--text);
                      box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--glow) 55%, transparent); }
  #effect{ width:100%; font:inherit; font-size:.9rem; padding:.62rem .7rem; color:var(--text);
           background:var(--well); border:1px solid var(--line); border-radius:11px; cursor:pointer; }
  input[type=range]{ width:100%; accent-color:var(--glow); height:22px; }

  .foot{ display:flex; align-items:flex-end; justify-content:space-between; gap:18px;
         padding-top:18px; border-top:1px solid var(--line); }
  .telemetry{ font-family:'JetBrains Mono',monospace; font-size:.72rem; line-height:1.8; color:var(--text); }
  .telemetry .tag{ color:color-mix(in srgb,var(--glow) 75%, var(--muted)); margin-right:1ch; font-weight:700; letter-spacing:.1em; }
  .apply{ font:inherit; font-weight:700; letter-spacing:.18em; text-transform:uppercase; font-size:.78rem;
          padding:.82rem 1.7rem; border:0; border-radius:11px; cursor:pointer; color:#0b0c0f;
          background:var(--glow); box-shadow:0 8px 28px -8px color-mix(in srgb,var(--glow) 80%, transparent);
          transition:transform .1s ease, box-shadow .25s ease; }
  .apply:active{ transform:translateY(1px) scale(.99); }

  #status{ margin-top:15px; min-height:1.2em; font-size:.76rem; color:var(--muted);
           font-family:'JetBrains Mono',monospace; letter-spacing:.02em; }

  .dim{ opacity:.3; pointer-events:none; filter:grayscale(.4); }
  :focus-visible{ outline:2px solid var(--glow); outline-offset:2px; }

  @media (max-width:560px){ .grid{ grid-template-columns:1fr; } .light{ max-width:230px; margin:0 auto; } }
  @media (prefers-reduced-motion:no-preference){ html.rainbow{ animation:hue 6s linear infinite; } }
  @media (prefers-reduced-motion:reduce){ *{ transition:none !important; } }
  @keyframes hue{
    0%{--glow:#ff3b3b} 17%{--glow:#ff9f1c} 34%{--glow:#ffe600}
    50%{--glow:#34d399} 67%{--glow:#3b82f6} 84%{--glow:#a855f7} 100%{--glow:#ff3b3b}
  }
</style>
</head>
<body>
  <main class="console">
    <header class="bar">
      <span class="led" aria-hidden="true"></span>
      <span class="brand">AKKO <i>/</i> <span>Light Console</span></span>
      <span class="dev">3151:5002</span>
    </header>

    <div class="grid">
      <section class="light">
        <div class="eyebrow">Color</div>
        <div id="colorBox" class="well"><input type="color" id="picker" value="#ffa200"></div>
        <input type="text" id="hex" value="#ffa200" maxlength="7" spellcheck="false" aria-label="hex">
        <label class="toggle"><input type="checkbox" id="dazzle"><span>Rainbow</span></label>
      </section>

      <section class="panel">
        <div>
          <div class="eyebrow">Zone</div>
          <div class="seg" id="zoneSeg">
            <button type="button" data-z="main" class="active">Principal</button>
            <button type="button" data-z="side">Lateral</button>
            <button type="button" data-z="both">Ambas</button>
          </div>
          <select id="zone" hidden>
            <option value="main">main</option><option value="side">side</option><option value="both">both</option>
          </select>
        </div>
        <div>
          <div class="eyebrow">Effect</div>
          <select id="effect"></select>
        </div>
        <div>
          <div class="eyebrow">Brightness <b id="briVal">4</b> / 4</div>
          <input type="range" id="bri" min="0" max="4" value="4">
        </div>
        <div id="speedField">
          <div class="eyebrow">Speed <b id="spdVal">0</b> / 4</div>
          <input type="range" id="spd" min="0" max="4" value="0">
        </div>
      </section>
    </div>

    <footer class="foot">
      <div class="telemetry">
        <div><span class="tag">MAIN</span><span id="tel-main">--</span></div>
        <div><span class="tag">SIDE</span><span id="tel-side">--</span></div>
      </div>
      <button id="set" class="apply">Apply</button>
    </footer>
    <div id="status"></div>
  </main>
<script>
  const root = document.documentElement;
  const zone = document.getElementById('zone');
  const zoneSeg = document.getElementById('zoneSeg');
  const effect = document.getElementById('effect');
  const picker = document.getElementById('picker');
  const colorBox = document.getElementById('colorBox');
  const hex = document.getElementById('hex');
  const bri = document.getElementById('bri');
  const briVal = document.getElementById('briVal');
  const spd = document.getElementById('spd');
  const spdVal = document.getElementById('spdVal');
  const speedField = document.getElementById('speedField');
  const dazzle = document.getElementById('dazzle');
  const status = document.getElementById('status');
  const telMain = document.getElementById('tel-main');
  const telSide = document.getElementById('tel-side');

  const EFFECT_NAMES = {0:'Off',1:'Constant',2:'Breathing',3:'Neon',4:'Wave',5:'Ripple',
    6:'Raindrop',7:'Snake',8:'Reactive',9:'Converge',10:'Sine Wave',11:'Kaleidoscope',
    12:'Line Wave',14:'Laser',15:'Circle Wave',16:'Rainbow',17:'Rain Down',18:'Meteor',
    19:'Reactive Off',23:'Train',24:'Fireworks'};
  const MAIN_MODES = [0,1,2,3,4,5,6,7,8,9,10,11,12,14,15,16,17,18,19,23,24];
  const SIDE_MODES = [0,1,2,3,4,5];
  // 'side' is limited to 0-5; 'main' and 'both' show the full list (both applies
  // higher modes to the main zone only — the backend skips the side for those)
  const modesFor = (z) => z === 'side' ? SIDE_MODES : MAIN_MODES;
  function rebuildEffects(z){
    const cur = effect.value;
    effect.innerHTML = modesFor(z).map(function(m){
      return '<option value="'+m+'">'+(m<10?'0':'')+m+' · '+EFFECT_NAMES[m]+'</option>';
    }).join('');
    if (modesFor(z).indexOf(+cur) >= 0) effect.value = cur; // keep selection if still valid
  }

  const norm = (v) => {
    v = v.trim();
    if (v[0] !== '#') v = '#' + v;
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
  };

  // Light the console with the current color; rainbow animates --glow via @property.
  // Neon ignores RGB -> dim the well (but not when the hardware shows rainbow).
  function syncColorUi(){
    const sideRipple = zone.value !== 'main' && +effect.value === 5;
    const rainbow = dazzle.checked || sideRipple;
    const ignored = +effect.value === 3; // Neon uses its own colors
    root.classList.toggle('rainbow', rainbow);
    colorBox.classList.toggle('dim', ignored && !rainbow);
    hex.classList.toggle('dim', ignored && !rainbow);
    if (!rainbow) root.style.setProperty('--glow', picker.value);
    // speed only matters for animated effects (Off / Constant are static)
    speedField.style.display = (+effect.value <= 1) ? 'none' : '';
  }

  picker.oninput = () => { hex.value = picker.value; syncColorUi(); };
  hex.oninput = () => { const n = norm(hex.value); if (n){ picker.value = n; syncColorUi(); } };
  picker.onchange = () => set.click();
  hex.onchange = () => set.click();
  hex.onkeydown = (e) => { if (e.key === 'Enter') set.click(); };
  bri.oninput = () => { briVal.textContent = bri.value; };
  bri.onchange = () => set.click();
  spd.oninput = () => { spdVal.textContent = spd.value; };
  spd.onchange = () => set.click();
  effect.onchange = () => { syncColorUi(); set.click(); };
  dazzle.onchange = () => { syncColorUi(); set.click(); };

  // segmented zone control (keeps the hidden <select id=zone> as the value source)
  function selectZone(z){
    zone.value = z;
    Array.prototype.forEach.call(zoneSeg.children, function(b){ b.classList.toggle('active', b.dataset.z === z); });
    loadZone(z);
  }
  Array.prototype.forEach.call(zoneSeg.children, function(b){ b.onclick = function(){ selectZone(b.dataset.z); }; });

  function paintTelemetry(j){
    if (j && j.main) telMain.textContent = j.main.raw;
    if (j && j.side) telSide.textContent = j.side.raw;
  }
  async function refreshTelemetry(){
    try { const r = await fetch('/state'); paintTelemetry(await r.json()); } catch (e) {}
  }

  set.onclick = async () => {
    const n = norm(hex.value) || '#000000';
    hex.value = n;
    const label = dazzle.checked ? 'rainbow' : n;
    status.textContent = '> ' + label + ' · bri ' + bri.value + ' · [' + zone.value + ']';
    try {
      const res = await fetch('/set', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          zone: zone.value, hex: n, brightness: +bri.value, dazzle: dazzle.checked,
          mode: +effect.value, speed: +spd.value,
        }),
      });
      const j = await res.json();
      let hint = '';
      if (zone.value !== 'main' && +effect.value === 5) hint = ' · ripple lateral usa rainbow';
      else if (zone.value === 'both' && +effect.value > 5) hint = ' · efeito só na principal';
      status.textContent = j.ok
        ? '✓ ' + label + ' · bri ' + bri.value + ' · [' + zone.value + ']' + hint
        : '✗ ' + (j.error || 'failed');
      refreshTelemetry();
    } catch (e) { status.textContent = '✗ ' + e; }
  };

  // Preset palette (hardware Fn colors) mapped on this unit.
  const PALETTE = ['vermelho','verde','azul','laranja','rosa','amarelo','branco'];
  const PALETTE_HEX = ['#ff0000','#00ff00','#0000ff','#ff7300','#ff66cc','#ffff00','#ffffff'];

  async function loadZone(z){
    rebuildEffects(z);
    syncColorUi();
    if (z === 'both'){
      status.textContent = 'ambas — escolha Principal ou Lateral pra ver o estado';
      refreshTelemetry();
      return;
    }
    status.textContent = 'lendo estado da zona...';
    try {
      const res = await fetch('/state');
      const j = await res.json();
      paintTelemetry(j);
      const s = j && j[z];
      if (!s){ status.textContent = '✗ não consegui ler o estado'; return; }
      if (s.source === 'palette'){
        const c = PALETTE_HEX[s.palette] || '#000000';
        picker.value = c; hex.value = c; dazzle.checked = false;
        status.textContent = 'preset ' + s.palette + ' · ' + (PALETTE[s.palette] || '?')
          + ' · bri ' + s.brightness + ' — mexa pra virar RGB';
      } else {
        picker.value = s.color; hex.value = s.color; dazzle.checked = s.dazzle;
        status.textContent = (s.dazzle ? 'rainbow' : s.color) + ' · bri ' + s.brightness + ' · ' + s.modeName;
      }
      effect.value = String(s.mode);
      spd.value = s.speedUi; spdVal.textContent = s.speedUi;
      bri.value = s.brightness; briVal.textContent = s.brightness;
      syncColorUi();
    } catch (e) { status.textContent = '✗ ' + e; }
  }

  selectZone('main');   // initial active zone + live state load
</script>
</body>
</html>`;

// --- server --------------------------------------------------------------
const ZONES: Record<string, Zone[]> = {
  main: ["main"],
  side: ["side"],
  both: ["main", "side"],
};

Bun.serve({
  port: 3000,
  routes: {
    "/": () => new Response(html, { headers: { "content-type": "text/html" } }),
    "/state": {
      GET: async () => {
        try {
          const state = await readState(); // live read, no cache
          return Response.json(
            { ok: true, ...state },
            { headers: { "cache-control": "no-store, max-age=0" } },
          );
        } catch (e) {
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
    "/set": {
      POST: async (req) => {
        try {
          const body = (await req.json()) as {
            zone?: string;
            hex?: string;
            brightness?: number;
            dazzle?: boolean;
            mode?: number;
            speed?: number;
          };
          const zones = ZONES[body.zone ?? "main"];
          if (!zones) return Response.json({ ok: false, error: "bad zone" }, { status: 400 });
          const m = /^#?([0-9a-f]{6})$/i.exec(body.hex ?? "");
          if (!m) return Response.json({ ok: false, error: "bad hex" }, { status: 400 });
          const r = parseInt(m[1].slice(0, 2), 16);
          const g = parseInt(m[1].slice(2, 4), 16);
          const b = parseInt(m[1].slice(4, 6), 16);
          const bri = Math.max(0, Math.min(4, body.brightness ?? 4));
          const mode = Math.max(0, Math.min(25, body.mode ?? 1));
          const speed = Math.max(0, Math.min(4, body.speed ?? 0));
          const dazzle = !!body.dazzle;
          await setLed({ zones, mode, speed, r, g, b, brightness: bri, dazzle });
          console.log(
            `set [${zones.join("+")}] mode=${mode} spd=${speed} ${dazzle ? "dazzle" : "#" + m[1]} bri=${bri}`,
          );
          return Response.json({ ok: true });
        } catch (e) {
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
  },
});

console.log("Akko RGB server -> http://localhost:3000");
