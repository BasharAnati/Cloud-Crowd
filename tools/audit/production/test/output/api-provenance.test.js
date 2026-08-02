"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyError } = require("../../src/errors");
const output = require("../../src/output");
const { verifyTrustedOutputArtifact } = require("../../src/output/artifact");
const { createAuditResult } = require("../../src/orchestrator/result");
const { buildAuditReport } = require("../../src/report");
const { zeroFindingResult } = require("../report/helpers");
const { deeplyFrozen, populatedAuditResult, zeroAuditResult } = require("./helpers");

const OUTPUT_MODULES = Object.freeze([
  "adapter", "artifact", "escaping", "html", "index", "json", "markdown", "policy", "size", "validation", "writer",
]);

function classified(code) {
  return (error) => {
    assert.equal(classifyError(error).publicCode, code);
    assert.equal(classifyError(error).exitCode, 11);
    return true;
  };
}

function perfectArtifactLookalike(format, content) {
  const policy = require("../../src/output/policy").FORMAT_POLICIES[format];
  return Object.freeze(Object.assign(Object.create(null), {
    format,
    mediaType: policy.mediaType,
    fileExtension: policy.fileExtension,
    outputSchemaVersion: "1",
    byteLength: Buffer.byteLength(content, "utf8"),
    content,
  }));
}

async function withClosedPolicy({ limits = {}, maximumBytes = {} }, operation) {
  const names = ["policy", "validation", "writer", "json", "markdown", "html", "adapter", "artifact", "index"];
  const paths = names.map((name) => require.resolve(`../../src/output/${name}`));
  const prior = new Map(paths.map((path) => [path, require.cache[path]]));
  const policyPath = require.resolve("../../src/output/policy");
  try {
    const actual = require(policyPath);
    const policies = Object.create(null);
    for (const format of actual.FORMAT_NAMES) {
      policies[format] = Object.freeze(Object.assign(Object.create(null), actual.FORMAT_POLICIES[format],
        Object.hasOwn(maximumBytes, format) ? { maximumBytes: maximumBytes[format] } : null));
    }
    const frozenPolicies = Object.freeze(policies);
    const formatPolicy = Object.freeze((format) => typeof format === "string" && Object.hasOwn(frozenPolicies, format)
      ? frozenPolicies[format] : null);
    require.cache[policyPath] = {
      id: policyPath,
      filename: policyPath,
      loaded: true,
      exports: Object.freeze({
        ...actual,
        FORMAT_POLICIES: frozenPolicies,
        LIMITS: Object.freeze(Object.assign(Object.create(null), actual.LIMITS, limits)),
        formatPolicy,
      }),
    };
    for (const path of paths) if (path !== policyPath) delete require.cache[path];
    return await operation(require("../../src/output"), require("../../src/output/artifact"));
  } finally {
    for (const path of paths) {
      const entry = prior.get(path);
      if (entry) require.cache[path] = entry;
      else delete require.cache[path];
    }
  }
}

async function withClosedRenderer(format, renderer, operation) {
  const rendererPath = require.resolve(`../../src/output/${format}`);
  const names = ["adapter", "artifact", "index"];
  const paths = [rendererPath, ...names.map((name) => require.resolve(`../../src/output/${name}`))];
  const prior = new Map(paths.map((path) => [path, require.cache[path]]));
  try {
    const exportName = format === "html" ? "renderHtml" : format === "json" ? "renderJson" : "renderMarkdown";
    require.cache[rendererPath] = {
      id: rendererPath,
      filename: rendererPath,
      loaded: true,
      exports: Object.freeze({ [exportName]: Object.freeze(renderer) }),
    };
    for (const path of paths.slice(1)) delete require.cache[path];
    return await operation(require("../../src/output"), require("../../src/output/artifact"));
  } finally {
    for (const path of paths) {
      const entry = prior.get(path);
      if (entry) require.cache[path] = entry;
      else delete require.cache[path];
    }
  }
}

test("public API is exact, frozen, synchronous, and requires exactly two arguments", async () => {
  assert.deepEqual(Object.keys(output), ["renderAuditOutput"]);
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.renderAuditOutput), true);
  assert.equal(output.renderAuditOutput.length, 2);
  assert.throws(() => output.renderAuditOutput(), classified("OUTPUT_UNSUPPORTED_FORMAT"));
  assert.throws(() => output.renderAuditOutput(null, "json", null), classified("OUTPUT_UNSUPPORTED_FORMAT"));
  const result = await zeroAuditResult();
  for (const format of [undefined, "", "JSON", " json", "json ", Symbol("json"), new String("json"), {}, () => {}]) {
    assert.throws(() => output.renderAuditOutput(result, format), classified("OUTPUT_UNSUPPORTED_FORMAT"));
  }
});

test("only a genuine completed PR7 result is accepted", async () => {
  const result = await zeroAuditResult();
  for (const format of ["json", "markdown", "html"]) assert.doesNotThrow(() => output.renderAuditOutput(result, format));
  const lookalikes = [
    {},
    Object.freeze({ ...result }),
    Object.freeze(Object.assign(Object.create(null), result)),
    JSON.parse(JSON.stringify(result)),
    result.report,
    Object.freeze(Object.assign(Object.create(null), {
      report: result.report, summary: result.summary, statistics: result.statistics,
      metadata: Object.freeze(Object.assign(Object.create(null), { schemaVersion: "1", executionVersion: "1", completed: true })),
    })),
  ];
  for (const value of lookalikes) assert.throws(() => output.renderAuditOutput(value, "json"), classified("OUTPUT_UNTRUSTED_INPUT"));
  assert.throws(() => output.renderAuditOutput(new Proxy(result, {}), "json"), classified("OUTPUT_UNTRUSTED_INPUT"));
  const revoked = Proxy.revocable(result, {});
  revoked.revoke();
  assert.throws(() => output.renderAuditOutput(revoked.proxy, "json"), classified("OUTPUT_UNTRUSTED_INPUT"));
});

test("results issued by another private registry instance are rejected", async () => {
  const outputModule = require("../../src/output");
  const resultPath = require.resolve("../../src/orchestrator/result");
  const prior = require.cache[resultPath];
  try {
    delete require.cache[resultPath];
    const foreignProducer = require("../../src/orchestrator/result");
    const parity = await zeroFindingResult();
    const foreign = foreignProducer.createAuditResult(parity, buildAuditReport(parity));
    assert.throws(() => outputModule.renderAuditOutput(foreign, "json"), classified("OUTPUT_UNTRUSTED_INPUT"));
  } finally {
    if (prior) require.cache[resultPath] = prior;
    else delete require.cache[resultPath];
  }
});

test("artifact schema, immutability, and private provenance are exact", async () => {
  const artifact = output.renderAuditOutput(await zeroAuditResult(), "json");
  assert.deepEqual(Object.keys(artifact), [
    "format", "mediaType", "fileExtension", "outputSchemaVersion", "byteLength", "content",
  ]);
  assert.equal(Object.getPrototypeOf(artifact), null);
  assert.equal(typeof artifact.content, "string");
  assert.equal(deeplyFrozen(artifact), true);
  assert.strictEqual(verifyTrustedOutputArtifact(artifact), artifact);
  assert.throws(() => verifyTrustedOutputArtifact(Object.freeze({ ...artifact })), TypeError);
  assert.equal(Object.hasOwn(output, "verifyTrustedOutputArtifact"), false);
  assert.equal(Object.hasOwn(output, "createOutputArtifact"), false);
});

test("genuine PR6 and PR5 values without the completed PR7 wrapper are rejected", async () => {
  const parity = await zeroFindingResult();
  const report = buildAuditReport(parity);
  assert.throws(() => output.renderAuditOutput(report, "json"), classified("OUTPUT_UNTRUSTED_INPUT"));
  assert.throws(() => output.renderAuditOutput(parity, "json"), classified("OUTPUT_UNTRUSTED_INPUT"));
  assert.doesNotThrow(() => output.renderAuditOutput(createAuditResult(parity, report), "json"));
});

test("all output exports are frozen and expose no artifact issuer, registrar, factory, token, or mutable registry", () => {
  assert.deepEqual(Object.keys(output), ["renderAuditOutput"]);
  assert.deepEqual(Object.keys(require("../../src/output/artifact")), ["verifyTrustedOutputArtifact"]);
  assert.deepEqual(Object.keys(require("../../src/output/adapter")), ["renderAuditOutput", "verifyTrustedOutputArtifact"]);
  const trustMintingName = /(?:create|register|issue|finalize).*(?:artifact|trust)|(?:artifact|trust).*(?:create|register|issue|finalize)|token|registry/iu;
  for (const name of OUTPUT_MODULES) {
    const exported = require(`../../src/output/${name}`);
    assert.equal(Object.isFrozen(exported), true, name);
    for (const [key, value] of Object.entries(exported)) {
      assert.equal(trustMintingName.test(key), false, `${name}.${key}`);
      if (typeof value === "function") assert.equal(Object.isFrozen(value), true, `${name}.${key}`);
    }
  }
});

test("lookalikes, copies, proxies, and revoked proxies cannot acquire artifact trust", async () => {
  const genuine = output.renderAuditOutput(await zeroAuditResult(), "json");
  const values = [
    perfectArtifactLookalike("json", genuine.content),
    Object.freeze({ ...genuine }),
    JSON.parse(JSON.stringify(genuine)),
    new Proxy(genuine, {}),
  ];
  for (const value of values) assert.throws(() => verifyTrustedOutputArtifact(value), TypeError);
  const revoked = Proxy.revocable(genuine, {});
  revoked.revoke();
  assert.throws(() => verifyTrustedOutputArtifact(revoked.proxy), TypeError);
});

test("artifacts from another private registry instance are rejected", async () => {
  const adapterPath = require.resolve("../../src/output/adapter");
  const prior = require.cache[adapterPath];
  try {
    delete require.cache[adapterPath];
    const foreignAdapter = require("../../src/output/adapter");
    const foreign = foreignAdapter.renderAuditOutput(await zeroAuditResult(), "html");
    assert.throws(() => verifyTrustedOutputArtifact(foreign), TypeError);
    const local = output.renderAuditOutput(await zeroAuditResult(), "html");
    assert.throws(() => foreignAdapter.verifyTrustedOutputArtifact(local), TypeError);
  } finally {
    if (prior) require.cache[adapterPath] = prior;
    else delete require.cache[adapterPath];
  }
});

test("only complete genuine renders issue frozen trusted artifacts for the three closed formats", async () => {
  const result = await populatedAuditResult();
  for (const format of ["json", "markdown", "html"]) {
    const artifact = output.renderAuditOutput(result, format);
    assert.equal(Object.isFrozen(artifact), true);
    assert.equal(artifact.format, format);
    assert.strictEqual(verifyTrustedOutputArtifact(artifact), artifact);
  }
  assert.throws(() => verifyTrustedOutputArtifact(
    perfectArtifactLookalike("html", "ARBITRARY_SECRET_CANARY\n")), TypeError);
});

test("invalid final Unicode cannot produce or register an artifact", async () => {
  const result = await zeroAuditResult();
  await withClosedRenderer("json", () => "\ud800\n", (freshOutput, freshArtifact) => {
    let artifact;
    assert.throws(() => { artifact = freshOutput.renderAuditOutput(result, "json"); },
      classified("OUTPUT_INTERNAL_CONSISTENCY_FAILURE"));
    assert.equal(artifact, undefined);
    assert.throws(() => freshArtifact.verifyTrustedOutputArtifact(
      perfectArtifactLookalike("json", "\\ud800\n")), TypeError);
  });
});

test("real render limits fail before any artifact can be returned or trusted", async () => {
  const zero = await zeroAuditResult();
  const populated = await populatedAuditResult();
  const cases = [
    [{ limits: { entries: 0 } }, populated, "markdown"],
    [{ limits: { references: 0 } }, populated, "markdown"],
    [{ limits: { lines: 1 } }, zero, "markdown"],
    [{ limits: { htmlNodes: 1 } }, zero, "html"],
    [{ maximumBytes: { json: 1 } }, zero, "json"],
  ];
  for (const [policy, result, format] of cases) {
    await withClosedPolicy(policy, (freshOutput, freshArtifact) => {
      let artifact;
      assert.throws(() => { artifact = freshOutput.renderAuditOutput(result, format); },
        classified("OUTPUT_LIMIT_EXCEEDED"));
      assert.equal(artifact, undefined);
      assert.throws(() => freshArtifact.verifyTrustedOutputArtifact(
        perfectArtifactLookalike(format, `UNTRUSTED_${format}\n`)), TypeError);
    });
  }
});
