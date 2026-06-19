#!/usr/bin/env bun
/**
 * Side-LED (SLED) discovery helper.
 *   bun sled.ts <mode> <optionsHex> <brightness> <rrggbb>
 *   bun sled.ts 2 08 4 ffffff      # breathing, options 0x08, bri 4, white
 * Sends SET_SLEDPARAM (0x08) and reads back GET_SLEDPARAM (0x88).
 */
import HID from "node-hid";

const VID = 0x3151, PID = 0x5002, UP = 0xffff, LEN = 64;
const a = process.argv.slice(2);
const mode = +(a[0] ?? 1);
const opt = parseInt(a[1] ?? "08", 16);
const bri = +(a[2] ?? 4);
const hex = (a[3] ?? "ffffff").replace(/^#/, "");
const r = parseInt(hex.slice(0, 2), 16);
const g = parseInt(hex.slice(2, 4), 16);
const b = parseInt(hex.slice(4, 6), 16);

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
function ck(arr: number[], at: number) {
  const s = arr.slice(0, at).reduce((x, y) => x + y, 0);
  arr[at] = (255 - (s & 255)) & 255;
  return arr;
}
const hx = (o: number[]) =>
  o.slice(0, 9).map((x) => x.toString(16).padStart(2, "0")).join(" ");

const dev = HID.devices(VID, PID).find((d) => d.usagePage === UP && d.interface === 2);
const h = new HID.HID(dev!.path!);
try {
  const f = ck([0x08, mode, 2, bri, opt, r, g, b, 0], 8).concat(new Array(LEN - 9).fill(0));
  console.log(`>> SET_SLEDPARAM mode=${mode} opt=0x${opt.toString(16)} bri=${bri} rgb=${hex}:`, hx(f));
  h.sendFeatureReport([0, ...f]);
  await sleep(150);
  const gframe = ck([0x88, 0, 0, 0, 0, 0, 0, 0], 7).concat(new Array(LEN - 8).fill(0));
  h.sendFeatureReport([0, ...gframe]);
  await sleep(100);
  const raw = h.getFeatureReport(0, LEN + 1);
  const o = raw[0] === 0 ? raw.slice(1) : raw;
  console.log("<< GET_SLEDPARAM:", hx(o));
} finally {
  h.close();
}
