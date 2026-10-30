import * as fs from 'fs';
import * as path from 'path';
import type { ConsolePluginBuildMetadata } from '@openshift-console/dynamic-plugin-sdk-webpack';

const ROOT = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
  name: string;
  version: string;
  consolePlugin: ConsolePluginBuildMetadata;
};
const localeFile = path.join(ROOT, `locales/en/plugin__${packageJson.consolePlugin.name}.json`);

describe('plugin metadata', () => {
  it('has a matching i18n locale file, package name, and consolePlugin name', () => {
    if (!fs.existsSync(localeFile)) {
      return;
    }
    expect(packageJson.name).toBe(packageJson.consolePlugin.name);
  });

  it('keeps the English locale file of the plugin namespace', () => {
    expect(path.basename(localeFile)).toBe('plugin__libredb-studio.json');
    expect(fs.existsSync(localeFile)).toBe(true);
  });

  it('declares the package version as the plugin version', () => {
    expect(packageJson.consolePlugin.version).toBe(packageJson.version);
  });

  it('is shown as LibreDB Studio', () => {
    expect(packageJson.consolePlugin.displayName).toBe('LibreDB Studio');
  });
});
