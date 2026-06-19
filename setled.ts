#!/usr/bin/env bun
/**
 * Akko/RongYuan SET_LEDPARAM (0x07) — set a solid LED color, then read back.
 *
 *   bun setled.ts            # solid red (default test)
 *   bun setled.ts 0 255 0    # solid green (R G B)
 *   bun setled.ts restore    # restore the original effect captured below
 *
 * SET_LEDPARAM frame (Bit8 checksum at byte 8):
 *   [0]=0x07 [1]=mode [2]=speed [3]=brightness [4]=options [5]=R [6]=G [7]=B [8]=cksum
 *   options: low nibble 7 = single color, 8 = dazzle (rainbow cycle)
 */

import HID from "node-hid";

const VID = 0x3151;
const PID = 0x5002;
const VENDOR_USAGE_PAGE = 0xffff;
const LEN = 64;

const SET_LEDPARAM = 0x07;
const GET_LEDPARAM = 0x87;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (b: number[], n = 12) =>
  b.slice(0, n).map((x) => x.toString(16).padStart(2, "0")).join(" ");

/** Checksum that covers data[0:N] and is stored at data[N]. */
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
  if (!dev?.path) throw new Error("vendor config interface not found");
  return new HID.HID(dev.path);
}

async function getLedParam(dev: HID.HID): Promise<number[] | null> {
  const cmd = checksum([GET_LEDPARAM, 0, 0, 0, 0, 0, 0], 7).concat(
    new Array(LEN - 8).fill(0),
  );
  dev.sendFeatureReport([0x00, ...cmd]);
  for (let i = 0; i < 4; i++) {
    await sleep(80);
    const resp = dev.getFeatureReport(0, LEN + 1);
    const body = resp[0] === 0 ? resp.slice(1) : resp;
    if (body[0] === GET_LEDPARAM) return body;
  }
  return null;
}

function buildSetLed(
  mode: number,
  speed: number,
  brightness: number,
  options: number,
  r: number,
  g: number,
  b: number,
): number[] {
  const d = new Array(LEN).fill(0);
  [d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]] = [
    SET_LEDPARAM, mode, speed, brightness, options, r, g, b,
  ];
  return checksum(d, 8); // Bit8: checksum at index 8 over bytes 0..7
}

async function main() {
  const arg = process.argv.slice(2);
  const dev = openVendor();
  try {
    const before = await getLedParam(dev);
    console.log("current LED state (0x87):", before ? hex(before) : "(no read)");

    let frame: number[];
    if (arg[0] === "restore") {
      if (!before) throw new Error("cannot read current state to restore");
      // Re-send current params via 0x07 (mode,speed,brightness,options,R,G,B)
      frame = buildSetLed(
        before[1], before[2], before[3], before[4],
        before[5], before[6], before[7],
      );
      console.log("restoring original params...");
    } else {
      const r = arg.length >= 3 ? +arg[0] : 255;
      const g = arg.length >= 3 ? +arg[1] : 0;
      const b = arg.length >= 3 ? +arg[2] : 0;
      // mode=1 Constant, speed=0, brightness=4 max.
      // NOTE: on this Multi-modes model the options nibble is inverted vs the
      // HE-board doc -> 0x08 = single color, 0x07 = dazzle (rainbow).
      frame = buildSetLed(1, 0, 4, 0x08, r, g, b);
      console.log(`setting solid color R=${r} G=${g} B=${b}`);
    }

    console.log(">> SET_LEDPARAM:", hex(frame, 9));
    dev.sendFeatureReport([0x00, ...frame]);
    await sleep(150);

    const after = await getLedParam(dev);
    console.log("new LED state (0x87):    ", after ? hex(after) : "(no read)");
  } finally {
    dev.close();
  }
}

await main();
