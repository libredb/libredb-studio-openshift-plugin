import * as fs from 'fs';
import * as path from 'path';

const locale = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../locales/en/plugin__libredb-studio.json'), 'utf-8'),
) as Record<string, string>;

/** The English sentences of the Databases page, as the plugin's copy rules word them. */
const DATABASES_PAGE_COPY = [
  'Databases',
  'LibreDB Studio',
  'Opens in LibreDB Studio at {{host}}.',
  'Only databases in the namespaces your administrator chose for discovery open; any other one opens as not found.',
  'LibreDB Studio is not set up in this cluster',
  'A cluster administrator installs LibreDB Studio with Kubernetes discovery and its console link; this page finds Studio through the console link named libredb-studio.',
  'This page cannot read the console link that locates LibreDB Studio.',
  'Open in LibreDB Studio',
  'Open as {{user}} in LibreDB Studio',
  'Open {{namespace}}/{{name}} in LibreDB Studio',
  'Open {{namespace}}/{{name}} in LibreDB Studio as {{user}}',
  'Checking access',
  'You cannot read the credential Secret {{secret}}, so LibreDB Studio does not open this database for you.',
  'Your access could not be checked. Reload the page to try again.',
  'The user {{user}} lists no database, so LibreDB Studio does not list it.',
  'The user {{user}} keeps its connection string Secret in another namespace, which LibreDB Studio does not read.',
  "Set connectionStringSecretName on the user {{user}}: its Secret name needs MongoDB's name normalization, which LibreDB Studio does not compute.",
  'Two database users share this connection id, so LibreDB Studio lists neither.',
  'You cannot list {{kind}} resources ({{resource}}) in all projects. Choose a project above.',
  'You cannot list {{kind}} resources ({{resource}}) in the project {{namespace}}.',
  'LibreDB Studio could not list {{kind}} resources.',
  'No supported database operator is installed in this cluster: CloudNativePG, EDB Postgres for Kubernetes, Crunchy PGO or MongoDB Community.',
  'No databases in {{scope}}.',
  'all projects',
  'Name',
  'Namespace',
  'Engine',
  'Database user',
  'Status',
];

/** The English sentence the details item adds below its first 20 lines. */
const DETAILS_ITEM_COPY = [
  'This resource has {{total}} database users; the first 20 are shown here and the Databases page lists all of them.',
];

describe('the English locale file', () => {
  it.each([...DATABASES_PAGE_COPY, ...DETAILS_ITEM_COPY])(
    'holds %j as its own English text',
    (key) => {
      expect(locale[key]).toBe(key);
    },
  );
});
