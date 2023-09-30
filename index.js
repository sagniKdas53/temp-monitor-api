const http = require("http");
const fs = require("fs");

// Essentials
const protocol = process.env.protocol || "http";
const host = process.env.hostname || "ideapad.tail9ece4.ts.net";
const port = process.env.port || 64567;
const url_base = process.env.base_url || "/temp";
const max_retries = process.env.max_retries || 9;
var url, retries = 0;
if (process.env.hide_ports) { url = `${protocol}://${host}${url_base}`; }
else { url = `${protocol}://${host}:${port}${url_base}`; };
if (__dirname == '/')
    __dirname = '';
const json_header = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8"
},
    javascript_t = "text/javascript; charset=utf-8",
    staticAssets = {
        "/chart.js": { obj: fs.readFileSync(__dirname + "/dist/chart.js"), type: javascript_t },
        "/test": { obj: fs.readFileSync(__dirname + "/test.html"), type: "text/html; charset=utf-8" },
        "/favicon.ico": { obj: fs.readFileSync(__dirname + "/favicon.ico"), type: "image/x-icon" },
        "/style.css": { obj: fs.readFileSync(__dirname + "/style.css"), type: "text/css; charset=utf-8" }
    };

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
                    // The real change this makes will be visible on raspberry pi
                    //res.end(JSON.stringify({ temp: (data / 1000).toFixed(2) }));
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