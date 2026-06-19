#!/usr/bin/env bun
// Set the main-zone palette index (options low nibble). Usage: bun palidx.ts <0-8>
import HID from "node-hid";
const opt = parseInt(process.argv[2] ?? "0", 16);
const d = HID.devices(0x3151, 0x5002).find((x) => x.usagePage === 0xffff && x.interface === 2);
const h = new HID.HID(d!.path!);
const a = [0x07, 1, 0, 4, opt, 0, 0, 0, 0];
const s = a.slice(0, 8).reduce((x, y) => x + y, 0);
a[8] = (255 - (s & 255)) & 255;
h.sendFeatureReport([0, ...a, ...new Array(55).fill(0)]);
h.close();
console.log(`índice ${opt} (options 0x0${opt.toString(16)}) aplicado na principal`);
