import { EmptyBufferError } from 'helpers/Error';
import type Input from 'types/Input';
import JsonValue from 'types/JsonValue';
import zlib from 'zlib';

/**
 * The compression level to use when compressing the JSON.
 *
 * @see https://nodejs.org/api/zlib.html#zlib_class_brotlioptions
 */
const DEFAULT_BROTLI_OPTIONS = {
  [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
  [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
};

/**
 * An optimized JSON object that has been serialized and compressed.
 *
 * ```ts
 * import CompreSJON from 'compresjon';
 *
 * const json = new CompreSJON({ hello: 'world' });
 * ```
 */
export default class CompreSJON<T extends Input> {
  public buffer: Buffer;

  constructor(input: T) {
    this.buffer = this._serialize(input);
  }

  private _serialize(input: Input): Buffer {
    const buffer = Buffer.from(JSON.stringify(input));

    return zlib.brotliCompressSync(buffer, {
      params: {
        ...DEFAULT_BROTLI_OPTIONS,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
      },
    });
  }

  private _deserialize(): T {
    const decompressed = zlib.brotliDecompressSync(this.buffer);

    return JSON.parse(decompressed.toString());
  }

  private _destructiveDeserialize(): T {
    const data = zlib.brotliDecompressSync(this.buffer);
    this.buffer = Buffer.alloc(0);

    return JSON.parse(data.toString());
  }

  /**
   * Replaces the existing data within the buffer with the new data.
   *
   * _Note that this is an asynchronous operation, so if you need to use the
   * updated data immediately, you should `await` the `Promise`.
   * If you don't care about the updated data (eg. caching for the long run),
   * you can ignore the `Promise`._
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * await json.update({ hello: 'universe' });
   * console.log(await json.get('hello')); // 'universe'
   * ```
   */
  public update(input: T extends Array<infer U> ? Array<U> : JsonValue) {
    this.buffer = this._serialize(input);
  }

  /**
   * Converts a JavaScript Object Notation (JSON) string into a CompreSJON.
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * console.log(CompreSJON.stringify(json)); // '{"hello":"world"}'
   * ```
   */
  public static stringify<T extends Input>(json: CompreSJON<T>): string {
    const data = json._deserialize();

    return JSON.stringify(data);
  }

  /**
   * Converts a JavaScript Object Notation (JSON) string into a CompreSJON.
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * const data = CompreSJON.parse(json);
   * console.log(data); // { hello: 'world' }
   * ```
   */
  public static parse<T extends Input>(json: CompreSJON<T>) {
    if (json.buffer.length === 0) {
      throw new EmptyBufferError();
    }

    return json._deserialize();
  }

  /**
   * Similar to `CompreSJON.parse`, but empties the internal buffer in the
   * process. This is useful if you want to avoid having two copies of the data
   * in memory.
   *
   * ```ts
   * const json = new CompreSJON({ hello: 'world' });
   * const data = CompreSJON.dump(json);
   * console.log(data); // { hello: 'world' }
   * console.log(json.buffer.length); // 0
   * ```
   */
  public static dump<T extends Input>(json: CompreSJON<T>) {
    if (json.buffer.length === 0) {
      throw new EmptyBufferError();
    }

    return json._destructiveDeserialize();
  }
}
