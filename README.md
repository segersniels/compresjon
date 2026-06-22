# CompreSJON

`compresjon` is a tiny utility for keeping large JSON-compatible values compressed while they are idle.

It is meant for long-running Node.js workers that occasionally need a large in-memory cache, but do not need that cache inflated all the time.

See [benchmarks](./docs/benchmarks.md) for the current size and lifecycle tradeoffs.

## Install

```sh
npm install compresjon
```

## Usage

```ts
import CompreSJON from "compresjon";

let cache = buildLargeCache();
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

## Process And Recompress

`process()` is the safest cache lifecycle for most workers: it destructively inflates, lets you mutate the live value, then recompresses it.

```ts
const coldCache = new CompreSJON([{ id: 1, status: "idle" }]);

coldCache.process((items) => {
  items.push({ id: 2, status: "idle" });
});
```

Async compression is available when you do not want Brotli work on the main event-loop turn:

```ts
const coldCache = await CompreSJON.fromAsync(largeCache);

await coldCache.processAsync(async (items) => {
  await refresh(items);
});
```

## GC Control

CompreSJON drops its own references early, but it cannot force V8 to collect memory unless your process exposes GC.

For memory-sensitive workers, start Node with `--expose-gc` and pass `gc: true`:

```sh
node --expose-gc worker.js
```

```ts
const coldCache = new CompreSJON(largeCache, { gc: true });

const liveCache = coldCache.take();
```

You can also pass a hook for custom scheduling or metrics:

```ts
const coldCache = new CompreSJON(largeCache, {
  gc: (phase) => {
    console.log(`released memory after ${phase}`);
  },
});
```

The hook runs after `take`, `update`, and `dispose`.

## Transport

Use `toBuffer()` for binary transport or `toJSON()` for a base64 JSON envelope.

```ts
const coldCache = new CompreSJON({ hello: "world" });
const bytes = coldCache.toBuffer();
const restored = CompreSJON.fromBuffer<{ hello: string }>(bytes);
```

`toBuffer()` returns a defensive copy by default. Pass `{ copy: false }` only when the caller owns the returned buffer and will not mutate it.

## Compression Levels

```ts
import CompreSJON, { CompressionLevel } from "compresjon";

const coldCache = new CompreSJON(largeCache, {
  compressionLevel: CompressionLevel.Balanced,
});
```

Brotli accepts levels `0` through `11`. Higher levels can be dramatically slower; `Balanced` is the default.
