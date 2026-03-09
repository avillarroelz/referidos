module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup.js'],
  coveragePathIgnorePatterns: ['/node_modules/', '/tests/'],
  testTimeout: 15000,
  verbose: true,
};
