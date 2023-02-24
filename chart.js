import Chart from 'chart.js/auto';
// My code
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

function graphTemp() {
    fetch(__URL__)
        .then(res => res.json())
        .then(temp => {
            const currentTime = new Date();
            const temperature = temp.temp;
            const reading = { time: currentTime, temperature: temperature };
            data.labels.push(currentTime.toLocaleString(undefined, { minute: 'numeric', second: 'numeric' }));
            data.datasets[0].data.push(temperature);
            if (data.labels.length > __SIZE__) {
                data.labels.shift();
                data.datasets[0].data.shift();
            }
            chart.update();
            document.getElementById('value').innerHTML = temperature;
        });
};

graphTemp();

setInterval(graphTemp, __INTERVAL__);