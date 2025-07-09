// Mock implementation of p-limit
module.exports = function pLimit(_concurrency) {
  return function limit(fn) {
    return fn();
  };
};
