/**
 * The server starts and offers exactly the tools that manifest.json (the
 * Claude Desktop installer) lists, with the annotations in
 * tests/snapshots/tools.json. Changing that file must be a deliberate edit. No network: listing tools calls nothing,
 * and the server runs with a throwaway home folder.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface ListedTool {
  name: string;
  annotations?: Record<string, boolean>;
}

function listServerTools(): Promise<ListedTool[]> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "migros-tools-test-"));
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    // Only what the server needs: no Migros credentials, no real config folder.
    // TMPDIR/TEMP/TMP keep tsx's cache in the same temp area as the test.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      XDG_CONFIG_HOME: home,
      APPDATA: home,
      TMPDIR: os.tmpdir(),
      TEMP: os.tmpdir(),
      TMP: os.tmpdir(),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  return new Promise<ListedTool[]>((resolve, reject) => {
    let buf = "";
    let stderr = "";
    const timer = setTimeout(() => finish(new Error("server did not answer within 20 s: " + stderr)), 20_000);
    const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + "\n");

    function finish(err: Error | null, tools?: ListedTool[]) {
      clearTimeout(timer);
      child.kill();
      fs.rmSync(home, { recursive: true, force: true });
      if (err) reject(err);
      else resolve(tools!);
    }

    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => finish(new Error(`server exited early (${code}): ${stderr}`)));
    child.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const msg = JSON.parse(line);
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        } else if (msg.id === 2) {
          child.removeAllListeners("exit");
          finish(null, msg.result.tools as ListedTool[]);
        }
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
  });
}

const SNAPSHOT = "tests/snapshots/tools.json";

describe("server", () => {
  let tools: ListedTool[];

  it("starts and lists the same tools as manifest.json", async () => {
    tools = await listServerTools();
    const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8")) as { tools: Array<{ name: string }> };
    const declared = manifest.tools.map((t) => t.name).sort();
    assert.deepEqual(tools.map((t) => t.name).sort(), declared);
  });

  it("marks every tool as the snapshot says", () => {
    const actual = Object.fromEntries(tools.map((t) => [t.name, t.annotations ?? {}]));
    if (process.env.UPDATE_SNAPSHOT) fs.writeFileSync(SNAPSHOT, JSON.stringify(actual, null, 2) + "\n");
    assert.deepEqual(actual, JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")));
  });

  it("reads are read-only, and removals are destructive", () => {
    for (const t of tools) {
      const a = t.annotations ?? {};
      if (/^(get|search)_/.test(t.name)) assert.equal(a.readOnlyHint, true, t.name);
      if (/^(remove|delete|clear)_|^update_basket_quantity$/.test(t.name)) {
        assert.equal(a.destructiveHint, true, t.name);
      }
      if (!a.readOnlyHint)
        assert.equal(typeof a.destructiveHint, "boolean", `${t.name} must say whether it is destructive`);
      assert.equal(a.openWorldHint, true, t.name);
    }
  });
});
