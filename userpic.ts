#!/usr/bin/env bun
/**
 * Per-key (USERPIC 0x0C) experiment: enter mode 13 and fill all keys one color.
 *   bun userpic.ts [rrggbb]   (default ff0000)
 * Hypothesis: SET_USERPIC = [0x0C, page, 0,0,0,0,0, ck7] + 18×[R,G,B] payload, pages 0-6.
 */
import HID from "node-hid";

const VID = 0x3151, PID = 0x5002, UP = 0xffff, LEN = 64;
const hex = (process.argv[2] ?? "ff0000").replace(/^#/, "");
const R = parseInt(hex.slice(0, 2), 16);
const G = parseInt(hex.slice(2, 4), 16);
const B = parseInt(hex.slice(4, 6), 16);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function ck(a: number[], at: number) {
  const s = a.slice(0, at).reduce((x, y) => x + y, 0);
  a[at] = (255 - (s & 255)) & 255;
  return a;
}

const d = HID.devices(VID, PID).find((x) => x.usagePage === UP && x.interface === 2);
const h = new HID.HID(d!.path!);
try {
  // enter User Picture mode (mode 13) on the main zone
  h.sendFeatureReport([0, ...ck([0x07, 13, 0, 4, 0x08, R, G, B, 0], 8).concat(new Array(LEN - 9).fill(0))]);
  await sleep(150);

  // 7 pages × 18 keys, all = chosen color
  for (let page = 0; page < 7; page++) {
    const payload: number[] = [];
    for (let k = 0; k < 18; k++) payload.push(R, G, B);
    const frame = ck([0x0c, page, 0, 0, 0, 0, 0, 0], 7).concat(payload);
    while (frame.length < LEN) frame.push(0);
    h.sendFeatureReport([0, ...frame.slice(0, LEN)]);
    await sleep(40);
  }
  console.log(`USERPIC fill #${hex} sent (mode 13 + 7 pages of 18)`);
} finally {
  h.close();
}
