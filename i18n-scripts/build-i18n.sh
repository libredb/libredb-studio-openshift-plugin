#!/usr/bin/env bash

set -exuo pipefail

# Specs and the end-to-end tree call t() with sample keys, so only the plugin's own files are read:
# the test trees are left out of the pattern and every spec beside its source by the negated glob.
FILE_PATTERN="{!(dist|node_modules|coverage|tests|integration-tests)/**/*.{js,jsx,ts,tsx,json},*.{js,jsx,ts,tsx,json}}"
SPEC_PATTERN='!**/*.spec.{js,jsx,ts,tsx}'

i18next "${FILE_PATTERN}" "${SPEC_PATTERN}" [-oc] -c "./i18next-parser.config.js" -o "locales/\$LOCALE/\$NAMESPACE.json"
