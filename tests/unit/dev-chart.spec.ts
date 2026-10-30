import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parse, parseAllDocuments } from 'yaml';

const ROOT = path.resolve(__dirname, '../..');
const CHART = path.join(ROOT, 'charts/openshift-console-plugin');

// CI installs helm before the unit tests and sets CI, so a missing helm there fails instead of skipping.
const helmFound = spawnSync('helm', ['version', '--short'], { encoding: 'utf-8' }).status === 0;
if (!helmFound && process.env.CI) {
  throw new Error('helm is not on PATH, and CI must render the development chart');
}
if (!helmFound) {
  process.stderr.write(
    'dev-chart.spec.ts: helm is not on PATH, so the chart render cases are skipped\n',
  );
}
const describeWithHelm = helmFound ? describe : describe.skip;

interface Manifest {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string; annotations?: Record<string, string> };
  spec?: Record<string, unknown>;
  automountServiceAccountToken?: boolean;
}
interface Container {
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  securityContext?: Record<string, unknown>;
  volumeMounts: { name: string; mountPath: string; readOnly?: boolean }[];
}
interface PodSpec {
  serviceAccountName?: string;
  automountServiceAccountToken?: boolean;
  securityContext?: Record<string, unknown>;
  containers: Container[];
  volumes: {
    name: string;
    secret?: { secretName: string };
    emptyDir?: object;
    configMap?: object;
  }[];
}

function helm(...args: string[]) {
  return spawnSync('helm', args, { encoding: 'utf-8' });
}

function templateChart(...sets: string[]): Manifest[] {
  const result = helm(
    'template',
    'lab',
    CHART,
    '--namespace',
    'os-lab-plugin',
    ...sets.flatMap((set) => ['--set', set]),
  );
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return parseAllDocuments(result.stdout)
    .map((document) => document.toJSON() as Manifest | null)
    .filter((manifest): manifest is Manifest => manifest !== null);
}

describeWithHelm('the development chart', () => {
  // Rendered in beforeAll, because a skipped describe still runs its body.
  let manifests: Manifest[] = [];
  beforeAll(() => {
    manifests = templateChart('plugin.image=img');
  });
  const only = (kind: string) => {
    const found = manifests.filter((manifest) => manifest.kind === kind);
    expect(found).toHaveLength(1);
    return found[0];
  };
  const pod = () =>
    (only('Deployment').spec as { template: { spec: PodSpec } }).template.spec as PodSpec;

  it('renders the server and its ConsolePlugin, and no Job, role, binding or ConfigMap', () => {
    expect(manifests.map((manifest) => manifest.kind).sort()).toEqual([
      'ConsolePlugin',
      'Deployment',
      'Service',
      'ServiceAccount',
    ]);
  });

  it('names everything libredb-studio by default', () => {
    for (const manifest of manifests) {
      expect(manifest.metadata.name).toBe('libredb-studio');
    }
  });

  it('asks the service CA for the serving certificate with the beta annotation', () => {
    expect(only('Service').metadata.annotations).toEqual({
      'service.beta.openshift.io/serving-cert-secret-name': 'libredb-studio-cert',
    });
  });

  it('runs the pod as its own ServiceAccount with no token mounted', () => {
    const account = only('ServiceAccount');
    expect(account.automountServiceAccountToken).toBe(false);
    expect(pod().serviceAccountName).toBe(account.metadata.name);
    expect(pod().serviceAccountName).not.toBe('default');
    expect(pod().automountServiceAccountToken).toBe(false);
  });

  it('runs the image with a read-only root, no privilege and no changed command', () => {
    const [container] = pod().containers;
    expect(pod().containers).toHaveLength(1);
    expect(container.image).toBe('img');
    expect(container).not.toHaveProperty('command');
    expect(container).not.toHaveProperty('args');
    expect(container.securityContext).toEqual({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
      readOnlyRootFilesystem: true,
    });
    expect(pod().securityContext).toEqual({
      runAsNonRoot: true,
      seccompProfile: { type: 'RuntimeDefault' },
    });
  });

  it('mounts the certificate read-only and an empty /tmp, and nothing over the baked nginx configuration', () => {
    const [container] = pod().containers;
    const mounts = Object.fromEntries(
      container.volumeMounts.map((mount) => [mount.mountPath, mount]),
    );
    expect(Object.keys(mounts).sort()).toEqual(['/tmp', '/var/cert']);
    expect(mounts['/var/cert'].readOnly).toBe(true);
    const volumes = Object.fromEntries(pod().volumes.map((volume) => [volume.name, volume]));
    expect(volumes[mounts['/var/cert'].name].secret?.secretName).toBe('libredb-studio-cert');
    expect(volumes[mounts['/tmp'].name].emptyDir).toEqual({});
    for (const volume of pod().volumes) {
      expect(volume).not.toHaveProperty('configMap');
    }
  });

  it('declares the ConsolePlugin with preloaded locales and no proxy or content security policy', () => {
    const plugin = only('ConsolePlugin');
    expect(plugin.apiVersion).toBe('console.openshift.io/v1');
    expect(plugin.spec).toEqual({
      displayName: 'LibreDB Studio',
      i18n: { loadType: 'Preload' },
      backend: {
        type: 'Service',
        service: { name: 'libredb-studio', namespace: 'os-lab-plugin', port: 9443, basePath: '/' },
      },
    });
  });

  it('refuses to render without an image, naming the value', () => {
    const result = helm('template', 'lab', CHART);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('plugin.image');
  });

  it('passes helm lint --strict', () => {
    const result = helm('lint', CHART, '--strict', '--set', 'plugin.image=img');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('the development chart files', () => {
  it('opens its README with the development and lab only warning', () => {
    const readme = fs.readFileSync(path.join(CHART, 'README.md'), 'utf-8');
    const firstParagraph = readme
      .split(/\n\s*\n/)
      .find((block) => !block.startsWith('#'))
      ?.replace(/\n/g, ' ');
    expect(firstParagraph).toBe(
      "For development and the lab only: install it only into a namespace only cluster admins write, because the server receives every console user's token; clusters install the plugin through LibreDB Studio's chart or operator.",
    );
  });

  it('offers no value for a console patch Job or an nginx configuration', () => {
    const values = parse(fs.readFileSync(path.join(CHART, 'values.yaml'), 'utf-8')) as {
      plugin: Record<string, unknown>;
    };
    expect(values.plugin).not.toHaveProperty('jobs');
    expect(values.plugin).not.toHaveProperty('patcherServiceAccount');
    expect(fs.readdirSync(path.join(CHART, 'templates')).sort()).toEqual([
      '_helpers.tpl',
      'consoleplugin.yaml',
      'deployment.yaml',
      'service.yaml',
      'serviceaccount.yaml',
    ]);
  });
});
