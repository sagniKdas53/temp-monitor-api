FROM node:lts-alpine

ARG host
ARG port
ARG protocol
ARG scrape_interval
ARG base_url
ARG hide_ports
ARG chart_data_points
ARG chart_refresh_interval

WORKDIR /

COPY index.js chart.js demo.html homarr.html package.json \
    webpack.config.js favicon.ico style.css health-check-min.js /

RUN npm install && \
    npx webpack --mode production && \
    rm -rf node_modules/ && \
    sed -i 's@__BASE_URL__@'"$base_url"'@' demo.html && \
    sed -i 's@__BASE_URL__@'"$base_url"'@' homarr.html

EXPOSE 64567

CMD [ "node", "index.js" ]

HEALTHCHECK --interval=90s --timeout=10s --start-period=10s --retries=3 \
    CMD node health-check-min.js || exit 1