export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!(p-limit|yocto-queue)/)'],
  moduleNameMapper: {
    '^p-limit$': '<rootDir>/src/__mocks__/p-limit.js',
  },
};
