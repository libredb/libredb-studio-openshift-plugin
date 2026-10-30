import * as fs from 'fs';
import * as path from 'path';
import { parseStudioHref, studioLink } from './studio-link';

const golden = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../tests/unit/fixtures/kubernetes-discovery-golden.json'),
    'utf-8',
  ),
) as { cases: { connectionId: string; toURL: string; link: string }[] };

describe('parseStudioHref', () => {
  it.each([
    ['https://studio.example.com', 'https://studio.example.com'],
    ['https://studio.example.com/', 'https://studio.example.com'],
    ['https://tools.example.com/studio', 'https://tools.example.com/studio'],
    ['https://tools.example.com/studio/', 'https://tools.example.com/studio'],
    ['https://tools.example.com/studio//', 'https://tools.example.com/studio'],
    ['https://studio.example.com:8443/', 'https://studio.example.com:8443'],
  ])('reads %s as the base %s', (href, base) => {
    expect(parseStudioHref(href)).toBe(base);
  });

  it.each([
    'http://studio.example.com',
    'javascript:alert(1)',
    'https://user:pw@studio.example.com',
    'https://user@studio.example.com',
    'https://studio.example.com/?a=1',
    'https://studio.example.com/#x',
    '',
    'not a url',
    '/relative/path',
    undefined,
    null,
    42,
    { href: 'https://studio.example.com' },
  ])('refuses %j', (href) => {
    expect(parseStudioHref(href)).toBeNull();
  });
});

describe('studioLink', () => {
  it.each(golden.cases.map((c) => [c.toURL, c.connectionId, c.link]))(
    'builds the golden link from %s and %s',
    (toURL, id, link) => {
      const base = parseStudioHref(toURL);
      expect(base).not.toBeNull();
      expect(studioLink(base as string, id)).toBe(link);
    },
  );

  it('carries only the connection parameter, holding seed:<id>', () => {
    let state = 7;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2 ** 31;
      return state / 2 ** 31;
    };
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-';
    for (let i = 0; i < 100; i += 1) {
      const length = 1 + Math.floor(random() * 64);
      let id = '';
      while (id.length < length) {
        id += alphabet[Math.floor(random() * alphabet.length)];
      }
      const url = new URL(studioLink('https://tools.example.com/studio', id));
      expect([...url.searchParams.keys()]).toEqual(['connection']);
      expect(url.searchParams.get('connection')).toBe(`seed:${id}`);
      expect(url.pathname).toBe('/studio/');
      expect(url.hash).toBe('');
    }
  });

  it("refuses an id outside Studio's rule", () => {
    expect(() => studioLink('https://studio.example.com', 'Not/An&Id')).toThrow(
      'not a LibreDB Studio connection id',
    );
    expect(() => studioLink('https://studio.example.com', '')).toThrow();
  });
});
