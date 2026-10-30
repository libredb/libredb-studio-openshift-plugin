import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  testRegex: '.*\\.spec\\.(ts|tsx)$',
  moduleNameMapper: {
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/__mocks__/fileMock.ts',
    '\\.css$': '<rootDir>/__mocks__/styleMock.ts',
  },
  transform: {
    '^.+\\.[jt]sx?$': [
      '@swc/jest',
      {
        module: {
          type: 'commonjs',
          noInterop: true,
        },
        minify: false,
      },
    ],
  },
  setupFilesAfterEnv: ['./setup-tests.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/integration-tests/', '<rootDir>/tests/build/'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.spec.{ts,tsx}', '!src/**/*.d.ts'],
  coverageThreshold: { global: { lines: 100 } },
};

export default config;
