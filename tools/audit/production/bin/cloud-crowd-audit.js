#!/usr/bin/env node

"use strict";

const { run } = require("../src/cli");
const { version } = require("../../../../package.json");

async function main() {
  process.exitCode = await run({
    args: process.argv.slice(2),
    env: process.env,
    version,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

if (require.main === module) {
  main().catch(() => {
    process.exitCode = 12;
  });
}
