#!/usr/bin/env bash

set -exuo pipefail

# Specs and the end-to-end tree call t() with sample keys, so only the plugin's own files are read.
FILE_PATTERN="{!(dist|node_modules|coverage|tests|integration-tests)/**/*.{js,jsx,ts,tsx,json},*.{js,jsx,ts,tsx,json}}"

i18next "${FILE_PATTERN}" [-oc] -c "./i18next-parser.config.js" -o "locales/\$LOCALE/\$NAMESPACE.json"
