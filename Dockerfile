# syntax=docker/dockerfile:1

FROM node:24-slim AS base
ENV HUSKY=0
RUN corepack enable

# --- Build the faucet
FROM base AS build
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

# --- Runtime
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist
COPY --from=build /build/package.json ./
COPY views ./views
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
