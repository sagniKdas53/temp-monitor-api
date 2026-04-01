const esbuild = require('esbuild');
const path = require('path');

// For chart.js
const chart_refresh_interval = process.env.chart_refresh_interval || 15000;
const chart_data_points = process.env.chart_data_points || 12;
// Essentials
const protocol = process.env.protocol || "http";
const host = process.env.host || "localhost";
const port = process.env.port || 64567;
const url_base = process.env.base_url || "/temp";

const url = process.env.hide_ports 
  ? `${protocol}://${host}${url_base}` 
  : `${protocol}://${host}:${port}${url_base}`;

esbuild.build({
  entryPoints: ['chart.js'],
  bundle: true,
  minify: true,
  outfile: 'dist/chart.js',
  define: {
    '__URL__': JSON.stringify(url),
    '__SIZE__': JSON.stringify(chart_data_points),
    '__INTERVAL__': JSON.stringify(chart_refresh_interval),
  }
}).catch(() => process.exit(1));
