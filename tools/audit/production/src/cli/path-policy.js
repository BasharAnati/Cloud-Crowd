"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { types } = require("node:util");
const { CliDestinationExistsError, CliPathError } = require("../errors");
const { FORMAT_POLICIES } = require("../output/policy");

const PREPARED_PATHS = new WeakMap();
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function pathFailure() { throw new CliPathError("Audit output path is invalid"); }

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

function validUnicode(value) {
  if (typeof value !== "string" || value.length === 0 || value.trim() === "" ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(value) || BIDI_CONTROLS.test(value)) pathFailure();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) pathFailure();
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) pathFailure();
  }
}

function windowsComponents(value, implementation) {
  if (/^(?:\\\\|\/\/)/u.test(value) || /^(?:\\\\\?|\\\\\.|\/\/\?|\/\/\.)[\\/]/u.test(value) ||
      /^[a-z]:[^\\/]/iu.test(value)) pathFailure();
  const root = implementation.parse(value).root;
  if (root && !/^[a-z]:[\\/]$/iu.test(root)) pathFailure();
  return value.slice(root.length).split(/[\\/]/u);
}

function validatePathSyntax(rawPath, format, platform = process.platform) {
  validUnicode(rawPath);
  const policy = FORMAT_POLICIES[format];
  if (!policy) pathFailure();
  const windows = platform === "win32";
  const implementation = windows ? path.win32 : path.posix;
  const components = windows
    ? windowsComponents(rawPath, implementation)
    : rawPath.slice(implementation.parse(rawPath).root.length).split("/");
  if (components.length === 0 || components.some((component) => component === "" || component === "." || component === "..")) {
    pathFailure();
  }
  for (const component of components) {
    validUnicode(component);
    if (Buffer.byteLength(component, "utf8") > 255 || component.length > 255) pathFailure();
    if (windows && (/[<>:"|?*]/u.test(component) || /[ .]$/u.test(component) || WINDOWS_RESERVED.test(component))) {
      pathFailure();
    }
  }
  const basename = components.at(-1);
  const extension = implementation.extname(basename);
  const stem = basename.slice(0, basename.length - extension.length);
  if (extension !== policy.fileExtension || stem === "" || stem.trim() === "") pathFailure();

  const resolvedPath = implementation.resolve(rawPath);
  if (resolvedPath === implementation.parse(resolvedPath).root) pathFailure();
  if ((windows && resolvedPath.length > 240) || (!windows && Buffer.byteLength(resolvedPath, "utf8") > 4096)) pathFailure();
  return Object.freeze(Object.assign(Object.create(null), {
    platform: windows ? "win32" : "posix",
    format,
    expectedExtension: policy.fileExtension,
    resolvedPath,
    parentPath: implementation.dirname(resolvedPath),
  }));
}

function samePath(left, right, platform) {
  return platform === "win32"
    ? left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase()
    : left === right;
}

async function ensureSafeParent(syntax) {
  // These path-based checks reduce accidental and symlink/junction risk. They
  // rely on the documented contract that a trusted operator controls the
  // destination directory and its ancestors throughout command execution;
  // they cannot provide native handle-relative or race-free guarantees.
  try {
    const parent = await fs.lstat(syntax.parentPath);
    if (!parent.isDirectory() || parent.isSymbolicLink()) pathFailure();
    const realParent = await fs.realpath(syntax.parentPath);
    if (!samePath(realParent, syntax.parentPath, syntax.platform)) pathFailure();
  } catch (error) {
    if (error instanceof CliPathError) throw error;
    pathFailure();
  }
}

async function ensureDestinationAbsent(resolvedPath) {
  try {
    await fs.lstat(resolvedPath);
    throw new CliDestinationExistsError("Audit output destination exists");
  } catch (error) {
    if (error instanceof CliDestinationExistsError) throw error;
    if (safeCode(error) !== "ENOENT") pathFailure();
  }
}

async function prepareOutputPath(rawPath, format) {
  const syntax = validatePathSyntax(rawPath, format);
  await ensureSafeParent(syntax);
  await ensureDestinationAbsent(syntax.resolvedPath);
  const prepared = Object.freeze(Object.assign(Object.create(null), syntax));
  PREPARED_PATHS.set(prepared, Object.freeze({
    producer: "prepareOutputPath",
    completenessState: "complete",
    resolvedPath: syntax.resolvedPath,
  }));
  return prepared;
}

function verifyPreparedOutputPath(prepared) {
  const metadata = prepared && typeof prepared === "object" ? PREPARED_PATHS.get(prepared) : null;
  if (!metadata || metadata.producer !== "prepareOutputPath" || metadata.completenessState !== "complete") pathFailure();
  return prepared;
}

async function revalidateOutputPath(prepared) {
  const trusted = verifyPreparedOutputPath(prepared);
  await ensureSafeParent(trusted);
  await ensureDestinationAbsent(trusted.resolvedPath);
  return trusted;
}

for (const operation of [prepareOutputPath, revalidateOutputPath, validatePathSyntax, verifyPreparedOutputPath]) {
  Object.freeze(operation);
}

module.exports = Object.freeze({
  prepareOutputPath,
  revalidateOutputPath,
  validatePathSyntax,
  verifyPreparedOutputPath,
});
