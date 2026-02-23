module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'shared/**/*.js',
    'background/**/*.js',
    'popup/**/*.js',
    'options/**/*.js',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
  ],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
};
