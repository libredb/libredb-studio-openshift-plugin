import { Spinner } from '@patternfly/react-core';
import type { DetailsItemComponentProps } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import { kindForResource } from '../contract/kinds';
import { databaseRows, markDuplicateIds } from '../contract/rows';
import { useStudioLocator } from '../hooks/useStudioLocator';
import { OpenInStudio } from './OpenInStudio';

/** Lines one details item shows, so one details page sends at most 20 access reviews (ruling R-26). */
const MAX_LINES = 20;

const TEST_ID = 'libredb-details-item';

/**
 * The LibreDB Studio item on the details page of a supported database resource: one line per database row of the
 * resource, in the order its spec lists the users, each with the open control or the reason it does not open, and a
 * sentence after the first 20 lines naming how many rows there are. Nothing for a resource with no row.
 */
export default function DatabaseDetailsItem({ obj }: DetailsItemComponentProps) {
  const { t } = useTranslation('plugin__libredb-studio');
  const locator = useStudioLocator();
  const kind = kindForResource(obj.apiVersion, obj.kind);
  const rows = kind === undefined ? [] : markDuplicateIds(databaseRows(kind, obj));
  if (rows.length === 0) {
    return null;
  }
  let body;
  switch (locator.state) {
    case 'loading':
      body = <Spinner size="md" />;
      break;
    case 'ready':
      body = rows.slice(0, MAX_LINES).map((row, index) => (
        // Rows of one resource may share a connection id (marked duplicate_id), so the line's place is its key.
        <div key={index}>
          <OpenInStudio row={row} locator={locator} />
        </div>
      ));
      break;
    case 'missing':
      body = t('LibreDB Studio is not set up in this cluster');
      break;
    case 'ambiguous':
      body = t(
        'More than one console link named libredb-studio is listed, so this page opens nothing in LibreDB Studio.',
      );
      break;
    default:
      body = t('This page cannot read the console link that locates LibreDB Studio.');
  }
  return (
    <div data-test={TEST_ID}>
      {body}
      {locator.state === 'ready' && rows.length > MAX_LINES ? (
        <div>
          {t(
            'This resource has {{total}} database users; the first 20 are shown here and the Databases page lists all of them.',
            { total: rows.length },
          )}
        </div>
      ) : null}
    </div>
  );
}
