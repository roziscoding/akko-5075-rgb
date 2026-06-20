#!/usr/bin/env bun
/**
 * Static file server for the WebHID console (index.html).
 *
 *   bun serve.ts   ->   http://localhost:3000
 *
 * This server does NOT touch the keyboard — index.html talks to the device
 * directly via WebHID in the browser. It exists only so the page is served
 * from a secure context (http://localhost) when opening index.html as a
 * file:// URL isn't convenient. No node-hid, no udev rule required here.
 */

const html = Bun.file(new URL("./index.html", import.meta.url));

Bun.serve({
  port: 3000,
  fetch: () => new Response(html, { headers: { "content-type": "text/html" } }),
});

console.log("Akko WebHID console -> http://localhost:3000");
