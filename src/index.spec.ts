import CompreSJON, {
  CompressionLevel,
  EmptyBufferError,
  InvalidPayloadError,
  type CompreSJONJSON,
} from "./index";
import { describe, expect, it } from "vitest";

interface CacheEntry {
  id: number;
  status: "idle" | "busy";
  payload: string;
}

describe("CompreSJON", () => {
  it("keeps JSON data compressed until it is read", () => {
    const source = makeCache(1_000);
    const jsonSize = Buffer.byteLength(JSON.stringify(source));
    const cache = new CompreSJON(source);

    expect(cache.byteLength).toBeLessThan(jsonSize);
    expect(cache.stats).toMatchObject({
      compressedBytes: cache.byteLength,
      compressionLevel: CompressionLevel.Balanced,
      isEmpty: false,
      jsonBytes: jsonSize,
      savingsBytes: jsonSize - cache.byteLength,
    });
    expect(cache.stats.ratio).toBeGreaterThan(1);
    expect(cache.stats.savingsPercent).toBeGreaterThan(0);
    expect(cache.read()).toEqual(source);
    expect(cache.byteLength).toBeGreaterThan(0);
  });

  it("takes data destructively to avoid retaining compressed bytes", () => {
    const cache = new CompreSJON(makeCache(50));
    const value = cache.take();

    expect(value).toHaveLength(50);
    expect(cache.byteLength).toBe(0);
    expect(cache.isEmpty).toBe(true);
    expect(cache.stats).toEqual({
      compressedBytes: 0,
      compressionLevel: CompressionLevel.Balanced,
      isEmpty: true,
      jsonBytes: undefined,
      ratio: undefined,
      savingsBytes: undefined,
      savingsPercent: undefined,
    });
    expect(() => cache.read()).toThrow(EmptyBufferError);
  });

  it("uses dump as a backwards-compatible destructive alias", () => {
    const cache = new CompreSJON({ hello: "world" });

    expect(cache.dump()).toEqual({ hello: "world" });
    expect(cache.isEmpty).toBe(true);
  });

  it("processes mutable data without retaining compressed bytes during work", () => {
    const cache = new CompreSJON<CacheEntry[]>(makeCache(2));

    const count = cache.process((entries) => {
      expect(cache.isEmpty).toBe(true);
      entries.push({ id: 3, status: "idle", payload: "new" });

      return entries.length;
    });

    expect(count).toBe(3);
    expect(cache.read()).toHaveLength(3);
  });

  it("restores compressed data when process throws", () => {
    const cache = new CompreSJON({ attempts: 1 });

    expect(() => {
      cache.process((value) => {
        value.attempts += 1;

        throw new Error("boom");
      });
    }).toThrow("boom");

    expect(cache.read()).toEqual({ attempts: 2 });
  });

  it("updates the compressed value", () => {
    const cache = new CompreSJON({ hello: "world" });

    cache.update({ hello: "universe" });

    expect(cache.read()).toEqual({ hello: "universe" });
  });

  it("round-trips through a defensive buffer copy", () => {
    const cache = new CompreSJON({ hello: "world" });
    const buffer = cache.toBuffer();

    buffer.fill(0);

    expect(cache.read()).toEqual({ hello: "world" });
  });

  it("can be restored from compressed bytes", () => {
    const cache = new CompreSJON({ hello: "world" });
    const restored = CompreSJON.fromBuffer<{ hello: string }>(cache.toBuffer());

    expect(restored.read()).toEqual({ hello: "world" });
    expect(restored.stats.jsonBytes).toBeUndefined();
    expect(restored.stats.ratio).toBeUndefined();
  });

  it("keeps a read-only buffer compatibility getter", () => {
    const cache = new CompreSJON({ hello: "world" });
    const buffer = cache.buffer;

    buffer.fill(0);

    expect(cache.read()).toEqual({ hello: "world" });
  });

  it("serializes to a transport-safe JSON envelope", () => {
    const cache = new CompreSJON({ hello: "world" });
    const payload = cache.toJSON();
    const restored = CompreSJON.fromJSON<{ hello: string }>(payload);

    expect(JSON.parse(JSON.stringify(cache))).toEqual(payload);
    expect(restored.read()).toEqual({ hello: "world" });
    expect(restored.stats).toEqual(cache.stats);
  });

  it("rejects invalid JSON envelopes", () => {
    const payload = { format: "nope", data: "abc" } as unknown as CompreSJONJSON;

    expect(() => CompreSJON.fromJSON(payload)).toThrow(InvalidPayloadError);
  });

  it("supports async compression and destructive async reads", async () => {
    const cache = await CompreSJON.fromAsync(makeCache(25), {
      compressionLevel: CompressionLevel.Fast,
    });

    expect(await cache.takeAsync()).toHaveLength(25);
    expect(cache.isEmpty).toBe(true);
  });

  it("supports async processing", async () => {
    const cache = new CompreSJON<CacheEntry[]>(makeCache(1));

    await cache.processAsync(async (entries) => {
      expect(cache.isEmpty).toBe(true);
      entries[0].status = "busy";
    });

    expect(cache.read()[0].status).toBe("busy");
  });

  it("offers an explicit GC hook for memory-sensitive workers", () => {
    const phases: string[] = [];
    const cache = new CompreSJON({ hello: "world" }, { gc: (phase) => phases.push(phase) });

    cache.take();
    cache.update({ hello: "again" });
    cache.dispose();

    expect(phases).toEqual(["take", "update", "dispose"]);
    expect(cache.isEmpty).toBe(true);
    expect(cache.stats.jsonBytes).toBeUndefined();
  });

  it("accepts Brotli level 0 and rejects invalid levels", () => {
    expect(() => new CompreSJON({ ok: true }, { compressionLevel: 0 })).not.toThrow();
    expect(CompressionLevel.Default).toBe(CompressionLevel.Balanced);
    expect(() => new CompreSJON({ ok: true }, { compressionLevel: 12 })).toThrow(RangeError);
  });

  it("keeps backwards-compatible parse and stringify helpers", () => {
    const cache = new CompreSJON(["hello", "world"]);

    expect(CompreSJON.parse(cache)).toEqual(["hello", "world"]);
    expect(CompreSJON.stringify(cache)).toBe('["hello","world"]');
  });
});

function makeCache(size: number): CacheEntry[] {
  return Array.from({ length: size }, (_, index) => ({
    id: index,
    status: index % 2 === 0 ? "idle" : "busy",
    payload: `repeatable payload ${index % 10}`,
  }));
}
