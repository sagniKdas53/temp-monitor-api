FROM node:lts-alpine

# Setting working directory
WORKDIR /app

# Copying package files first for better caching
COPY package.json package-lock.json ./

# Deterministic dependency install
RUN npm ci

# Copying rest of the source files
COPY index.js chart.js demo.html \
    build.js favicon.ico style.css health-check.js ./

# Bundle the frontend JS (no deployment-specific args needed;
# runtime config is served by the /config endpoint in index.js)
RUN node build.js && rm -rf node_modules/

# Expose default port
EXPOSE 64567

# Runtime user - node is already present in Alpine images
USER node

# Start command
CMD [ "node", "index.js" ]

# Health check - updated to be relative to WORKDIR
HEALTHCHECK --interval=90s --timeout=10s --start-period=10s --retries=3 \
    CMD node health-check.js || exit 1