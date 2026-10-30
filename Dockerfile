FROM registry.access.redhat.com/ubi9/nodejs-22:latest@sha256:b66295c1b3ef39cc5adcf7f0459f7ec9111014e1dce8f565ed4339c760862418 AS build
USER root
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN command -v yarn || (npm i -g corepack && corepack enable)

ADD . /usr/src/app
WORKDIR /usr/src/app
RUN yarn install --immutable && yarn build

FROM registry.access.redhat.com/ubi9/nginx-120:latest@sha256:a79a9e924f0543d232b862838249ce5f410e8ad0fcc9cf2bd317e2ff45da8eb8

COPY --from=build /usr/src/app/dist /usr/share/nginx/html
USER 1001

ENTRYPOINT ["nginx", "-g", "daemon off;"]
