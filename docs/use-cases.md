# Use Cases

CompreSJON is useful when JSON is large, expensive to rebuild, and idle more often than it is read.

It is not a replacement for HTTP compression or a generic binary compression layer. For hot request paths and public API responses, prefer standard `Content-Encoding: br` or `gzip`.

## Long-Running Worker Caches

Workers often keep large in-process caches around between jobs. If that cache is only needed occasionally, CompreSJON can keep the idle copy small and inflate it only when work resumes.

```ts
let cache: ReturnType<typeof buildLargeCache> | undefined = buildLargeCache();
const coldCache = new CompreSJON(cache);

cache = undefined;

// Later, when the worker needs it again:
cache = coldCache.take();
```

This shines when rebuilding the cache is expensive, but keeping it fully inflated all day wastes memory.

## Precomputed JSON Artifacts

Some systems periodically build large JSON snapshots such as market overviews, reports, search indexes, catalog exports, or dashboard payloads. Those artifacts can be compressed once during refresh and stored as binary data in Redis or another storage layer.

```ts
const overview = await buildMarketOverview();
const coldOverview = new CompreSJON(overview);

await redis.set("market:overview", coldOverview.toBuffer());
```

Readers can restore the value when they need the JSON:

```ts
const bytes = await redis.getBuffer("market:overview");
const overview = CompreSJON.fromBuffer(bytes).read();
```

This trades CPU during refresh and reads for lower Redis memory usage while the artifact is idle.

## Batch Job Checkpoints

Long-running jobs sometimes need to keep enough JSON state around to resume after a retry, deploy, or worker restart. If that state is only read when the job resumes, it can be stored compressed between phases.

```ts
const checkpoint = new CompreSJON({
  jobId,
  completedIds,
  pendingIds,
  intermediateResults,
});

await redis.set(`job:${jobId}:checkpoint`, checkpoint.toBuffer());
```

Avoid this for hot session state, active chat history, or anything that changes on every small request. Constantly decoding and encoding would usually cost more than it saves.
