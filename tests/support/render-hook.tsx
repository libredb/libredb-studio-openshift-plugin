import { render } from '@testing-library/react';

/**
 * Renders `hook` inside a probe component and keeps its latest value, as Testing Library 13's renderHook does; the
 * React 17 line of Testing Library (12.x) has no renderHook.
 */
export function renderHook<P, T>(hook: (props: P) => T, initialProps: P) {
  const result = { current: undefined as unknown as T };
  function Probe({ props }: { props: P }) {
    result.current = hook(props);
    return null;
  }
  const view = render(<Probe props={initialProps} />);
  return {
    result,
    rerender: (props: P) => view.rerender(<Probe props={props} />),
    unmount: view.unmount,
  };
}
