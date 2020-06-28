{{/* vim: set filetype=mustache: */}}

{{/*
Create a default fully qualified app name.
If release name contains release name it will be used as a full name.
*/}}
{{- define "helpers.build-name" -}}
{{- printf "%s-%s" (default .Values.stack .Release.Name) .name | trimSuffix "-" -}}
{{- end -}}

{{/*
Get a docker image path as configured in the values.
*/}}
{{- define "helpers.build-image" -}}
{{ with (index .Values.images .name) }}
{{- printf "%s:%s" .repository .tag -}}
{{- end }}
{{- end -}}

{{/*
Static labels--names that should not normally change
*/}}
{{- define "helpers.static-labels" -}}
stack: {{ .Release.Name }}
app: {{ .name }}
{{- end -}}

{{/*
Common labels
*/}}
{{- define "helpers.labels" -}}
{{ include "helpers.static-labels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
