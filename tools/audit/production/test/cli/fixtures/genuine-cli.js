"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const Module = require("node:module");
const path = require("node:path");
const {
  FakeClient,
  google,
  safeEnvironment,
} = require("../../output/fixtures/genuine-output");

class CaptureStream extends EventEmitter {
  constructor() {
    super();
    this.chunks = [];
    this.writes = 0;
  }

  write(chunk, callback) {
    this.writes += 1;
    this.chunks.push(Buffer.from(chunk));
    queueMicrotask(() => callback && callback());
    return true;
  }

  content() { return Buffer.concat(this.chunks); }
}

async function run() {
  const directory = process.argv[2];
  if (!directory) throw new Error("fixture directory is required");
  Object.assign(process.env, safeEnvironment());
  const originalLoad = Module._load;
  Module._load = function fakeExternalDrivers(request, parent, isMain) {
    if (request === "pg") return { Client: FakeClient };
    if (request === "googleapis") return { google: google.factory() };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { run: runCli } = require("../../../src/cli");
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    const markdownPath = path.join(directory, "audit.md");
    const htmlPath = path.join(directory, "audit.html");
    const common = { env: process.env, version: "1.0.0", stderr };
    const jsonExit = await runCli({
      ...common,
      args: ["audit", "--format", "json", "--stdout"],
      stdout,
    });
    const markdownExit = await runCli({
      ...common,
      args: ["audit", "--format", "markdown", "--output", markdownPath],
      stdout,
    });
    const htmlExit = await runCli({
      ...common,
      args: ["audit", "--format", "html", "--output", htmlPath],
      stdout,
    });
    const markdown = await fs.readFile(markdownPath, "utf8");
    const html = await fs.readFile(htmlPath, "utf8");
    const json = stdout.content().toString("utf8");
    return {
      exits: [jsonExit, markdownExit, htmlExit],
      stdoutWrites: stdout.writes,
      stderrWrites: stderr.writes,
      formats: [JSON.parse(json).outputType, markdown.startsWith("# Cloud Crowd Audit Report\n"), html.startsWith("<!doctype html>\n")],
      finalLf: [json, markdown, html].every((content) => content.endsWith("\n") && !content.endsWith("\n\n")),
      canary: [json, markdown, html].some((content) => [
        "POSTGRES_RAW_CANARY",
        "SHEETS_RAW_CANARY",
        "PRIVATE_CUSTOMER_CANARY",
        "SECRET_NOTES_CANARY",
        "COMPLAINT_CANARY",
      ].some((value) => content.includes(value))),
      temporaryFiles: (await fs.readdir(directory)).filter((name) => name.startsWith(".cloud-crowd-audit-")),
    };
  } finally {
    Module._load = originalLoad;
  }
}

run().then((value) => process.stdout.write(`${JSON.stringify(value)}\n`), (error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
