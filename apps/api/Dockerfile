# syntax=docker/dockerfile:1.7
# Multi-stage: the build toolchain never reaches the runtime layer (rules/60-infra.md).
# Built from the REPO ROOT so the pnpm workspace resolves:
#   docker build -f apps/api/Dockerfile -t ims-api .

ARG NODE_VERSION=22.13-alpine
ARG PNPM_VERSION=9.15.4

# ---------------------------------------------------------------- deps + build
FROM node:${NODE_VERSION} AS build
ARG PNPM_VERSION
# Installed explicitly rather than through corepack: corepack in this image carries an
# expired signing key and fails while resolving "latest stable", which turns an unrelated
# upstream change into a broken build.
RUN npm install -g pnpm@${PNPM_VERSION}

WORKDIR /repo

# Manifests first: this layer only busts when a dependency actually changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @ims/shared... --filter @ims/api...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @ims/shared build && pnpm --filter @ims/api build

# Drop dev dependencies from the tree we are about to copy across.
RUN pnpm prune --prod

# -------------------------------------------------------------------- runtime
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
# Reject a container started without a real TZ; the whole system is Asia/Dhaka.
ENV TZ=Asia/Dhaka
RUN apk add --no-cache tzdata wget

WORKDIR /app

# node:alpine ships an unprivileged `node` user; use it rather than inventing one.
#
# pnpm gives every workspace package its own node_modules of symlinks into the root
# `.pnpm` store. Those links are relative, so the whole layout has to land at the same
# depth under /app or they dangle — which is why each package's node_modules is copied
# alongside the root one rather than relying on hoisting.
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=node:node /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build --chown=node:node /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist

# Generated BOM PDFs live on a mounted volume; the directory must exist and be writable
# before the volume is attached, or the first render fails on a fresh host.
RUN mkdir -p /app/storage && chown node:node /app/storage

USER node
WORKDIR /app/apps/api
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/src/main.js"]
