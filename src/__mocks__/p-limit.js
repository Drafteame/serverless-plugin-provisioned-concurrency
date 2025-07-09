// Mock implementation of p-limit
module.exports = function pLimit(concurrency) {
  return function limit(fn) {
    return fn();
  };
};