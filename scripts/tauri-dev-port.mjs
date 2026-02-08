#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";

function printHelp() {
  console.log(`Usage:
  node scripts/tauri-dev-port.mjs [--port <port>] [--hmr-port <port>] [-- <tauri dev args...>]

Examples:
  npm run tauri:dev:port
  npm run tauri:dev:port -- --port 1430
  npm run tauri:dev:port -- --port 1430 -- --verbose

Notes:
- Defaults to port 1430 so you can keep another instance running on 1420.
- Sets SYNK_VITE_PORT and SYNK_VITE_HMR_PORT so Vite binds to the same port Tauri points at.
`);
}

function parseArgs(argv) {
  let port = 1430;
  let hmrPort = null;
  const passthrough = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--help" || a === "-h") {
      return { help: true };
    }

    if (a === "--") {
      passthrough.push(...argv.slice(i + 1));
      break;
    }

    if (a === "--port") {
      const v = argv[++i];
      if (!v) throw new Error("--port requires a value");
      port = Number(v);
      if (!Number.isFinite(port)) throw new Error(`Invalid --port: ${v}`);
      continue;
    }

    if (a === "--hmr-port") {
      const v = argv[++i];
      if (!v) throw new Error("--hmr-port requires a value");
      hmrPort = Number(v);
      if (!Number.isFinite(hmrPort)) throw new Error(`Invalid --hmr-port: ${v}`);
      continue;
    }

    passthrough.push(a);
  }

  return { help: false, port, hmrPort, passthrough };
}

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (err) => {
      server.close();
      reject(err);
    });

    server.listen(port, "127.0.0.1", () => {
      server.close(resolve);
    });
  });
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err?.message ?? err));
    process.exit(1);
  }

  if (parsed.help) {
    printHelp();
    return;
  }

  const port = parsed.port;
  const hmrPort = parsed.hmrPort ?? port + 1;

  try {
    await assertPortAvailable(port);
  } catch {
    console.error(`Port ${port} is not available. Pick another, e.g. --port ${port + 1}.`);
    process.exit(1);
  }

  const env = {
    ...process.env,
    SYNK_VITE_PORT: String(port),
    SYNK_VITE_HMR_PORT: String(hmrPort),
  };

  // Tauri CLI supports merging JSON strings via -c/--config.
  const mergedConfig = JSON.stringify({ build: { devUrl: `http://localhost:${port}` } });

  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = ["tauri", "dev", "-c", mergedConfig, ...parsed.passthrough];

  const child = spawn(cmd, args, { stdio: "inherit", env });
  child.on("exit", (code) => process.exit(code ?? 1));
}

main().catch((err) => {
  console.error(String(err?.stack ?? err));
  process.exit(1);
});
