import {
  brotliCompress,
  brotliCompressSync,
  brotliDecompress,
  brotliDecompressSync,
  constants,
} from "node:zlib";
import { promisify } from "node:util";

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);
const FORMAT = "compresjon/brotli-json/v1";
const EMPTY_BUFFER = Buffer.alloc(0);

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type GarbageCollectionPhase = "take" | "update" | "dispose";
export type GarbageCollector = (phase: GarbageCollectionPhase) => void;

export enum CompressionLevel {
  Fast = 1,
  Balanced = 5,
  Dense = 8,
  Maximum = 11,
  Lowest = Fast,
  Default = Balanced,
  Highest = Maximum,
}

export interface CompreSJONOptions {
  /**
   * Brotli quality from 0 to 11. Higher values can be dramatically slower.
   */
  compressionLevel?: CompressionLevel | number;
  /**
   * Explicit GC hook for memory-sensitive workers.
   *
   * `true` calls `globalThis.gc()` when Node was started with `--expose-gc`.
   * A function can be used for custom scheduling, metrics, or tests.
   */
  gc?: boolean | GarbageCollector;
}

export interface BufferOptions {
  /**
   * Return a defensive copy of the compressed bytes.
   *
   * Disable this only when the caller owns the returned buffer and will not mutate it.
   */
  copy?: boolean;
}

export interface CompreSJONJSON {
  format: typeof FORMAT;
  data: string;
  compressionLevel?: number;
  jsonBytes?: number;
}

export interface CompreSJONStats {
  compressedBytes: number;
  compressionLevel: number;
  isEmpty: boolean;
  jsonBytes?: number;
  ratio?: number;
  savingsBytes?: number;
  savingsPercent?: number;
}

export class EmptyBufferError extends Error {
  constructor() {
    super("The compressed data has already been consumed. Call update() before reading it again.");
  }
}

export class InvalidPayloadError extends Error {
  constructor() {
    super("Expected a CompreSJON JSON payload.");
  }
}

/**
 * Cold storage for large JSON-compatible values.
 *
 * Keep application data in this compressed wrapper while it is idle, then use
 * `take()` or `process()` to avoid retaining compressed bytes while the live
 * JavaScript value is being worked on.
 */
export default class CompreSJON<T = JsonValue> {
  private compressed: Buffer = EMPTY_BUFFER;
  private jsonBytes?: number;
  private readonly compressionLevel: number;
  private readonly garbageCollector?: GarbageCollector;

  constructor(input: T | Uint8Array, options: CompreSJONOptions = {}) {
    this.compressionLevel = normalizeCompressionLevel(options.compressionLevel);
    this.garbageCollector = resolveGarbageCollector(options.gc);

    if (isByteLike(input)) {
      this.compressed = Buffer.from(input);

      return;
    }

    this.setPayload(encodeSync(input, this.compressionLevel));
  }

  public static from<T>(input: T, options?: CompreSJONOptions): CompreSJON<T> {
    return new CompreSJON(input, options);
  }

  public static async fromAsync<T>(
    input: T,
    options: CompreSJONOptions = {},
  ): Promise<CompreSJON<T>> {
    const instance = new CompreSJON<T>(Buffer.alloc(0), options);
    await instance.updateAsync(input);

    return instance;
  }

  public static fromBuffer<T>(input: Uint8Array, options?: CompreSJONOptions): CompreSJON<T> {
    return new CompreSJON<T>(input, options);
  }

  public static fromJSON<T>(payload: CompreSJONJSON, options?: CompreSJONOptions): CompreSJON<T> {
    if (payload.format !== FORMAT || typeof payload.data !== "string") {
      throw new InvalidPayloadError();
    }

    const instance = new CompreSJON<T>(Buffer.from(payload.data, "base64"), {
      ...options,
      compressionLevel: options?.compressionLevel ?? payload.compressionLevel,
    });

    instance.jsonBytes = payload.jsonBytes;

    return instance;
  }

  public get byteLength(): number {
    return this.compressed.length;
  }

  public get isEmpty(): boolean {
    return this.compressed.length === 0;
  }

  public get stats(): CompreSJONStats {
    const compressedBytes = this.compressed.length;
    const savingsBytes =
      this.jsonBytes === undefined || compressedBytes === 0
        ? undefined
        : this.jsonBytes - compressedBytes;
    const ratio =
      this.jsonBytes === undefined || compressedBytes === 0
        ? undefined
        : this.jsonBytes / compressedBytes;
    const savingsPercent =
      this.jsonBytes === undefined || savingsBytes === undefined
        ? undefined
        : savingsBytes / this.jsonBytes;

    return {
      compressedBytes,
      compressionLevel: this.compressionLevel,
      isEmpty: compressedBytes === 0,
      jsonBytes: this.jsonBytes,
      ratio,
      savingsBytes,
      savingsPercent,
    };
  }

  /**
   * @deprecated Use `toBuffer()` instead. This returns a defensive copy.
   */
  public get buffer(): Buffer {
    return this.compressed.length === 0 ? EMPTY_BUFFER : Buffer.from(this.compressed);
  }

  public update(input: T): void {
    this.setPayload(encodeSync(input, this.compressionLevel));
    this.collectGarbage("update");
  }

  public async updateAsync(input: T): Promise<void> {
    this.setPayload(await encodeAsync(input, this.compressionLevel));
    this.collectGarbage("update");
  }

  /**
   * Read without consuming the compressed bytes.
   *
   * Prefer `take()` or `process()` for idle-cache workflows where avoiding a
   * retained compressed copy matters.
   */
  public read(): T {
    return decodeSync(this.requireBuffer());
  }

  /**
   * Backwards-compatible alias for `read()`.
   *
   * Prefer `take()` or `process()` for memory-sensitive workflows.
   */
  public parse(): T {
    return this.read();
  }

  public async readAsync(): Promise<T> {
    return decodeAsync(this.requireBuffer());
  }

  /**
   * Consume the compressed bytes before returning the live JSON value.
   */
  public take(): T {
    let payload: EncodedPayload | undefined = this.releasePayload();

    try {
      const value = decodeSync<T>(payload.compressed);
      payload = undefined;
      this.collectGarbage("take");

      return value;
    } catch (error) {
      if (payload) {
        this.setPayload(payload);
      }

      throw error;
    }
  }

  /**
   * Backwards-compatible alias for `take()`.
   */
  public dump(): T {
    return this.take();
  }

  public async takeAsync(): Promise<T> {
    let payload: EncodedPayload | undefined = this.releasePayload();

    try {
      const value = await decodeAsync<T>(payload.compressed);
      payload = undefined;
      this.collectGarbage("take");

      return value;
    } catch (error) {
      if (payload) {
        this.setPayload(payload);
      }

      throw error;
    }
  }

  /**
   * Temporarily inflate the value, run work on it, then compress it again.
   *
   * During the callback this instance does not retain the compressed bytes.
   */
  public process<R>(callback: (value: T) => R): R {
    const value = this.take();

    try {
      const result = callback(value);
      this.update(value);

      return result;
    } catch (error) {
      this.update(value);

      throw error;
    }
  }

  public async processAsync<R>(callback: (value: T) => R | Promise<R>): Promise<R> {
    const value = await this.takeAsync();

    try {
      const result = await callback(value);
      await this.updateAsync(value);

      return result;
    } catch (error) {
      await this.updateAsync(value);

      throw error;
    }
  }

  public toBuffer(options: BufferOptions = {}): Buffer {
    const { copy = true } = options;
    const compressed = this.requireBuffer();

    return copy ? Buffer.from(compressed) : compressed;
  }

  public toBase64(): string {
    return this.requireBuffer().toString("base64");
  }

  public toJSON(): CompreSJONJSON {
    return {
      format: FORMAT,
      data: this.toBase64(),
      compressionLevel: this.compressionLevel,
      jsonBytes: this.jsonBytes,
    };
  }

  public toString(): string {
    return JSON.stringify(this.read());
  }

  public dispose(): void {
    this.compressed = EMPTY_BUFFER;
    this.jsonBytes = undefined;
    this.collectGarbage("dispose");
  }

  public static parse<T>(json: CompreSJON<T>): T {
    return json.parse();
  }

  public static dump<T>(json: CompreSJON<T>): T {
    return json.dump();
  }

  public static stringify<T>(json: CompreSJON<T>): string {
    return json.toString();
  }

  private requireBuffer(): Buffer {
    if (this.compressed.length === 0) {
      throw new EmptyBufferError();
    }

    return this.compressed;
  }

  private releasePayload(): EncodedPayload {
    const compressed = this.requireBuffer();
    this.compressed = EMPTY_BUFFER;
    const jsonBytes = this.jsonBytes;
    this.jsonBytes = undefined;

    return { compressed, jsonBytes };
  }

  private setPayload(payload: EncodedPayload): void {
    this.compressed = payload.compressed;
    this.jsonBytes = payload.jsonBytes;
  }

  private collectGarbage(phase: GarbageCollectionPhase): void {
    this.garbageCollector?.(phase);
  }
}

function isByteLike(input: unknown): input is Uint8Array {
  return input instanceof Uint8Array;
}

function normalizeCompressionLevel(level = CompressionLevel.Balanced): number {
  if (!Number.isInteger(level) || level < 0 || level > 11) {
    throw new RangeError("compressionLevel must be an integer from 0 to 11.");
  }

  return level;
}

function resolveGarbageCollector(gc: CompreSJONOptions["gc"]): GarbageCollector | undefined {
  if (typeof gc === "function") {
    return gc;
  }

  if (gc !== true) {
    return undefined;
  }

  return () => {
    const exposedGc = (globalThis as { gc?: () => void }).gc;

    if (exposedGc) {
      exposedGc();
    }
  };
}

function brotliOptions(compressionLevel: number, sizeHint: number) {
  return {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_QUALITY]: compressionLevel,
      [constants.BROTLI_PARAM_SIZE_HINT]: sizeHint,
    },
  };
}

interface EncodedPayload {
  compressed: Buffer;
  jsonBytes?: number;
}

function jsonToBuffer(input: unknown): Buffer {
  return Buffer.from(JSON.stringify(input), "utf8");
}

function bufferToJson<T>(input: Buffer): T {
  return JSON.parse(input.toString("utf8")) as T;
}

function encodeSync(input: unknown, compressionLevel: number): EncodedPayload {
  const json = jsonToBuffer(input);
  const compressed = brotliCompressSync(json, brotliOptions(compressionLevel, json.length));

  return { compressed, jsonBytes: json.length };
}

async function encodeAsync(input: unknown, compressionLevel: number): Promise<EncodedPayload> {
  const json = jsonToBuffer(input);
  const compressed = await compress(json, brotliOptions(compressionLevel, json.length));

  return { compressed, jsonBytes: json.length };
}

function decodeSync<T>(input: Buffer): T {
  return bufferToJson<T>(brotliDecompressSync(input));
}

async function decodeAsync<T>(input: Buffer): Promise<T> {
  return bufferToJson<T>(await decompress(input));
}
