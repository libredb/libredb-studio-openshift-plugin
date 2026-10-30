import { Button } from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';
import type { DatabaseRow } from '../contract/rows';
import { studioLink } from '../contract/studio-link';
import { useRowAccess } from '../hooks/useRowAccess';
import type { StudioLocator } from '../hooks/useStudioLocator';

/**
 * The open control of one row, or the reason it does not open. The control opens Studio's deep link for the row's
 * connection id in a new tab with no opener and no referrer; nothing else goes into the URL. The access hint only
 * hides the control: Studio checks access again when the database opens.
 */
export function OpenInStudio({ row, locator }: { row: DatabaseRow; locator: StudioLocator }) {
  const { t } = useTranslation('plugin__libredb-studio');
  const access = useRowAccess(row);
  const id = row.connectionId;
  const user = row.user ?? '';

  const reason = (text: string) => <span data-test={`libredb-reason-${id}`}>{text}</span>;

  if (locator.state !== 'ready') {
    return reason(t('LibreDB Studio is not set up in this cluster'));
  }
  switch (row.precheck) {
    case 'no_database':
      return reason(
        t('The user {{user}} lists no database, so LibreDB Studio does not list it.', { user }),
      );
    case 'other_namespace':
      return reason(
        t(
          'The user {{user}} keeps its connection string Secret in another namespace, which LibreDB Studio does not read.',
          { user },
        ),
      );
    case 'unsupported_name':
      return reason(
        t(
          "Set connectionStringSecretName on the user {{user}}: its Secret name needs MongoDB's name normalization, which LibreDB Studio does not compute.",
          { user },
        ),
      );
    case 'duplicate_id':
      return reason(
        t('Two database users share this connection id, so LibreDB Studio lists neither.'),
      );
  }
  switch (access) {
    case 'checking':
      return reason(t('Checking access'));
    case 'denied':
      return reason(
        t(
          'You cannot read the credential Secret {{secret}}, so LibreDB Studio does not open this database for you.',
          { secret: row.secretName },
        ),
      );
    case 'allowed':
      break;
    default:
      return reason(t('Your access could not be checked. Reload the page to try again.'));
  }

  const link = studioLink(locator.base, id);
  const target = { namespace: row.namespace, name: row.name };
  return (
    <Button
      variant="link"
      isInline
      data-test={`libredb-open-${id}`}
      aria-label={
        row.user === undefined
          ? t('Open {{namespace}}/{{name}} in LibreDB Studio', target)
          : t('Open {{namespace}}/{{name}} in LibreDB Studio as {{user}}', { ...target, user })
      }
      onClick={() => {
        window.open(link, '_blank', 'noopener,noreferrer');
      }}
    >
      {row.user === undefined
        ? t('Open in LibreDB Studio')
        : t('Open as {{user}} in LibreDB Studio', { user })}
    </Button>
  );
}
