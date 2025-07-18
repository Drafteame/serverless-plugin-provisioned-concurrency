/**
 * Represents an error which occurs when no version is found in a process, action, or dataset
 * where a version is expected or required.
 *
 * This class extends the built-in `Error` object, allowing for specialized error handling
 * related to versioning issues in applications.
 *
 * @extends {Error}
 */
class NoVersionFoundError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export = NoVersionFoundError;
