import { render, screen } from '@testing-library/react';
import { NotAvailable } from './NotAvailable';

describe('NotAvailable', () => {
  it('shows its title and body under its test id', () => {
    render(<NotAvailable testId="libredb-not-available-pgo" title="A title" body="A body" />);
    const alert = screen.getByTestId('libredb-not-available-pgo');
    expect(alert).toHaveTextContent('A title');
    expect(alert).toHaveTextContent('A body');
  });

  it('shows a title alone', () => {
    render(<NotAvailable testId="x" title="Only a title" />);
    expect(screen.getByTestId('x')).toHaveTextContent(/Only a title$/);
  });

  it('shows markup in its text as text', () => {
    render(<NotAvailable testId="x" title="<img src=x>" body="<img src=y>" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('x')).toHaveTextContent('<img src=y>');
  });
});
