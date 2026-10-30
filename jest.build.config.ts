import type { Config } from 'jest';

/** The build-output specs: run by `yarn test:manifest` after `yarn build`, never by the main run. */
const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/build'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.[jt]sx?$': ['@swc/jest', { module: { type: 'commonjs', noInterop: true }, minify: false }],
  },
};

export default config;
