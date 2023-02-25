const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const { javascript } = require("webpack");

// For normal process
const call_back = process.env.interval || 999;
// Essentials
const protocol = process.env.protocol || "http";
const host = process.env.host || "localhost";
const port = process.env.port || 64567;
const url_base = process.env.base_url || "/temp";

if (process.env.hide_ports) url = `${protocol}://${host}${url_base}`;
else url = `${protocol}://${host}:${port}${url_base}`;

const json_t = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8"
},
    javascript_t = "text/javascript; charset=utf-8"
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
            res.writeHead(200, json_t);
            const temp = spawn("cat", ["/sys/class/thermal/thermal_zone0/temp"]);
            temp.stdout.on("data", function (data) {
                data = data / 1000;
                res.end(JSON.stringify({
                    temp: data
                }));
            });
            temp.stderr.on("data", function (data) {
                res.end(JSON.stringify({
                    temp: "NA"
                }));
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
                console.error(error);
                res.writeHead(404, json_t);
                res.end(JSON.stringify({
                    temp: "NA"
                }));
            }
        }
    }
    else {
        res.writeHead(405, header["json_t"]);
        res.end(JSON.stringify({
            temp: "NA"
        }));
    }
}).listen(port, () => {
    console.log(`Api Listening on ${url}`);
});