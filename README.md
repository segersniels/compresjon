# CompreSJON

[![npm](https://img.shields.io/npm/v/compresjon)](https://www.npmjs.com/package/compresjon)

`compresjon` is a tiny utility for keeping large JSON-compatible values compressed while they are idle.

It is meant for long-running Node.js workers that occasionally need a large in-memory cache, but do not need that cache inflated all the time.

See [benchmarks](./docs/benchmarks.md) for the current size and lifecycle tradeoffs.

## Use Cases

CompreSJON is useful when JSON is large, expensive to rebuild, and idle more often than it is read. See [use cases](./docs/use-cases.md) for examples where that tradeoff tends to pay off.

## Install

```sh
npm install compresjon
```

CompreSJON is published as ESM and CommonJS:

```ts
import CompreSJON from "compresjon";
```

```js
const { default: CompreSJON } = require("compresjon");
```

## Usage

```ts
import CompreSJON from "compresjon";

let cache: ReturnType<typeof buildLargeCache> | undefined = buildLargeCache();
const coldCache = new CompreSJON(cache);

// Drop your own live reference when the cache is idle.
cache = undefined;

// Later, take() clears the compressed bytes before returning the live value.
cache = coldCache.take();
```

`read()` and its backwards-compatible alias `parse()` keep the compressed bytes around. Use them only when you intentionally want a non-destructive read.

```ts
const coldCache = new CompreSJON({ hello: "world" });

console.log(coldCache.read()); // { hello: 'world' }
console.log(coldCache.byteLength > 0); // true
```

CompreSJON stores JSON-serializable values. Values that JSON would drop, rewrite, or compute through accessors, such as `undefined`, functions, symbols, `BigInt`, `NaN`, `Infinity`, sparse arrays, symbol keys, non-enumerable properties, getters/setters, custom array properties, circular structures, and non-plain objects like `Map`, `Set`, or `Date`, are rejected.

## Stats

Use `stats` to inspect the current cold payload without inflating it.

```ts
const coldCache = new CompreSJON(largeCache);

console.log(coldCache.stats);
// {
//   compressedBytes: 1104586,
//   jsonBytes: 22787451,
//   ratio: 20.63,
//   savingsBytes: 21682865,
//   savingsPercent: 0.95,
//   compressionLevel: 5,
//   isEmpty: false,
// }
```

`jsonBytes`, `ratio`, `savingsBytes`, and `savingsPercent` are available when CompreSJON compressed the value itself or when the value was restored from a CompreSJON JSON envelope. Raw buffers do not carry that metadata.

## API At A Glance

- `read()` / `parse()` inflate without consuming the compressed bytes.
- `take()` / `dump()` inflate and clear the compressed bytes before returning the value.
- `process(callback)` inflates, lets you mutate synchronously, then recompresses.
- `processAsync(callback)` does the same for async work.
- `update(value)` / `updateAsync(value)` replace the compressed value.
- `dispose()` clears the stored payload.
- `toBuffer()` / `fromBuffer()` are for binary transport.
- `toBase64()` / `fromBase64()` are for string transport.
- `toEnvelope()` / `fromEnvelope()` are for JSON-safe transport with metadata.
- `toJSON()` / `fromJSON()` are kept as the original JSON envelope names.

## Process And Recompress

`process()` is the safest cache lifecycle for most workers: it clears the instance while you mutate the live value, then recompresses it. The previous payload is kept as a fallback so failed recompression can restore the cache.

```ts
const coldCache = new CompreSJON([{ id: 1, status: "idle" }]);

coldCache.process((items) => {
  items.push({ id: 2, status: "idle" });
});
```

`process()` only accepts synchronous callbacks. Use `processAsync()` for work that awaits.

Async compression is available when you do not want Brotli work on the main event-loop turn:

```ts
const coldCache = await CompreSJON.fromAsync(largeCache);

await coldCache.processAsync(async (items) => {
  await refresh(items);
});
```

## GC Control

CompreSJON drops its own references early, but it cannot force the runtime to collect memory unless your process exposes GC.

For memory-sensitive workers, start Node with `--expose-gc` and pass `gc: true`:

```sh
node --expose-gc worker.js
```

```ts
const coldCache = new CompreSJON(largeCache, { gc: true });

const liveCache = coldCache.take();
```

Manual GC is opt-in because it can pause your worker. CompreSJON never calls `globalThis.gc()` just because it exists; pass `gc: true` when you want CompreSJON to call it after memory-releasing operations.

If `globalThis.gc` is not available, `gc: true` is a no-op. Other runtimes can use the same option when they expose `globalThis.gc`, or pass a custom hook.

You can also pass a hook for custom scheduling or metrics:

```ts
const coldCache = new CompreSJON(largeCache, {
  gc: (phase) => {
    console.log(`released memory after ${phase}`);
  },
});
```

The hook runs after `take`, `update`, and `dispose`.

Hook errors are ignored so metrics or cleanup code cannot break cache reads and writes.

## Transport

Use `toBuffer()` for binary transport or `toEnvelope()` for a base64 JSON envelope.

```ts
const coldCache = new CompreSJON({ hello: "world" });
const bytes = coldCache.toBuffer();
const restored = CompreSJON.fromBuffer<{ hello: string }>(bytes);
const restoredFromBase64 = CompreSJON.fromBase64<{ hello: string }>(coldCache.toBase64());
const restoredFromEnvelope = CompreSJON.fromEnvelope<{ hello: string }>(coldCache.toEnvelope());
```

`toBuffer()` returns a defensive copy by default. Pass `{ copy: false }` only when the caller owns the returned buffer and will not mutate it.

`toJSON()` is kept for compatibility with the published API and returns the same JSON-safe envelope as `toEnvelope()`.

`fromBase64()` rejects invalid base64 immediately. `fromBuffer()` expects bytes produced by this version of CompreSJON; invalid Brotli or non-JSON bytes are rejected when read.

## Compression Levels

```ts
import CompreSJON, { CompressionLevel } from "compresjon";

const coldCache = new CompreSJON(largeCache, {
  compressionLevel: CompressionLevel.Balanced,
});
```

Brotli accepts levels `0` through `11`. Higher levels can be dramatically slower; `Balanced` is the default.
