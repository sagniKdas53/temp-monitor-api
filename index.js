const http = require("http");
const fs = require("fs");

// Essentials
const protocol = process.env.protocol || "http";
const host = process.env.host || "localhost";
const port = process.env.port || 64567;
const url_base = process.env.base_url || "/temp";
const max_retries = process.env.max_retries || 9;
var url, retries = 0, mem_retries = 0;
if (process.env.hide_ports) { url = `${protocol}://${host}${url_base}`; }
else { url = `${protocol}://${host}:${port}${url_base}`; };

const json_header = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8"
},
    javascript_t = "text/javascript; charset=utf-8",
    staticAssets = {
        "/chart.js": { obj: fs.readFileSync(__dirname + "/dist/bundle.js"), type: javascript_t },
        "/getemp.js": { obj: fs.readFileSync(__dirname + "/dist/getemp.js"), type: javascript_t },
        "/test": { obj: fs.readFileSync(__dirname + "/test.html"), type: "text/html; charset=utf-8" },
        "/favicon.ico": { obj: fs.readFileSync(__dirname + "/favicon.ico"), type: "image/x-icon" }
    };

function convertToJSON(input) {
    const lines = input.trim().split('\n');
    const result = {};

    for (const line of lines.slice(0, 3)) {
        const [key, value] = line.trim().split(':');
        result[key] = value.trim().split(" ")[0] / 10e5;
    }

    return JSON.stringify(result);
}

http.createServer((req, res) => {
    if (req.url.startsWith(url_base) && req.method === "GET") {
        var get = req.url.replace(url_base, "");
        if (get === "" || get === "/") {
            fs.readFile("/sys/class/thermal/thermal_zone0/temp", 'utf8', (err, data) => {
                if (err) {
                    console.error("Error reading temp: " + err.message);
                    res.writeHead(500, json_header);
                    res.end(JSON.stringify({ temp: "NA" }));
                    if (retries == max_retries) {
                        process.exit(1);
                    }
                    retries++;
                }
                if (data) {
                    retries = 0;
                    //console.log("data:", data, "temp: " + data / 1000);
                    res.writeHead(200, json_header);
                    res.end(JSON.stringify({ temp: data / 1000 }));
                }
            });
        } else if (get === "/meminfo") {
            // reading /proc/meminfo can be use to get information about memory usage
            fs.readFile("/proc/meminfo", 'utf8', (err, data) => {
                if (err) {
                    console.error("Error reading temp: " + err.message);
                    res.writeHead(500, json_header);
                    res.end(JSON.stringify({ meminfo: "NA" }));
                    if (mem_retries == max_retries) {
                        process.exit(1);
                    }
                    mem_retries++;
                }
                if (data) {
                    mem_retries = 0;
                    res.writeHead(200, json_header);
                    res.end(convertToJSON(data));
                }
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
                    temp: "NA"
                }));
            }
        }
    }
    else {
        res.writeHead(405, json_header);
        res.end(JSON.stringify({
            temp: "NA"
        }));
    }
}).listen(port, () => {
    console.log(`Api Listening on ${url}`);
});