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

/*
    else if (get === "/meminfo") {
            fs.readFile("/proc/meminfo", 'utf8', (err, data) => {
                if (err) {
                    console.error("Error reading temp: " + err.message);
                    res.writeHead(500, json_header);
                    res.end(JSON.stringify({ meminfo: "NA" }));
                    if (mem_retries == max_retries) {
                        process.exit(1);
                    }
                    mem_retries++;
                }
                if (data) {
                    mem_retries = 0;
                    res.writeHead(200, json_header);
                    res.end(memToJSON(data));
                }
            });
        }
*/