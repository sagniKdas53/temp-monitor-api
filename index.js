const http = require("http");
const fs = require("fs");

// Essentials
const protocol = process.env.protocol || "http";
const host = process.env.host || "localhost";
const port = process.env.port || 64567;
const url_base = process.env.base_url || "/temp";
var url, retries = 0;
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

http.createServer((req, res) => {
    if (req.url.startsWith(url_base) && req.method === "GET") {
        var get = req.url.replace(url_base, "");
        if (get === "" || get === "/") {
            // reading /proc/meminfo can be use to get information about memory usage
            fs.readFile("/sys/class/thermal/thermal_zone0/tem", 'utf8', (err, data) => {
                if (err) {
                    console.error("Error reading temp: " + err.message);
                    res.writeHead(500, json_header);
                    res.end(JSON.stringify({ temp: "NA" }));
                    if (retries >= 9) {
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
        } else {
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