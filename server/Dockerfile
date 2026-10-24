# The transport server's image. Built from the repository's root (the protocol is shared with the app):
#   docker build -f server/Dockerfile -t <registry>/qvarch/transport:<version> .
# What enters the build is listed in Dockerfile.dockerignore.

FROM node:22-alpine AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
COPY src/shared/transport/ /app/src/shared/transport/
COPY src/main/transport/keys.ts /app/src/main/transport/keys.ts
RUN node build.mjs

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- "http://127.0.0.1:${QA_PORT:-3000}/health" > /dev/null || exit 1
CMD ["node", "dist/server.js"]
