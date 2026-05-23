const esbuild = require('esbuild');

// Bundle chart.js for the browser.
// Deployment-specific config (URL, size, interval) is now fetched at runtime
// from the /config endpoint served by index.js, so no build args are needed.
esbuild.build({
    entryPoints: ['chart.js'],
    bundle: true,
    minify: true,
    outfile: 'dist/chart.js',
}).catch(() => process.exit(1));
