#!/usr/bin/env node
/**
 * Pre-commit safety checks.
 *
 * Add this as a git hook to run before every commit:
 *   echo 'node scripts/precommit.js' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
 *
 * Or run manually:
 *   npm run precommit
 */

const { execSync } = require("child_process");

let ok = true;

// 1. Block .env from being committed
try {
  const staged = execSync("git diff --cached --name-only", { encoding: "utf8" });
  if (staged.includes(".env")) {
    console.error("❌ .env is staged for commit! Run: git reset HEAD .env");
    ok = false;
  }
} catch {
  // Not a git repo or no commits yet — skip
}

// 2. Block .mcp.json from being committed (user-local Claude Code config)
try {
  const staged = execSync("git diff --cached --name-only", { encoding: "utf8" });
  if (staged.includes(".mcp.json")) {
    console.error("❌ .mcp.json is staged for commit! This file contains your local MCP config.");
    ok = false;
  }
} catch {
  // skip
}

// 3. Ensure TypeScript compiles
try {
  execSync("npm run build", { stdio: "pipe" });
  console.log("✓ TypeScript build passes");
} catch {
  console.error("❌ TypeScript build failed");
  ok = false;
}

// 4. Ensure tests pass
try {
  execSync("npm test", { stdio: "pipe" });
  console.log("✓ Tests pass");
} catch {
  console.error("❌ Tests failed");
  ok = false;
}

if (!ok) {
  console.error("\nPre-commit checks failed. Fix the issues above and try again.");
  process.exit(1);
}

console.log("✓ All pre-commit checks passed");
