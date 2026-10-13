import {
    Chart, CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip
} from 'chart.js';

// Register only what this line chart uses (chart.js/auto bundles everything)
Chart.register(CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip);

const DEFAULT_SIZE = 12;
const DEFAULT_INTERVAL = 15000;

// Resolve the API relative to this script's own URL, not the embedding page:
// in a Dashy embed the page is Dashy, so './config' would hit Dashy itself.
// document.currentScript is only set while the script first executes.
const scriptUrl = (document.currentScript && document.currentScript.src) || window.location.href;
const apiBase = new URL('./', scriptUrl);

// Temperature graph
const data = {
    labels: [],
    datasets: [
        {
            label: 'Temperature',
            data: [],
            fill: false,
            borderColor: 'rgb(65, 239, 144)',
            tension: 0.1
        }
    ]
};

const config = {
    type: 'line',
    data: data,
    options: {
        plugins: {
            legend: {
                display: false
            }
        }, scales: {
            x: {
                grid: {
                    display: false
                }
            },
            y: {
                grid: {
                    display: false
                },
            }
        },
        animation: false
    }
};

const chart = new Chart(document.getElementById('tempChart'), config);

const positiveInt = (value, fallback) =>
    (Number.isInteger(value) && value > 0 ? value : fallback);

// Fetch runtime config from the /config endpoint served by index.js.
// The API URL itself is derived from the script URL (above): the server's
// configured `url` can't know how the browser actually reached it.
async function loadConfig() {
    try {
        const resp = await fetch(new URL('config', apiBase));
        if (!resp.ok) throw new Error(`config fetch failed: ${resp.status}`);
        const cfg = await resp.json();
        return {
            size: positiveInt(cfg.size, DEFAULT_SIZE),
            interval: positiveInt(cfg.interval, DEFAULT_INTERVAL)
        };
    } catch (e) {
        console.error('Failed to load runtime config, using defaults', e);
        return { size: DEFAULT_SIZE, interval: DEFAULT_INTERVAL };
    }
}

async function init() {
    const { size, interval } = await loadConfig();
    const valueEl = document.getElementById('value');

    async function graphTemp() {
        let temperature = null;
        try {
            const res = await fetch(apiBase);
            const body = await res.json();
            if (typeof body.temp === 'number') {
                temperature = body.temp;
            }
        } catch (e) {
            console.error('Failed to fetch temperature', e);
        }
        // null leaves a gap in the line for failed polls
        const currentTime = new Date();
        data.labels.push(currentTime.toLocaleString(undefined, { minute: 'numeric', second: 'numeric' }));
        data.datasets[0].data.push(temperature);
        while (data.labels.length > size) {
            data.labels.shift();
            data.datasets[0].data.shift();
        }
        chart.update();
        if (valueEl) {
            valueEl.textContent = temperature === null ? ' --' : temperature;
        }
    }

    graphTemp();
    setInterval(graphTemp, interval);
}

init();
