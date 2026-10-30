import { Alert } from '@patternfly/react-core';

/** An inline warning that says what the page cannot show and why; title and body render as text only. */
export function NotAvailable({
  testId,
  title,
  body,
}: {
  testId: string;
  title: string;
  body?: string;
}) {
  return (
    <Alert isInline variant="warning" title={title} data-test={testId}>
      {body === undefined ? null : <p>{body}</p>}
    </Alert>
  );
}
