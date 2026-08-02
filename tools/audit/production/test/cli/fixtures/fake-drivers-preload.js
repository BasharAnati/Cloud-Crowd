"use strict";

const Module = require("node:module");
const {
  FakeClient,
  google,
  safeEnvironment,
} = require("../../output/fixtures/genuine-output");

Object.assign(process.env, safeEnvironment());
const originalLoad = Module._load;
Module._load = function fakeExternalDrivers(request, parent, isMain) {
  if (request === "pg") return { Client: FakeClient };
  if (request === "googleapis") return { google: google.factory() };
  return originalLoad.call(this, request, parent, isMain);
};
process.once("exit", () => { Module._load = originalLoad; });
