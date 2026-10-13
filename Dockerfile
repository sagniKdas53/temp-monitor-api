# Build stage: install dev dependencies and bundle the frontend
FROM node:24-alpine AS build

WORKDIR /app

# Copying package files first for better caching
COPY package.json package-lock.json ./

# Deterministic dependency install
RUN npm ci

# Bundle the frontend JS (no deployment-specific args needed;
# runtime config is served by the /config endpoint in index.js)
COPY build.js chart.js ./
RUN node build.js

# Runtime stage: no node_modules or npm cache, only what the server reads
FROM node:24-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY index.js config.js health-check.js \
    demo.html homarr.html favicon.ico style.css ./
COPY --from=build /app/dist ./dist

# Expose default port
EXPOSE 64567

# Runtime user: "node" (uid/gid 1000) is already present in the image
USER 1000:1000

# Health check (health-check.js times out after 5s, below --timeout)
HEALTHCHECK --interval=90s --timeout=10s --start-period=10s --retries=3 \
    CMD ["node", "health-check.js"]

# Start command (exec form, so node is PID 1 and receives SIGTERM)
CMD [ "node", "index.js" ]
