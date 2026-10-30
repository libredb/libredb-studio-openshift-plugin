import * as fs from 'fs';
import * as path from 'path';
import { STUDIO_ID_RULE, connectionId, idKey } from './connection-id';

const golden = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../tests/unit/fixtures/kubernetes-discovery-golden.json'),
    'utf-8',
  ),
) as { cases: { connectionId: string }[] };

describe('idKey', () => {
  it('joins namespace and name', () => {
    expect(idKey('team-a', 'orders')).toBe('team-a/orders');
  });

  it('adds the user of a per-user row', () => {
    expect(idKey('team-b', 'analytics', 'analyst')).toBe('team-b/analytics/analyst');
  });
});

describe('connectionId', () => {
  it("builds Studio's id from the first 32 hex characters of the key's SHA-256", () => {
    expect(connectionId('cnpg', 'team-a/orders')).toBe('k8s-cnpg-75c1a60b898072af828207cff435c7e5');
    expect(connectionId('pgo', 'team-b/analytics/analyst')).toBe(
      'k8s-pgo-08ddbec864884242a67b9c2ec28ca05a',
    );
  });

  it("fits Studio's id rule", () => {
    expect(STUDIO_ID_RULE.test(connectionId('cnpg', 'team-a/orders'))).toBe(true);
    expect(STUDIO_ID_RULE.test(connectionId('mongo', `${'n'.repeat(253)}/x/y`))).toBe(true);
    for (const c of golden.cases) {
      expect(STUDIO_ID_RULE.test(c.connectionId)).toBe(true);
    }
  });
});

describe('STUDIO_ID_RULE', () => {
  it('is 1 to 64 lowercase letters, digits and hyphens', () => {
    expect(STUDIO_ID_RULE.source).toBe('^[a-z0-9-]{1,64}$');
    expect(STUDIO_ID_RULE.test('')).toBe(false);
    expect(STUDIO_ID_RULE.test('a'.repeat(65))).toBe(false);
    expect(STUDIO_ID_RULE.test('K8s-cnpg')).toBe(false);
  });
});
