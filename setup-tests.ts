import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';
import { TextEncoder } from 'util';

configure({ testIdAttribute: 'data-test' });

// jsdom defines no TextEncoder on the window, and the plugin hashes UTF-8 bytes with the platform's encoder.
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
