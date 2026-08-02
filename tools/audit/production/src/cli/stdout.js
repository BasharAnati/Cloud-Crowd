"use strict";

const { types } = require("node:util");
const {
  CliBrokenPipeError,
  CliInternalError,
  CliWriteError,
  classifyError,
} = require("../errors");
const { verifyTrustedOutputArtifact } = require("../output/artifact");
const { verifyReadOnlyCapability } = require("../safety-kernel");
const { AUDIT_HELP, HELP } = require("./help");

const VERSION_PATTERN = /^(?:0|[1-9][0-9]{0,9})\.(?:0|[1-9][0-9]{0,9})\.(?:0|[1-9][0-9]{0,9})$/u;
const TERMINAL_OBSERVATION_MS = 1_000;

function isBrokenPipe(error) {
  if (!error || typeof error !== "object" || types.isProxy(error)) return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return !!descriptor && Object.hasOwn(descriptor, "value") && descriptor.value === "EPIPE";
  } catch (_) {
    return false;
  }
}

function streamFailure(error) {
  return isBrokenPipe(error)
    ? new CliBrokenPipeError("Audit output stream was closed")
    : new CliWriteError("Audit output stream failed");
}

function writeBuffer(stream, buffer) {
  return new Promise((resolve, reject) => {
    if (!stream || typeof stream !== "object" || typeof stream.write !== "function" || !Buffer.isBuffer(buffer)) {
      reject(new CliInternalError("Output stream is invalid"));
      return;
    }
    let callbackComplete = false;
    let drainRequired = false;
    let drainComplete = false;
    let writeReturned = false;
    let settled = false;
    let terminalRequested = false;
    let terminalError = null;
    let lateGuardInstalled = false;
    let observationTimer = null;

    function removeActiveListeners() {
      if (typeof stream.removeListener === "function") {
        stream.removeListener("error", onError);
        stream.removeListener("close", onClose);
        stream.removeListener("drain", onDrain);
      }
    }
    function removeLateGuard() {
      if (lateGuardInstalled && typeof stream.removeListener === "function") {
        stream.removeListener("error", onLateError);
        stream.removeListener("close", onLateClose);
      }
      lateGuardInstalled = false;
    }
    function clearObservationTimer() {
      if (observationTimer !== null) clearTimeout(observationTimer);
      observationTimer = null;
    }
    function settle() {
      if (settled) return;
      settled = true;
      clearObservationTimer();
      removeLateGuard();
      if (terminalError) reject(terminalError);
      else resolve();
    }
    function requestTerminal(error) {
      if (settled) return;
      if (error && !terminalError) terminalError = error;
      if (terminalRequested) return;
      terminalRequested = true;
      removeActiveListeners();
      if (typeof stream.on === "function" && typeof stream.removeListener === "function") {
        stream.on("error", onLateError);
        stream.on("close", onLateClose);
        lateGuardInstalled = true;
      }
      // Non-ending streams such as process.stdout have no per-write "finished"
      // event. After callback/drain completion, clean success remains pending
      // for this complete fixed observation boundary. A failure detected before
      // those prerequisites uses the same fixed boundary to contain duplicates.
      // Events after the boundary and listener cleanup are not attributed to
      // this completed write. The deadline is never extended by stream activity.
      observationTimer = setTimeout(settle, TERMINAL_OBSERVATION_MS);
    }
    function maybeFinish() {
      if (writeReturned && callbackComplete && (!drainRequired || drainComplete)) requestTerminal(null);
    }
    function onError(error) { requestTerminal(streamFailure(error)); }
    function onClose() { requestTerminal(new CliWriteError("Audit output stream closed")); }
    function onDrain() { drainComplete = true; maybeFinish(); }
    function onLateError(error) {
      if (!terminalError) terminalError = streamFailure(error);
    }
    function onLateClose() {
      if (!terminalError) terminalError = new CliWriteError("Audit output stream closed");
    }

    if (typeof stream.once === "function") {
      stream.once("error", onError);
      stream.once("close", onClose);
      stream.once("drain", onDrain);
    }
    try {
      const accepted = stream.write(buffer, (error) => {
        if (error) {
          requestTerminal(streamFailure(error));
          return;
        }
        callbackComplete = true;
        maybeFinish();
      });
      drainRequired = accepted === false;
      drainComplete = !drainRequired;
      writeReturned = true;
      maybeFinish();
    } catch (error) {
      requestTerminal(streamFailure(error));
    }
  });
}

async function writeArtifactToStdout(stdout, artifact) {
  let trusted;
  try { trusted = verifyTrustedOutputArtifact(artifact); } catch (_) {
    throw new CliInternalError("A trusted output artifact is required");
  }
  const content = trusted.content;
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length !== trusted.byteLength) throw new CliInternalError("Output artifact byte length is invalid");
  await writeBuffer(stdout, bytes);
}

async function writeHelpToStdout(stdout, helpKind) {
  const content = helpKind === "global" ? HELP : helpKind === "audit" ? AUDIT_HELP : null;
  if (content === null) throw new CliInternalError("CLI help kind is invalid");
  await writeBuffer(stdout, Buffer.from(content, "utf8"));
}

async function writeVersionToStdout(stdout, version) {
  if (typeof version !== "string" || version.length > 128 || !VERSION_PATTERN.test(version)) {
    throw new CliInternalError("CLI version is invalid");
  }
  await writeBuffer(stdout, Buffer.from(`${version}\n`, "utf8"));
}

async function writePreflightToStdout(stdout, capability) {
  verifyReadOnlyCapability(capability);
  await writeBuffer(stdout, Buffer.from(
    "Production audit preflight passed\nTarget: production\nMode: read-only\nWrites allowed: false\n",
    "utf8"
  ));
}

async function writePublicErrorToStderr(stderr, error) {
  const classification = classifyError(error);
  await writeBuffer(stderr, Buffer.from(
    `ERROR [${classification.publicCode}]: ${classification.publicMessage}\n`,
    "utf8"
  ));
}

for (const operation of [writeArtifactToStdout, writeHelpToStdout, writeVersionToStdout,
  writePreflightToStdout, writePublicErrorToStderr]) Object.freeze(operation);

module.exports = Object.freeze({
  writeArtifactToStdout,
  writeHelpToStdout,
  writePreflightToStdout,
  writePublicErrorToStderr,
  writeVersionToStdout,
});
