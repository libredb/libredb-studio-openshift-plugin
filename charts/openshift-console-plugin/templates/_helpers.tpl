{{/*
Expand the name of the chart.
*/}}
{{- define "openshift-console-plugin.name" -}}
{{- default (default .Chart.Name .Release.Name) .Values.plugin.name | trunc 63 | trimSuffix "-" }}
{{- end }}


{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "openshift-console-plugin.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "openshift-console-plugin.labels" -}}
helm.sh/chart: {{ include "openshift-console-plugin.chart" . }}
{{ include "openshift-console-plugin.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "openshift-console-plugin.selectorLabels" -}}
app: {{ include "openshift-console-plugin.name" . }}
app.kubernetes.io/name: {{ include "openshift-console-plugin.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: {{ include "openshift-console-plugin.name" . }}
{{- end }}

{{/*
Create the name secret containing the certificate
*/}}
{{- define "openshift-console-plugin.certificateSecret" -}}
{{ default (printf "%s-cert" (include "openshift-console-plugin.name" .)) .Values.plugin.certificateSecretName }}
{{- end }}

{{/*
The image bakes nginx.conf, which listens on 9443 and serves from /, so a port or base path value cannot take effect
*/}}
{{- define "openshift-console-plugin.port" -}}
{{- if hasKey .Values.plugin "port" }}
{{- fail "plugin.port is not a value of this chart: the image's baked nginx.conf listens on 9443" }}
{{- end }}
{{- if hasKey .Values.plugin "basePath" }}
{{- fail "plugin.basePath is not a value of this chart: the image's baked nginx.conf serves the plugin from /" }}
{{- end }}
{{- 9443 }}
{{- end }}

{{/*
The plugin's own ServiceAccount, never the namespace's default one
*/}}
{{- define "openshift-console-plugin.serviceAccountName" -}}
{{- include "openshift-console-plugin.name" . }}
{{- end }}
