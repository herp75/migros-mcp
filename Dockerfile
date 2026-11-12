# Base image pinned by digest; Dependabot keeps it up to date.

# --- Build stage: compile TypeScript, then keep only the runtime dependencies ------------
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# --- Runtime stage: Node and the server, nothing else ------------------------------------
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

# Security fixes released after the base image was built; and no package managers at
# runtime (npm, npx, corepack and yarn are not needed to run the server).
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && adduser -S -D -H -u 10001 app \
 && mkdir -p /config && chown app /config && chmod 700 /config

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# MCP Registry: proves this image belongs to the server.json entry of the same name
LABEL io.modelcontextprotocol.server.name="io.github.herp75/migros-mcp"

# The saved login lives in /config/migros-mcp/session.json. Mount a volume there, so the
# login survives restarts (Migros blocks computers that sign in too often).
# Updates come with a new image, so the npm update notice is off.
ENV NODE_ENV=production XDG_CONFIG_HOME=/config MIGROS_MCP_UPDATE_CHECK=false
VOLUME /config

USER app
# Credentials come from the runtime environment (docker run -e / --env-file), never baked in.
ENTRYPOINT ["node", "dist/index.js"]
