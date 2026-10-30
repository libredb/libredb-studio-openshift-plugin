import type { Config } from 'jest';
import base from './jest.config';

/** The build-output specs: run by `yarn test:manifest` after `yarn build`, never by the main run. */
const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/build'],
  testRegex: '.*\\.spec\\.ts$',
  transform: base.transform,
};

export default config;
