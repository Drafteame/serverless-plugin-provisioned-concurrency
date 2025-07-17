/**
 * Exception that a lambda doesn't have a specified version
 */
class NoVersionFoundError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export = NoVersionFoundError;
