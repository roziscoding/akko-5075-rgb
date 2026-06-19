#!/usr/bin/env bun
/**
 * Akko/RongYuan (VID 0x3151) HID protocol probe — TypeScript / Bun.
 *
 * Read-only litmus test: opens the vendor-config HID interface (usage page
 * 0xFFFF), sends GET commands with the RongYuan checksum, and prints responses.
 * If the keyboard echoes the command byte back, it speaks the same protocol as
 * the monsgeek-akko-linux driver -> an OpenRGB-style driver is viable.
 *
 * Protocol reference:
 *   https://github.com/echtzeit-solutions/monsgeek-akko-linux/blob/HEAD/docs/PROTOCOL.md
 *
 * Frame (64-byte data, report id 0 prepended on the wire):
 *   [0]   CMD
 *   [1-6] params
 *   [7]   checksum (Bit7) = 255 - (sum(data[0:7]) & 255)
 *   [8+]  payload
 *
 * Run:
 *   bun add node-hid
 *   sudo bun probe.ts        # hidraw is root-only -> needs sudo or a udev rule
 */

import HID from "node-hid";

const VID = 0x3151;
const PID = 0x5002; // Akko Multi-modes Keyboard-B (change if yours differs)
const VENDOR_USAGE_PAGE = 0xffff;
const REPORT_LEN = 64; // data bytes (report id 0 prepended separately)

// --- Commands (from PROTOCOL.md, all read-only GETs) ----------------------
const GET_REV = 0x80; // firmware revision
const GET_USB_VERSION = 0x8f; // -> [0x8F, device_id[4], ?, ?, version[2]]
const GET_LEDPARAM = 0x87; // current LED mode/speed/color

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fill byte[7] with the Bit7-mode checksum (covers data[0:7]). */
function checksumBit7(data: number[]): number[] {
  const d = [...data];
  while (d.length < 8) d.push(0);
  const sum = d.slice(0, 7).reduce((a, b) => a + b, 0);
  d[7] = (255 - (sum & 255)) & 255;
  return d;
}

/** Build a 64-byte command frame for the given opcode + params. */
function buildCmd(cmd: number, ...params: number[]): number[] {
  const d = new Array(REPORT_LEN).fill(0);
  d[0] = cmd;
  params.forEach((p, i) => (d[1 + i] = p & 0xff));
  return checksumBit7(d);
}

const hexdump = (b: number[], n = 24) =>
  b.slice(0, n).map((x) => x.toString(16).padStart(2, "0")).join(" ");

/** Find the vendor-config interface (usage page 0xFFFF) for VID:PID. */
function pickDevice(): HID.Device | undefined {
  const all = HID.devices(VID, PID);
  console.log(
    `Found ${all.length} HID interface(s) for ` +
      `${VID.toString(16)}:${PID.toString(16)}:`,
  );
  for (const d of all) {
    const mark =
      d.usagePage === VENDOR_USAGE_PAGE ? "  <-- vendor config" : "";
    console.log(
      `  iface=${d.interface} ` +
        `usage_page=0x${(d.usagePage ?? 0).toString(16).padStart(4, "0")} ` +
        `usage=0x${(d.usage ?? 0).toString(16).padStart(4, "0")} ` +
        `path=${d.path}${mark}`,
    );
  }
  const candidates = all.filter((d) => d.usagePage === VENDOR_USAGE_PAGE);
  // Prefer interface 2 if present (the documented config interface)
  candidates.sort((a, b) => Number(a.interface !== 2) - Number(b.interface !== 2));
  return candidates[0];
}

/** Send a GET command and read the (buffered) response. */
async function query(
  dev: HID.HID,
  cmd: number,
  retries = 4,
  ...params: number[]
): Promise<number[] | null> {
  const frame = buildCmd(cmd, ...params);
  const payload = [0x00, ...frame]; // report id 0 + 64 data bytes
  console.log(`\n>> SET_FEATURE cmd=0x${cmd.toString(16)}: ${hexdump(frame)}`);
  dev.sendFeatureReport(payload);

  for (let attempt = 0; attempt < retries; attempt++) {
    await sleep(80);
    const resp = dev.getFeatureReport(0, REPORT_LEN + 1);
    if (!resp || resp.length === 0) continue;
    const body = resp[0] === 0x00 ? resp.slice(1) : resp; // strip report id
    if (body.length && body[0] === cmd) {
      console.log(`<< GET_FEATURE (echo OK, try ${attempt + 1}): ${hexdump(body)}`);
      return body;
    }
    console.log(`   .. try ${attempt + 1}: ${hexdump(body)} (no echo yet)`);
  }
  return null;
}

async function main(): Promise<number> {
  const info = pickDevice();
  if (!info?.path) {
    console.log("\nNo vendor-config interface (usage page 0xFFFF) found.");
    console.log("The keyboard may need to be in WIRED mode, or perms are missing.");
    return 1;
  }

  console.log(`\nOpening ${info.path} ...`);
  let dev: HID.HID;
  try {
    dev = new HID.HID(info.path);
  } catch (e) {
    console.log(`Could not open device: ${(e as Error).message}`);
    console.log("Try: sudo bun probe.ts   (or add a udev rule for /dev/hidraw*)");
    return 1;
  }

  try {
    let ok = false;
    const cmds: [string, number][] = [
      ["GET_USB_VERSION", GET_USB_VERSION],
      ["GET_REV", GET_REV],
      ["GET_LEDPARAM", GET_LEDPARAM],
    ];
    for (const [name, cmd] of cmds) {
      console.log(`\n=== ${name} ===`);
      if (await query(dev, cmd)) ok = true;
    }
    console.log("\n" + "=".repeat(52));
    if (ok) {
      console.log("RESULT: Keyboard echoed at least one command back.");
      console.log("        -> SAME protocol family. An OpenRGB-style driver is viable.");
    } else {
      console.log("RESULT: No command echoed. Either a different opcode set,");
      console.log("        wrong interface, or it only answers in wired mode.");
      console.log("        Next step: capture the Akko Cloud Driver traffic to confirm.");
    }
  } finally {
    dev.close();
  }
  return 0;
}

process.exit(await main());
