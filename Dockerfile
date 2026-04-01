FROM node:lts-alpine

ARG host
ARG port
ARG protocol
ARG scrape_interval
ARG base_url
ARG hide_ports
ARG chart_data_points
ARG chart_refresh_interval

# Setting working directory
WORKDIR /app

# Copying package files first for better caching
COPY package.json package-lock.json ./

# Deterministic dependency install
RUN npm ci

# Copying rest of the source files
COPY index.js chart.js demo.html \
    webpack.config.js favicon.ico style.css health-check.js ./

# Build and cleanup
RUN npx webpack --mode production && \
    rm -rf node_modules/ && \
    sed -i 's@__BASE_URL__@'"$base_url"'@' demo.html

# Expose default port
EXPOSE 64567

# Runtime user - node is already present in Alpine images
USER node

# Start command
CMD [ "node", "index.js" ]

# Health check - updated to be relative to WORKDIR
HEALTHCHECK --interval=90s --timeout=10s --start-period=10s --retries=3 \
    CMD node health-check.js || exit 1