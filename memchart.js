import Chart from 'chart.js/auto';
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