# syntax=docker/dockerfile:1
#
# Builds the faucet together with the litecoin-rpc library from source, so the
# library does not need to be published. Pass the library as a named context:
#
#   docker build --build-context ltc-rpc=../github/ltc-rpc -t ltc-faucet .
#
# (docker compose does this for you; see docker-compose.yml.)
#
# The directory layout mirrors the host (/build/github/ltc-rpc next to
# /build/ltc-faucet) so the faucet's "file:../github/ltc-rpc" dependency and
# its lockfile resolve unchanged.

FROM node:24-slim AS base
ENV HUSKY=0
RUN corepack enable

# --- Build the library
FROM base AS lib
WORKDIR /build/github/ltc-rpc
COPY --from=ltc-rpc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY --from=ltc-rpc tsconfig.json tsup.config.ts ./
COPY --from=ltc-rpc src ./src
RUN pnpm build

# --- Build the faucet
FROM base AS faucet
COPY --from=lib /build/github/ltc-rpc/package.json /build/github/ltc-rpc/package.json
COPY --from=lib /build/github/ltc-rpc/dist /build/github/ltc-rpc/dist
WORKDIR /build/ltc-faucet
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

# --- Runtime
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=faucet /build/ltc-faucet/node_modules ./node_modules
COPY --from=faucet /build/ltc-faucet/dist ./dist
COPY --from=faucet /build/ltc-faucet/package.json ./
COPY views ./views
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
