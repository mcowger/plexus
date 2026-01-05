import { spawn } from "bun";
import { join } from "path";

const BACKEND_DIR = join(process.cwd(), "packages/backend");
const FRONTEND_DIR = join(process.cwd(), "packages/frontend");
const BACKEND_PORT = 4000;
const FRONTEND_PORT = 3000;

console.log("🚀 Starting Plexus Dev Stack...");

// 1. Start Backend in Watch Mode
const backend = spawn(["bun", "run", "--watch", "src/index.ts"], {
  cwd: BACKEND_DIR,
  env: { ...process.env, PORT: BACKEND_PORT.toString() },
  stdout: "inherit",
  stderr: "inherit",
});

// 2. Start Frontend Builder
console.log("🔨 [Frontend] Starting Builder (Watch Mode)...");
const frontend = spawn(["bun", "run", "dev"], {
  cwd: FRONTEND_DIR,
  stdout: "inherit",
  stderr: "inherit",
});

console.log(`✅ Backend serving at http://localhost:${BACKEND_PORT}`);
console.log(`👀 Watching for changes...`);

// Cleanup on exit
process.on("SIGINT", async () => {
  console.log("\n🛑 Stopping...");
  
  // Send SIGINT to allow graceful shutdown
  backend.kill("SIGINT");
  frontend.kill("SIGINT");

  // Wait for children to exit to prevent terminal artifacts
  await Promise.all([backend.exited, frontend.exited]);
  
  process.exit(0);
});