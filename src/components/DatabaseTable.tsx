import { useState } from 'react';
import { Pagination } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { ResourceLink } from '@openshift-console/dynamic-plugin-sdk';
import { useTranslation } from 'react-i18next';
import type { DatabaseRow } from '../contract/rows';
import type { StudioLocator } from '../hooks/useStudioLocator';
import { OpenInStudio } from './OpenInStudio';

/**
 * Rows per page. Only the rows of the current page mount OpenInStudio, so one page view sends at most this many
 * access reviews however many database users a resource lists.
 */
const DEFAULT_PER_PAGE = 50;
const PER_PAGE_OPTIONS = [20, 50, 100].map((value) => ({ title: String(value), value }));

/** A React key per row: rows that share a connection id (marked duplicate_id) get a counter after the first. */
function rowKeys(rows: readonly DatabaseRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const count = (seen.get(row.connectionId) ?? 0) + 1;
    seen.set(row.connectionId, count);
    return count === 1 ? row.connectionId : `${row.connectionId}~${count}`;
  });
}

/** The database rows, a page at a time, each with its LibreDB Studio open control or the reason it does not open. */
export function DatabaseTable({
  rows,
  locator,
}: {
  rows: readonly DatabaseRow[];
  locator: StudioLocator;
}) {
  const { t } = useTranslation('plugin__libredb-studio');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / perPage)));
  const start = (current - 1) * perPage;
  const keys = rowKeys(rows);
  const columns = {
    name: t('Name'),
    namespace: t('Namespace'),
    engine: t('Engine'),
    user: t('Database user'),
    status: t('Status'),
    studio: t('LibreDB Studio'),
  };

  return (
    <>
      <Pagination
        itemCount={rows.length}
        page={current}
        perPage={perPage}
        perPageOptions={PER_PAGE_OPTIONS}
        onSetPage={(_event, value) => setPage(value)}
        onPerPageSelect={(_event, value) => {
          setPerPage(value);
          setPage(1);
        }}
      />
      <Table aria-label={t('Databases')} variant="compact">
        <Thead>
          <Tr>
            <Th>{columns.name}</Th>
            <Th>{columns.namespace}</Th>
            <Th>{columns.engine}</Th>
            <Th>{columns.user}</Th>
            <Th>{columns.status}</Th>
            <Th>{columns.studio}</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.slice(start, start + perPage).map((row, index) => (
            <Tr key={keys[start + index]} data-test={`libredb-row-${row.connectionId}`}>
              <Td dataLabel={columns.name}>
                <ResourceLink
                  groupVersionKind={{
                    group: row.kind.group,
                    version: row.kind.version,
                    kind: row.kind.kind,
                  }}
                  name={row.name}
                  namespace={row.namespace}
                />
              </Td>
              <Td dataLabel={columns.namespace}>{row.namespace}</Td>
              <Td dataLabel={columns.engine}>{row.kind.label}</Td>
              <Td dataLabel={columns.user}>{row.user ?? ''}</Td>
              <Td dataLabel={columns.status}>{row.phase ?? ''}</Td>
              <Td dataLabel={columns.studio}>
                <OpenInStudio row={row} locator={locator} />
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </>
  );
}
