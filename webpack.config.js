const path = require('path');
const webpack = require('webpack');

// For chart.js
const chart_refresh_interval = process.env.chart_refresh_interval || 15000;
const chart_data_points = process.env.chart_data_points || 12;
// Essentials
const protocol = process.env.protocol || "http";
const host = process.env.host || "localhost";
const port = process.env.port || 64567;
const url_base = process.env.base_url || "/temp";

if (process.env.hide_ports) url = `${protocol}://${host}${url_base}`;
else url = `${protocol}://${host}:${port}${url_base}`;

module.exports = {
  mode: "production",
  entry: {
    chart: './chart.js',
  },
  output: {
    filename: 'chart.js',
    path: path.resolve(__dirname, 'dist')
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      __URL__: JSON.stringify(url),
      __SIZE__: JSON.stringify(chart_data_points),
      __INTERVAL__: JSON.stringify(chart_refresh_interval)
    })
  ]
};
