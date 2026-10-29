# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/admin-web/package.json apps/admin-web/
RUN npm install --workspace apps/admin-web --ignore-scripts || npm install
COPY . .
RUN npm --workspace apps/admin-web run build
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/admin-web/.next/standalone ./
COPY --from=build /app/apps/admin-web/.next/static ./apps/admin-web/.next/static
EXPOSE 3000
CMD ["node", "apps/admin-web/server.js"]
