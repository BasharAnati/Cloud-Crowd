"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OutputInternalConsistencyError,
  OutputLimitError,
  OutputRenderError,
  OutputUnsupportedFormatError,
  OutputUntrustedInputError,
  classifyError,
} = require("../../src/errors");
const { FORMAT_POLICIES, LIMITS } = require("../../src/output/policy");
const { createBoundedWriter } = require("../../src/output/writer");
const { zeroAuditResult } = require("./helpers");

function code(expected) {
  return (error) => {
    const classification = classifyError(error);
    assert.equal(classification.publicCode, expected);
    assert.equal(classification.exitCode, 11);
    assert.equal(JSON.stringify(classification).includes("CANARY"), false);
    return true;
  };
}

function withWriterLimits(overrides, operation) {
  const policyPath = require.resolve("../../src/output/policy");
  const writerPath = require.resolve("../../src/output/writer");
  const priorPolicy = require.cache[policyPath];
  const priorWriter = require.cache[writerPath];
  try {
    const actual = require(policyPath);
    require.cache[policyPath] = {
      id: policyPath, filename: policyPath, loaded: true,
      exports: Object.freeze({ ...actual, LIMITS: Object.freeze(Object.assign(Object.create(null), { ...actual.LIMITS, ...overrides })) }),
    };
    delete require.cache[writerPath];
    return operation(require(writerPath).createBoundedWriter);
  } finally {
    if (priorPolicy) require.cache[policyPath] = priorPolicy;
    else delete require.cache[policyPath];
    if (priorWriter) require.cache[writerPath] = priorWriter;
    else delete require.cache[writerPath];
  }
}

test("fixed output limits are exact", () => {
  assert.deepEqual({
    json: FORMAT_POLICIES.json.maximumBytes,
    markdown: FORMAT_POLICIES.markdown.maximumBytes,
    html: FORMAT_POLICIES.html.maximumBytes,
    ...LIMITS,
  }, {
    json: 64 * 1024 * 1024,
    markdown: 64 * 1024 * 1024,
    html: 96 * 1024 * 1024,
    entries: 100_000,
    references: 1_000_000,
    lines: 2_000_000,
    htmlNodes: 2_000_000,
  });
});

test("bounded writer accepts the exact byte boundary and rejects one over without partial output", () => {
  const exact = createBoundedWriter(Object.freeze({ maximumBytes: 2 }));
  exact.line("a");
  assert.equal(exact.finish(), "a\n");
  const over = createBoundedWriter(Object.freeze({ maximumBytes: 2 }));
  let output = Symbol("none");
  assert.throws(() => { over.line("ab"); output = over.finish(); }, code("OUTPUT_LIMIT_EXCEEDED"));
  assert.equal(typeof output, "symbol");
});

test("entry, reference, line, and HTML-node limits fail closed", () => {
  withWriterLimits({ entries: 1, references: 1, lines: 1, htmlNodes: 1 }, (createWriter) => {
    const entries = createWriter({ maximumBytes: 100 });
    entries.entry();
    assert.throws(() => entries.entry(), code("OUTPUT_LIMIT_EXCEEDED"));
    const references = createWriter({ maximumBytes: 100 });
    references.reference();
    assert.throws(() => references.reference(), code("OUTPUT_LIMIT_EXCEEDED"));
    const lines = createWriter({ maximumBytes: 100 });
    lines.line("one");
    assert.throws(() => lines.line("two"), code("OUTPUT_LIMIT_EXCEEDED"));
    const nodes = createWriter({ maximumBytes: 100 });
    assert.throws(() => nodes.line("<p>x</p>", 2), code("OUTPUT_LIMIT_EXCEEDED"));
  });
});

test("output error classifications ignore mutated fields and throwing getters", () => {
  for (const ErrorClass of [OutputUntrustedInputError, OutputUnsupportedFormatError, OutputRenderError,
    OutputLimitError, OutputInternalConsistencyError]) {
    const error = new ErrorClass("RAW_CANARY_MESSAGE");
    Object.defineProperty(error, "code", { get() { throw new Error("CODE_CANARY"); } });
    Object.defineProperty(error, "exitCode", { get() { throw new Error("EXIT_CANARY"); } });
    const classification = classifyError(error);
    assert.equal(classification.exitCode, 11);
    assert.equal(classification.publicMessage.includes("CANARY"), false);
  }
});

async function withRendererFailure(format, error, operation) {
  const rendererPath = require.resolve(`../../src/output/${format}`);
  const adapterPath = require.resolve("../../src/output/adapter");
  const indexPath = require.resolve("../../src/output/index");
  const paths = [rendererPath, adapterPath, indexPath];
  const prior = new Map(paths.map((path) => [path, require.cache[path]]));
  try {
    const exportName = format === "html" ? "renderHtml" : format === "json" ? "renderJson" : "renderMarkdown";
    require.cache[rendererPath] = {
      id: rendererPath, filename: rendererPath, loaded: true,
      exports: Object.freeze({ [exportName]() { throw error; } }),
    };
    delete require.cache[adapterPath];
    delete require.cache[indexPath];
    return await operation(require("../../src/output"));
  } finally {
    for (const path of paths) {
      const entry = prior.get(path);
      if (entry) require.cache[path] = entry;
      else delete require.cache[path];
    }
  }
}

test("unexpected renderer failures are sanitized and trusted renderer failures are preserved", async () => {
  const result = await zeroAuditResult();
  await withRendererFailure("html", new Error("RAW_RENDER_CANARY"), (freshOutput) => {
    assert.throws(() => freshOutput.renderAuditOutput(result, "html"), code("OUTPUT_RENDER_FAILURE"));
  });
  const internal = new OutputInternalConsistencyError("RAW_INTERNAL_CANARY");
  await withRendererFailure("markdown", internal, (freshOutput) => {
    assert.throws(() => freshOutput.renderAuditOutput(result, "markdown"), (error) => {
      assert.strictEqual(error, internal);
      return code("OUTPUT_INTERNAL_CONSISTENCY_FAILURE")(error);
    });
  });
  const limit = new OutputLimitError("RAW_LIMIT_CANARY");
  await withRendererFailure("json", limit, (freshOutput) => {
    assert.throws(() => freshOutput.renderAuditOutput(result, "json"), (error) => {
      assert.strictEqual(error, limit);
      return code("OUTPUT_LIMIT_EXCEEDED")(error);
    });
  });
});
