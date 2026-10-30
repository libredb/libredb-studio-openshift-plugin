import { useTranslation } from 'react-i18next';

// The mock's useTranslation is a plain function, so the spec may call it outside a component.
// eslint-disable-next-line react-hooks/rules-of-hooks
const { t } = useTranslation('plugin__libredb-studio');

describe('the react-i18next mock', () => {
  it('replaces every placeholder with its value as text', () => {
    expect(t('Open {{a}} as {{b}}', { a: 'x', b: '<img src=x>' })).toBe('Open x as <img src=x>');
  });

  it('returns a key without placeholders unchanged', () => {
    expect(t('Databases')).toBe('Databases');
  });

  it('throws naming a placeholder the call gives no value for', () => {
    expect(() => t('Open as {{user}} in LibreDB Studio', {})).toThrow('{{user}}');
    expect(() => t('Open as {{user}} in LibreDB Studio')).toThrow('{{user}}');
  });
});
