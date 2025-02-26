const http = require("http");
const fs = require("fs");

// Essentials
const protocol = process.env.protocol || "http";
const host = process.env.hostname || "ideapad.tail9ece4.ts.net";
const port = process.env.port || 64567;
const url_base = process.env.base_url || "/temp";
const max_retries = process.env.max_retries || 9;
const scrape_interval = process.env.scrape_interval || 15000;
var url, retries = 0, last_read_time = null, last_read_data = null;
if (process.env.hide_ports) { url = `${protocol}://${host}${url_base}`; }
else { url = `${protocol}://${host}:${port}${url_base}`; };
if (__dirname == '/')
    __dirname = '';
const json_header = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8"
},
    staticAssets = {
        "/chart.js": { obj: fs.readFileSync(__dirname + "/dist/chart.js"), type: "text/javascript; charset=utf-8" },
        "/test": { obj: fs.readFileSync(__dirname + "/test.html"), type: "text/html; charset=utf-8" },
        "/favicon.ico": { obj: fs.readFileSync(__dirname + "/favicon.ico"), type: "image/x-icon" },
        "/style.css": { obj: fs.readFileSync(__dirname + "/style.css"), type: "text/css; charset=utf-8" }
    },
    readCpuTemp = () => {
        return new Promise((resolve, reject) => {
            if (last_read_time && last_read_data && Date.now() - last_read_time < scrape_interval) {
                console.log("Returning cached data");
                resolve(last_read_data);
                return;
            }
            fs.readFile("/sys/class/thermal/thermal_zone0/tem", "utf8", (err, data) => {
                if (err) {
                    console.error("Error reading data: ", err);
                    if (retries == max_retries) {
                        // Attempt to exit gracefully, if the reads fail `max_retries` times
                        console.log("Max retries reached, exiting...");
                        process.exit(1);
                    }
                    reject(err);
                    retries++;
                } else {
                    retries = 0;
                    const tempC = parseInt(data, 10) / 1000;
                    last_read_data = tempC;
                    last_read_time = Date.now();
                    console.log("Data read successfully: ", tempC, "°C", "at", new Date().toISOString());
                    resolve(tempC);
                }
            });
        });
    };

//setInterval(readCpuTemp, scrape_interval);

http.createServer((req, res) => {
    if (req.url.startsWith(url_base) && req.method === "GET") {
        var get = req.url.replace(url_base, "");
        //console.log(get);
        if (get === "" || get === "/") {
            readCpuTemp().then((tempC) => {
                res.writeHead(200, json_header);
                res.end(JSON.stringify({
                    temp: tempC
                }));
            }).catch((err) => {
                res.writeHead(500, json_header);
                res.end(JSON.stringify({
                    temp: null,
                    error: err.toString()
                }));
            });
        } else if (get === "/ping") {
            res.writeHead(200, json_header);
            res.write(JSON.stringify({ "res": "pong" }));
            res.end();
        } else if (get === "/metrics") {
            readCpuTemp().then((tempC) => {
                const metricsOutput = [
                    '# HELP cpu_temperature Current CPU temperature in Celsius',
                    '# TYPE cpu_temperature gauge',
                    `cpu_temperature ${tempC}`
                ].join('\n');
                console.log("Metrics: ", metricsOutput);
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(metricsOutput);
            }).catch((err) => {
                res.writeHead(500, json_header);
                res.end(JSON.stringify({
                    temp: null,
                    error: err.toString()
                }));
            });
        }
        else {
            try {
                res.writeHead(200, {
                    "Access-Control-Allow-Origin": "*",
                    "Content-Type": staticAssets[get].type
                });
                res.write(staticAssets[get].obj);
                res.end();
            } catch (error) {
                res.writeHead(404, json_header);
                res.end(JSON.stringify({
                    temp: null
                }));
            }
        }
    }
    else {
        res.writeHead(405, json_header);
        res.end(JSON.stringify({
            temp: null
        }));
    }
}).listen(port, () => {
    console.log(`Api Listening on ${url}`);
});