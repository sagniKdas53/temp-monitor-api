"use strict";

const port = process.env.port || 64567;
const baseUrl = process.env.base_url || "/temp";
const url = `http://localhost:${port}${baseUrl}/ping`;

const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout occurred")), 10000)
);

Promise.race([
    fetch(url),
    timeout
])
.then(async (res) => {
    if (res.status === 200) {
        const data = await res.json();
        if (data.status === "UP") {
            process.exit(0);
        }
    }
    console.error(`Health check failed with status: ${res.status}`);
    process.exit(1);
})
.catch((err) => {
    console.error("Health check error:", err.message);
    process.exit(1);
});
