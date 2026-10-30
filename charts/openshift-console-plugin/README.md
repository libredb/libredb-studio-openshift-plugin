# openshift-console-plugin (development chart)

For development and the lab only: install it only into a namespace only cluster admins write, because the server receives every console user's token; clusters install the plugin through LibreDB Studio's chart or operator.

This chart is never published.
It renders the plugin's nginx Deployment, its Service, a ServiceAccount with no token mounted and the cluster-scoped ConsolePlugin `libredb-studio`.
The image carries its nginx configuration, runs with a read-only root and a writable `/tmp`, and serves TLS on port 9443 with the certificate the service CA writes into the Secret `libredb-studio-cert`.

The chart renders no Job, ClusterRole or ClusterRoleBinding, so it does not enable the plugin in the console.
A cluster admin creates the namespace with `oc create namespace`, never with `oc new-project`, installs the chart, and then enables the plugin by hand:

```bash
oc create namespace os-lab-plugin
helm upgrade --install libredb-studio charts/openshift-console-plugin -n os-lab-plugin --set plugin.image=<image>
oc patch consoles.operator.openshift.io cluster --type=json -p '[{"op":"add","path":"/spec/plugins/-","value":"libredb-studio"}]'
```

The patch appends to an existing `spec.plugins` list; when the cluster has none yet, add the list with `"path":"/spec/plugins","value":["libredb-studio"]`.
Remove the entry again when the lab is done, because a stale entry trusts the next ConsolePlugin of that name.
