"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { types } = require("node:util");
const {
  CliCleanupError,
  CliDestinationExistsError,
  CliInternalError,
  CliWriteError,
  classifyError,
} = require("../errors");
const { verifyTrustedOutputArtifact } = require("../output/artifact");
const { revalidateOutputPath, verifyPreparedOutputPath } = require("./path-policy");

const TEMP_ATTEMPTS = 8;
// This produces restrictive POSIX inode permissions. Windows ACL behavior is
// controlled by the host filesystem and is not claimed to be equivalent.
const TEMP_MODE = 0o600;

function safeCode(error) {
  if (!error || typeof error !== "object" || types.isProxy(error)) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string"
      ? descriptor.value : null;
  } catch (_) {
    return null;
  }
}

function trustedOrWriteError(error) {
  return classifyError(error).publicCode === "INTERNAL_ERROR"
    ? new CliWriteError("Audit output file operation failed") : error;
}

async function createTemporaryFile(parentPath) {
  for (let attempt = 0; attempt < TEMP_ATTEMPTS; attempt += 1) {
    let suffix;
    try { suffix = crypto.randomBytes(16).toString("hex"); } catch (_) {
      throw new CliWriteError("Audit output temporary name failed");
    }
    const temporaryPath = path.join(parentPath, `.cloud-crowd-audit-${suffix}.tmp`);
    try {
      const handle = await fs.open(temporaryPath, "wx", TEMP_MODE);
      return Object.freeze({ handle, temporaryPath });
    } catch (error) {
      if (safeCode(error) !== "EEXIST") throw new CliWriteError("Audit output temporary file failed");
    }
  }
  throw new CliWriteError("Audit output temporary name collisions exceeded the limit");
}

async function writeComplete(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    let result;
    try { result = await handle.write(bytes, offset, bytes.length - offset, offset); } catch (_) {
      throw new CliWriteError("Audit output write failed");
    }
    if (!result || !Number.isSafeInteger(result.bytesWritten) || result.bytesWritten <= 0 ||
        result.bytesWritten > bytes.length - offset) {
      throw new CliWriteError("Audit output write made invalid progress");
    }
    offset += result.bytesWritten;
  }
}

async function writeArtifactAtomically(artifact, preparedPath) {
  let trustedArtifact;
  let trustedPath;
  try {
    trustedArtifact = verifyTrustedOutputArtifact(artifact);
    trustedPath = verifyPreparedOutputPath(preparedPath);
  } catch (_) {
    throw new CliInternalError("Trusted artifact and output path are required");
  }
  if (trustedArtifact.format !== trustedPath.format ||
      trustedArtifact.fileExtension !== trustedPath.expectedExtension) {
    throw new CliInternalError("Artifact and output path formats differ");
  }
  const bytes = Buffer.from(trustedArtifact.content, "utf8");
  if (bytes.length !== trustedArtifact.byteLength) throw new CliInternalError("Artifact byte length is invalid");

  await revalidateOutputPath(trustedPath);
  let handle = null;
  let temporaryPath = null;
  let temporaryExists = false;
  let published = false;
  let failure = null;
  try {
    const temporary = await createTemporaryFile(trustedPath.parentPath);
    handle = temporary.handle;
    temporaryPath = temporary.temporaryPath;
    temporaryExists = true;
    await writeComplete(handle, bytes);
    try { await handle.sync(); } catch (_) { throw new CliWriteError("Audit output fsync failed"); }
    let stat;
    try { stat = await handle.stat(); } catch (_) { throw new CliWriteError("Audit output verification failed"); }
    if (!stat.isFile() || stat.size !== bytes.length) throw new CliWriteError("Audit output size verification failed");
    try { await handle.close(); } catch (_) { throw new CliWriteError("Audit output close failed"); }
    handle = null;

    // Revalidation detects changes visible before publication. Node's
    // path-based APIs cannot close the interval between this check and link;
    // the documented trusted-parent assumption applies across that interval.
    await revalidateOutputPath(trustedPath);
    // Publication requires same-filesystem hard-link support. Unsupported
    // filesystems fail closed; there is no rename, copy, or direct-write fallback.
    try { await fs.link(temporaryPath, trustedPath.resolvedPath); } catch (error) {
      if (safeCode(error) === "EEXIST") throw new CliDestinationExistsError("Audit output destination exists");
      throw new CliWriteError("Audit output atomic publication failed");
    }
    published = true;
    try { await fs.unlink(temporaryPath); } catch (_) { throw new CliCleanupError("Audit output temporary cleanup failed"); }
    temporaryExists = false;
  } catch (error) {
    failure = trustedOrWriteError(error);
  } finally {
    if (handle) {
      try { await handle.close(); } catch (_) {
        if (!failure) failure = new CliCleanupError("Audit output handle cleanup failed");
      }
    }
    if (temporaryExists && temporaryPath) {
      try { await fs.unlink(temporaryPath); } catch (error) {
        if (safeCode(error) !== "ENOENT" && !failure) failure = new CliCleanupError("Audit output temporary cleanup failed");
      }
    }
  }
  if (failure) throw failure;
  if (!published) throw new CliWriteError("Audit output was not published");
}

Object.freeze(writeArtifactAtomically);

module.exports = Object.freeze({ writeArtifactAtomically });
