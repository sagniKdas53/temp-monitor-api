import { Chart, LinearScale, LineElement, PointElement } from 'chart.js/auto';

Chart.register(
    LinearScale,
    PointElement,
    LineElement,
);

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

// Fetch runtime config from /config endpoint (served by index.js).
// This replaces the build-time defines (__URL__, __SIZE__, __INTERVAL__)
// that previously required deployment-specific build args baked into the image.
async function init() {
    let apiUrl, size, interval;

    try {
        // The config endpoint is relative to the page's base URL
        const resp = await fetch('./config');
        if (!resp.ok) throw new Error(`config fetch failed: ${resp.status}`);
        const cfg = await resp.json();
        apiUrl = cfg.url;
        size = cfg.size;
        interval = cfg.interval;
    } catch (e) {
        console.error('Failed to load runtime config, using defaults', e);
        apiUrl = '/temp';
        size = 12;
        interval = 15000;
    }

    function graphTemp() {
        fetch(apiUrl)
            .then(res => res.json())
            .then(temp => {
                const currentTime = new Date();
                const temperature = temp.temp;
                data.labels.push(currentTime.toLocaleString(undefined, { minute: 'numeric', second: 'numeric' }));
                data.datasets[0].data.push(temperature);
                if (data.labels.length > size) {
                    data.labels.shift();
                    data.datasets[0].data.shift();
                }
                chart.update();
                document.getElementById('value').innerHTML = temperature;
            });
    }

    graphTemp();
    setInterval(graphTemp, interval);
}

init();