# The build stage runs on the build platform: its output is architecture-independent JavaScript, and the runtime stage
# has no RUN instruction, so a multi-platform build needs no emulator.
FROM --platform=$BUILDPLATFORM registry.access.redhat.com/ubi9/nodejs-22:latest@sha256:b66295c1b3ef39cc5adcf7f0459f7ec9111014e1dce8f565ed4339c760862418 AS build

ARG VERSION
WORKDIR /opt/app-root/src

# The image labels carry VERSION, so a build without it, or with one that differs from package.json, stops here.
COPY --chown=1001:0 package.json yarn.lock .yarnrc.yml ./
RUN expected="$(node -p "require('./package.json').version")" \
  && if [ -z "${VERSION:-}" ] || [ "${VERSION}" != "${expected}" ]; then \
    echo "Pass --build-arg VERSION=${expected}, the version in package.json (got '${VERSION:-}')." >&2; \
    exit 1; \
  fi

# The committed Yarn release installs from the lockfile; .yarnrc.yml sets enableScripts: false, so no dependency's
# install script runs in the stage whose bundle every console session loads.
COPY --chown=1001:0 .yarn/releases .yarn/releases
RUN node .yarn/releases/yarn-4.13.0.cjs install --immutable

COPY --chown=1001:0 . .
RUN node .yarn/releases/yarn-4.13.0.cjs build

FROM registry.access.redhat.com/ubi9/nginx-120:latest@sha256:a79a9e924f0543d232b862838249ce5f410e8ad0fcc9cf2bd317e2ff45da8eb8

ARG VERSION
LABEL name="libredb-studio-openshift-plugin" \
  vendor="LibreDB" \
  version="${VERSION}" \
  release="${VERSION}" \
  summary="LibreDB Studio plugin for the OpenShift web console" \
  description="Serves the OpenShift web console dynamic plugin that lists the cluster's databases and opens them in LibreDB Studio." \
  maintainer="LibreDB <info@sekoya.tech>" \
  url="https://github.com/libredb/libredb-studio-openshift-plugin" \
  io.k8s.display-name="LibreDB Studio console plugin" \
  io.k8s.description="Serves the OpenShift web console dynamic plugin that lists the cluster's databases and opens them in LibreDB Studio." \
  io.openshift.expose-services="9443:https" \
  io.openshift.tags="openshift,console-plugin,libredb"

COPY --from=build /opt/app-root/src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
COPY LICENSE NOTICE /licenses/

EXPOSE 9443
USER 1001

# The error log goes to standard error from the start, so nginx never opens a log file on the read-only root.
ENTRYPOINT ["nginx", "-e", "/dev/stderr", "-g", "daemon off;"]
