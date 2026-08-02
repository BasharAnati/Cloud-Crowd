"use strict";

const { Buffer } = require("node:buffer");

function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

Object.freeze(utf8Bytes);

module.exports = Object.freeze({ utf8Bytes });
