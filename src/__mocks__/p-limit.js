// Mock implementation of p-limit
export default function pLimit(_concurrency) {
  return function limit(fn) {
    return fn();
  };
}
