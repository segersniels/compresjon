export class EmptyBufferError extends Error {
  constructor() {
    super(
      'The internal buffer has been parsed already. Did you forget to update?',
    );
  }
}
