/*
 * A majority of the OpenShift Console's dynamic plugin SDK components and API
 * implementations are only available at runtime as they are provided using
 * module federation.
 *
 * As a result, no implementations of these components and APIs are available
 * when running tests in your plugin.
 *
 * To workaround this, you may add minimal stub implementations of components
 * and APIs you use in your plugin here to allow your tests to run.
 */
import type * as SDK from '@openshift-console/dynamic-plugin-sdk';

export const ListPageHeader: typeof SDK.ListPageHeader = ({ title }) => <h1>{title}</h1>;

export const DocumentTitle: typeof SDK.DocumentTitle = () => null;

export const NamespaceBar: typeof SDK.NamespaceBar = () => <div data-test="namespace-bar" />;

export const ResourceLink: typeof SDK.ResourceLink = ({ name, namespace, groupVersionKind }) => (
  <span
    data-test="resource-link"
    data-kind={groupVersionKind ? `${groupVersionKind.group}~${groupVersionKind.kind}` : ''}
    data-namespace={namespace}
  >
    {name}
  </span>
);

// Hooks and calls each spec sets up with jest.mocked(...).
export const useK8sWatchResource = jest.fn();
export const useK8sWatchResources = jest.fn();
export const useFlag = jest.fn();
export const useActiveNamespace = jest.fn();
export const checkAccess = jest.fn();
