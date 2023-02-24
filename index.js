const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");

// For normal process
const call_back = process.env.interval || 999;
// Essentials
const protocol = process.env.protocol || "http";
const host = process.env.host || "localhost";
const port = process.env.port || 64567;
const url_base = process.env.base_url || "/temp";

if (process.env.hide_ports) url = `${protocol}://${host}${url_base}`;
else url = `${protocol}://${host}:${port}${url_base}`;

const header = {
    html: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/html; charset=utf-8",
    },
    js: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/javascript; charset=utf-8",
    },
    json_t: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json; charset=utf-8",
    },
};

const staticAssets = {
    "/chart.js": fs.readFileSync(__dirname + "/dist/bundle.js"),
    "/test": fs.readFileSync(__dirname + "/test.html"),
};

http.createServer((req, res) => {
    if (req.url.startsWith(url_base) && req.method === "GET") {
        var get = req.url.replace(url_base, "");
        //console.log(`get(${get})`);
        if (get === "" || get === "/") {
            res.writeHead(200, header["json_t"]);
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
        }
        else if (get === "/getemp.js") {
            res.writeHead(200, header["js"]);
            res.write(`getTemp = () => {fetch('${url}')
            .then(res => res.json())
            .then(temp => document.getElementById('value').innerHTML = temp.temp);`);
            if (call_back > 1000)
                res.write(`setTimeout(() => { getTemp(); }, ${call_back});`);
            res.end(`};getTemp();`);
        }
        else if (get === "/chart.js") {
            res.writeHead(200, header["js"]);
            res.write(staticAssets[get]);
            res.end();
        }
        else if (get === "/test") {
            res.writeHead(200, header["html"]);
            res.write(staticAssets[get]);
            res.end();
        }
        else {
            res.writeHead(404, header["json_t"]);
            res.end(JSON.stringify({
                temp: "NA"
            }));
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