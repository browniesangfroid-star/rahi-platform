# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared-types/package.json packages/shared-types/
RUN npm install --workspace apps/api --ignore-scripts || npm install
COPY . .
RUN npm --workspace apps/api run build
FROM node:22-alpine AS runtime
# psql is needed for the one-time hosted setup (migrations via
# scripts/run-migrations.sh from a Render Shell, see docs/HOSTING.md).
RUN apk add --no-cache postgresql-client
WORKDIR /app
ENV NODE_ENV=production
# The API requires @rahi/shared-types at runtime. It is a workspace
# package, not a registry package, so the runtime image carries the
# build stage's node_modules (with the workspace symlink) plus the
# shared package's own files — a registry install here would fail
# to resolve it and silently leave dist broken.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types ./packages/shared-types
COPY --from=build /app/apps/api/dist ./dist
# Operator scripts for hosted setup (Render Shell): create-admin.mjs
# imports ../dist, so the scripts land in ./scripts; the migration
# script globs apps/api/migrations/*.sql, so that path is preserved.
COPY --from=build /app/apps/api/scripts ./scripts
COPY --from=build /app/scripts/run-migrations.sh ./scripts/run-migrations.sh
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
EXPOSE 3001
CMD ["node", "dist/main.js"]
