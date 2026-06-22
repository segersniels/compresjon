import CompreSJON, {
  AsyncProcessCallbackError,
  CompressionLevel,
  EmptyBufferError,
  InvalidCompressedDataError,
  InvalidJsonValueError,
  InvalidPayloadError,
  type CompreSJONEnvelope,
  type JsonValue,
} from "./index";
import { inspect } from "node:util";
import { brotliCompressSync } from "node:zlib";
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

  it("processes mutable data while the instance is empty during work", () => {
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

  it("restores the previous payload when sync process cannot recompress", () => {
    const cache = new CompreSJON<Record<string, unknown>>({ value: "ok" });

    expect(() => {
      cache.process((value) => {
        value.self = value;
      });
    }).toThrow(InvalidJsonValueError);

    expect(cache.read()).toEqual({ value: "ok" });
  });

  it("keeps the original sync process error when error recovery cannot recompress", () => {
    const cache = new CompreSJON<Record<string, unknown>>({ value: "ok" });

    expect(() => {
      cache.process((value) => {
        value.self = value;

        throw new Error("boom");
      });
    }).toThrow("boom");

    expect(cache.read()).toEqual({ value: "ok" });
  });

  it("restores the previous payload when async process cannot recompress", async () => {
    const cache = new CompreSJON<Record<string, unknown>>({ value: "ok" });

    await expect(
      cache.processAsync(async (value) => {
        value.self = value;
      }),
    ).rejects.toThrow(InvalidJsonValueError);

    expect(cache.read()).toEqual({ value: "ok" });
  });

  it("keeps the original async process error when error recovery cannot recompress", async () => {
    const cache = new CompreSJON<Record<string, unknown>>({ value: "ok" });

    await expect(
      cache.processAsync(async (value) => {
        value.self = value;

        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(cache.read()).toEqual({ value: "ok" });
  });

  it("rejects async callbacks passed to sync process", () => {
    const cache = new CompreSJON({ attempts: 1 });

    expect(() => cache.process(() => Promise.resolve("later"))).toThrow(AsyncProcessCallbackError);
    expect(cache.read()).toEqual({ attempts: 1 });
  });

  it("observes rejected async callbacks passed to sync process", async () => {
    const cache = new CompreSJON({ attempts: 1 });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);

    process.on("unhandledRejection", onUnhandled);

    try {
      expect(() => cache.process(() => Promise.reject(new Error("later")))).toThrow(
        AsyncProcessCallbackError,
      );

      await waitForUnhandledRejectionTurn();

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
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

  it("can expose the internal buffer when copying is disabled", () => {
    const cache = new CompreSJON({ hello: "world" });
    const buffer = cache.toBuffer({ copy: false });

    buffer.fill(0);

    expect(() => cache.read()).toThrow(InvalidCompressedDataError);
  });

  it("can be restored from compressed bytes", () => {
    const cache = new CompreSJON({ hello: "world" });
    const restored = CompreSJON.fromBuffer<{ hello: string }>(cache.toBuffer());

    expect(restored.read()).toEqual({ hello: "world" });
    expect(restored.stats.jsonBytes).toBeUndefined();
    expect(restored.stats.ratio).toBeUndefined();
  });

  it("can be restored from a base64 string", () => {
    const cache = new CompreSJON({ hello: "world" });
    const restored = CompreSJON.fromBase64<{ hello: string }>(cache.toBase64());

    expect(restored.read()).toEqual({ hello: "world" });
  });

  it("rejects invalid compressed bytes without consuming them", () => {
    const bytes = Buffer.from("not brotli");
    const cache = CompreSJON.fromBuffer(bytes);

    expect(() => cache.take()).toThrow(InvalidCompressedDataError);
    expect(cache.byteLength).toBe(bytes.length);
  });

  it("preserves the underlying cause for invalid compressed bytes", () => {
    const cache = CompreSJON.fromBuffer(Buffer.from("not brotli"));
    const error = captureError(() => cache.read());

    expect(error).toBeInstanceOf(InvalidCompressedDataError);
    expect(error.name).toBe("InvalidCompressedDataError");
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("rejects invalid base64 transport data", () => {
    expect(() => CompreSJON.fromBase64("not base64")).toThrow(InvalidPayloadError);
    expect(() => CompreSJON.fromBase64("not base64")).toThrow(
      "Expected a valid CompreSJON transport payload.",
    );
  });

  it("rejects compressed bytes that do not contain JSON", async () => {
    const cache = CompreSJON.fromBuffer(brotliCompressSync(Buffer.from("not json")));

    expect(() => cache.read()).toThrow(InvalidCompressedDataError);
    await expect(cache.readAsync()).rejects.toThrow(InvalidCompressedDataError);
  });

  it("keeps a defensive buffer compatibility getter", () => {
    const cache = new CompreSJON({ hello: "world" });
    const buffer = cache.buffer;

    buffer.fill(0);

    expect(cache.read()).toEqual({ hello: "world" });
  });

  it("keeps the legacy writable buffer property", () => {
    const cache = new CompreSJON({ hello: "world" });
    const replacement = new CompreSJON({ hello: "again" });

    cache.buffer = replacement.toBuffer();

    expect(cache.parse()).toEqual({ hello: "again" });
    expect(cache.stats.jsonBytes).toBeUndefined();
  });

  it("keeps the published 1.0 method surface", () => {
    const cache = new CompreSJON(["hello", "world"]);

    expect(typeof cache.parse).toBe("function");
    expect(typeof cache.dump).toBe("function");
    expect(typeof cache.update).toBe("function");
    expect(typeof cache.process).toBe("function");
    expect(typeof cache.toString).toBe("function");
    expect(Buffer.isBuffer(cache.buffer)).toBe(true);
    expect(cache.toJSON()).toMatchObject({ format: "compresjon/brotli-json/v1" });
    expect(typeof CompreSJON.parse).toBe("function");
    expect(typeof CompreSJON.dump).toBe("function");
    expect(typeof CompreSJON.stringify).toBe("function");
  });

  it("keeps the legacy toJSON envelope round-trip", () => {
    const cache = new CompreSJON({ hello: "world" });
    const restored = CompreSJON.fromJSON<{ hello: string }>(cache.toJSON());

    expect(restored.parse()).toEqual({ hello: "world" });
  });

  it("prints stats without dumping compressed bytes", () => {
    const cache = new CompreSJON({ secret: "value" });
    const printed = inspect(cache);

    expect(Object.keys(cache)).toEqual([]);
    expect(printed).toContain("CompreSJON");
    expect(printed).toContain("compressedBytes");
    expect(printed).toContain("ratio");
    expect(printed).not.toContain("compressed:");
    expect(printed).not.toContain("secret");
  });

  it("serializes to a transport-safe JSON envelope", () => {
    const cache = new CompreSJON({ hello: "world" });
    const payload = cache.toEnvelope();
    const restored = CompreSJON.fromEnvelope<{ hello: string }>(payload);

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    expect(JSON.parse(JSON.stringify(cache))).toEqual(payload);
    expect(restored.read()).toEqual({ hello: "world" });
    expect(restored.stats).toEqual(cache.stats);
  });

  it("keeps fromJSON as a backwards-compatible envelope alias", () => {
    const cache = new CompreSJON({ hello: "world" });
    const restored = CompreSJON.fromJSON<{ hello: string }>(cache.toEnvelope());

    expect(restored.read()).toEqual({ hello: "world" });
  });

  it("rejects invalid JSON envelopes", () => {
    const payload = { format: "nope", data: "abc" } as unknown as CompreSJONEnvelope;

    expect(() => CompreSJON.fromJSON(payload)).toThrow(InvalidPayloadError);
  });

  it("rejects JSON envelopes with invalid base64 data", () => {
    const cache = new CompreSJON({ hello: "world" });
    const payload = cache.toEnvelope();

    expect(() => CompreSJON.fromJSON({ ...payload, data: "" })).toThrow(InvalidPayloadError);
    expect(() => CompreSJON.fromJSON({ ...payload, data: "not base64" })).toThrow(
      InvalidPayloadError,
    );
  });

  it("rejects invalid JSON envelope metadata", () => {
    const cache = new CompreSJON({ hello: "world" });
    const payload = cache.toEnvelope();

    expect(() => CompreSJON.fromJSON({ ...payload, compressionLevel: 12 })).toThrow(
      InvalidPayloadError,
    );
    expect(() => CompreSJON.fromJSON({ ...payload, jsonBytes: -1 })).toThrow(InvalidPayloadError);
  });

  it("rejects values that cannot be serialized as JSON", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => new CompreSJON(undefined as unknown as JsonValue)).toThrow(InvalidJsonValueError);
    expect(() => new CompreSJON((() => undefined) as unknown as JsonValue)).toThrow(
      InvalidJsonValueError,
    );
    expect(() => new CompreSJON(1n as unknown as JsonValue)).toThrow(InvalidJsonValueError);
    expect(() => new CompreSJON(circular as unknown as JsonValue)).toThrow(InvalidJsonValueError);
  });

  it("rejects values that JSON would serialize lossily", () => {
    const objectWithSymbolKey = { [Symbol("hidden")]: "value" };
    const objectWithHiddenProperty = {};
    Object.defineProperty(objectWithHiddenProperty, "hidden", {
      value: "value",
    });
    let getterCalls = 0;
    const objectWithGetter = {};
    Object.defineProperty(objectWithGetter, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;

        return "value";
      },
    });
    const sparseArray = [] as unknown[];
    sparseArray[1] = "hole";
    const arrayWithCustomProperty = ["value"] as unknown[] & { hidden?: string };
    arrayWithCustomProperty.hidden = "value";
    const arrayWithHiddenProperty = ["value"];
    Object.defineProperty(arrayWithHiddenProperty, "hidden", {
      value: "value",
    });
    const arrayWithGetter = ["value"];
    Object.defineProperty(arrayWithGetter, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;

        return "value";
      },
    });

    expect(() => new CompreSJON({ value: undefined } as unknown as JsonValue)).toThrow(
      InvalidJsonValueError,
    );
    expect(() => new CompreSJON([Number.NaN] as unknown as JsonValue)).toThrow(
      InvalidJsonValueError,
    );
    expect(
      () => new CompreSJON({ value: Number.POSITIVE_INFINITY } as unknown as JsonValue),
    ).toThrow(InvalidJsonValueError);
    expect(() => new CompreSJON(new Map([["hello", "world"]]) as unknown as JsonValue)).toThrow(
      InvalidJsonValueError,
    );
    expect(() => new CompreSJON(new Date() as unknown as JsonValue)).toThrow(InvalidJsonValueError);
    expect(() => new CompreSJON(sparseArray as unknown as JsonValue)).toThrow(
      InvalidJsonValueError,
    );
    expect(() => new CompreSJON(objectWithSymbolKey as unknown as JsonValue)).toThrow(
      InvalidJsonValueError,
    );
    expect(() => new CompreSJON(arrayWithCustomProperty as unknown as JsonValue)).toThrow(
      InvalidJsonValueError,
    );
    expect(() => new CompreSJON(objectWithHiddenProperty as unknown as JsonValue)).toThrow(
      InvalidJsonValueError,
    );
    expect(() => new CompreSJON(arrayWithHiddenProperty as unknown as JsonValue)).toThrow(
      InvalidJsonValueError,
    );
    expect(() => new CompreSJON(objectWithGetter as unknown as JsonValue)).toThrow(
      InvalidJsonValueError,
    );
    expect(() => new CompreSJON(arrayWithGetter as unknown as JsonValue)).toThrow(
      InvalidJsonValueError,
    );
    expect(getterCalls).toBe(0);
  });

  it("preserves the underlying cause for invalid JSON values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const error = captureError(() => new CompreSJON(circular as unknown as JsonValue));

    expect(error).toBeInstanceOf(InvalidJsonValueError);
    expect(error.name).toBe("InvalidJsonValueError");
    expect(error.cause).toBeInstanceOf(TypeError);
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

  it("keeps cache operations best-effort when a GC hook fails", () => {
    const cache = new CompreSJON(
      { hello: "world" },
      {
        gc: () => {
          throw new Error("metrics failed");
        },
      },
    );

    expect(cache.take()).toEqual({ hello: "world" });
    expect(cache.isEmpty).toBe(true);

    expect(() => cache.update({ hello: "again" })).not.toThrow();
    expect(cache.read()).toEqual({ hello: "again" });

    expect(() => cache.dispose()).not.toThrow();
    expect(cache.isEmpty).toBe(true);
  });

  it("uses exposed runtime GC only when available", () => {
    const runtime = globalThis as { gc?: () => void };
    const previousGc = runtime.gc;
    let calls = 0;

    try {
      runtime.gc = () => {
        calls += 1;
      };

      new CompreSJON({ hello: "world" }, { gc: true }).take();

      runtime.gc = undefined;

      expect(() => new CompreSJON({ hello: "again" }, { gc: true }).take()).not.toThrow();
      expect(calls).toBe(1);
    } finally {
      if (previousGc) {
        runtime.gc = previousGc;
      } else {
        Reflect.deleteProperty(runtime, "gc");
      }
    }
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

function captureError(callback: () => unknown): Error {
  try {
    callback();
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected callback to throw.");
}

function waitForUnhandledRejectionTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
