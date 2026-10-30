import type { ReactElement } from 'react';
import { Alert, EmptyState, EmptyStateBody, PageSection, Spinner } from '@patternfly/react-core';
import { DocumentTitle, ListPageHeader, NamespaceBar } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import { useDatabaseRows, type KindListState } from '../hooks/useDatabaseRows';
import { useStudioLocator, type StudioLocator } from '../hooks/useStudioLocator';
import { DatabaseTable } from './DatabaseTable';
import { NotAvailable } from './NotAvailable';

const HEADER_TEST_ID = 'libredb-studio-header';

/** Where LibreDB Studio is, or why the page cannot open anything in it. */
function StudioHeader({ locator }: { locator: StudioLocator }) {
  const { t } = useTranslation('plugin__libredb-studio');
  switch (locator.state) {
    case 'loading':
      return null;
    case 'ready':
      return (
        <Alert
          isInline
          variant="info"
          title={t('Opens in LibreDB Studio at {{host}}.', { host: locator.host })}
          data-test={HEADER_TEST_ID}
        >
          <p>
            {t(
              'Only databases in the namespaces your administrator chose for discovery open; any other one opens as not found.',
            )}
          </p>
        </Alert>
      );
    case 'missing':
      return (
        <NotAvailable
          testId={HEADER_TEST_ID}
          title={t('LibreDB Studio is not set up in this cluster')}
          body={t(
            'A cluster administrator installs LibreDB Studio with Kubernetes discovery and its console link; this page finds Studio through the console link named libredb-studio.',
          )}
        />
      );
    case 'ambiguous':
      return (
        <NotAvailable
          testId={HEADER_TEST_ID}
          title={t(
            'More than one console link named libredb-studio is listed, so this page opens nothing in LibreDB Studio.',
          )}
        />
      );
    default:
      return (
        <NotAvailable
          testId={HEADER_TEST_ID}
          title={t('This page cannot read the console link that locates LibreDB Studio.')}
        />
      );
  }
}

/** Why a kind's resources are not listed: the list permission the user lacks and where, or a failed watch. */
function KindRefusal({ state, namespace }: { state: KindListState; namespace?: string }) {
  const { t } = useTranslation('plugin__libredb-studio');
  const kind = state.kind.label;
  const resource = `${state.kind.plural}.${state.kind.group}`;
  let title: string;
  if (state.error === 'failed') {
    title = t('LibreDB Studio could not list {{kind}} resources.', { kind });
  } else if (namespace === undefined) {
    title = t(
      'You cannot list {{kind}} resources ({{resource}}) in all projects. Choose a project above.',
      { kind, resource },
    );
  } else {
    title = t('You cannot list {{kind}} resources ({{resource}}) in the project {{namespace}}.', {
      kind,
      resource,
      namespace,
    });
  }
  return <NotAvailable testId={`libredb-not-available-${state.kind.slug}`} title={title} />;
}

/**
 * The Databases page: the supported database resources the user can list in the project chosen in the console's
 * project selector, or in all projects, each with a control that opens it in LibreDB Studio.
 */
export default function DatabasesPage() {
  const { t } = useTranslation('plugin__libredb-studio');
  const locator = useStudioLocator();
  const { namespace, kinds, rows, anyKindInstalled, loaded } = useDatabaseRows();
  const refused = kinds.filter((state) => state.error !== undefined);
  const scope = namespace ?? t('all projects');

  let body: ReactElement | null;
  if (!loaded || locator.state === 'loading') {
    body = <Spinner size="lg" />;
  } else if (!anyKindInstalled) {
    body = (
      <EmptyState variant="sm">
        <EmptyStateBody>
          {t(
            'No supported database operator is installed in this cluster: CloudNativePG, EDB Postgres for Kubernetes, Crunchy PGO or MongoDB Community.',
          )}
        </EmptyStateBody>
      </EmptyState>
    );
  } else if (rows.length > 0) {
    body = <DatabaseTable key={namespace ?? ''} rows={rows} locator={locator} />;
  } else if (refused.length === 0) {
    body = (
      <EmptyState variant="sm">
        <EmptyStateBody>{t('No databases in {{scope}}.', { scope })}</EmptyStateBody>
      </EmptyState>
    );
  } else {
    body = null;
  }

  return (
    <>
      <DocumentTitle>{t('Databases')}</DocumentTitle>
      <NamespaceBar />
      <ListPageHeader title={t('Databases')} />
      <PageSection data-test="libredb-databases-page">
        <StudioHeader locator={locator} />
        {refused.map((state) => (
          <KindRefusal key={state.kind.slug} state={state} namespace={namespace} />
        ))}
        {body}
      </PageSection>
    </>
  );
}
