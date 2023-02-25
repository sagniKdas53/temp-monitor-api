import Chart from 'chart.js/auto';
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

// Memory graph
const memdata = {
    labels: [
        'Available',
        'Free',
        'Used'
    ],
    datasets: [{
        label: 'Memory',
        data: [],
        backgroundColor: [
            'rgb(219, 120, 252)',
            'rgb(92, 133, 247)',
            'rgb(65, 239, 144)'
        ],
        hoverOffset: 2
    }]
};

const memconfig = {
    type: 'doughnut',
    data: memdata,
};

const memchart = new Chart(document.getElementById('memChart'), memconfig);

function graphMem() {
    fetch(__URL__ + '/meminfo')
        .then(res => res.json())
        .then(mem => {
            memdata.datasets[0].data = [mem.MemAvailable, mem.MemFree, mem.MemTotal - (mem.MemAvailable + mem.MemFree)];
            memchart.update();
        });
};

graphMem();

setInterval(graphMem, __INTERVAL__);