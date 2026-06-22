import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const esm = await import("compresjon");
const cjs = require("compresjon");

smoke("ESM", esm.default, esm.CompressionLevel);
smoke("CJS", cjs.default, cjs.CompressionLevel);

if (typeof cjs !== "object" || typeof cjs.default !== "function") {
  throw new TypeError("CJS require must return a namespace with a default constructor.");
}

function smoke(format, CompreSJON, CompressionLevel) {
  if (typeof CompreSJON !== "function") {
    throw new TypeError(`${format} default export must be a constructor.`);
  }

  if (CompressionLevel?.Fast !== 1) {
    throw new TypeError(`${format} named exports are not available.`);
  }

  const cache = new CompreSJON({ hello: "world" }, { compressionLevel: CompressionLevel.Fast });
  const fromBuffer = CompreSJON.fromBuffer(cache.toBuffer());
  const fromEnvelope = CompreSJON.fromEnvelope(cache.toEnvelope());
  const fromJsonString = CompreSJON.fromJSON(JSON.parse(JSON.stringify(cache)));

  assertEqual(fromBuffer.read().hello, "world", `${format} buffer round-trip failed.`);
  assertEqual(fromEnvelope.read().hello, "world", `${format} envelope round-trip failed.`);
  assertEqual(fromJsonString.read().hello, "world", `${format} JSON round-trip failed.`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message);
  }
}
