# syntax=docker/dockerfile:1.7
# Built from the REPO ROOT:  docker build -f apps/web/Dockerfile -t ims-web .

ARG NODE_VERSION=22.13-alpine
ARG NGINX_VERSION=1.27-alpine
ARG PNPM_VERSION=9.15.4

FROM node:${NODE_VERSION} AS build
ARG PNPM_VERSION
# See apps/api/Dockerfile for why this is not corepack.
RUN npm install -g pnpm@${PNPM_VERSION}

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @ims/shared... --filter @ims/web...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# The SPA calls same-origin `/api/v1` behind Caddy, so there is no API URL to bake in —
# which is what keeps one image deployable to every environment.
RUN pnpm --filter @ims/shared build && pnpm --filter @ims/web build

FROM nginx:${NGINX_VERSION} AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
