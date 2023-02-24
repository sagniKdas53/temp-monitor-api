const call_back = process.env.interval || 999;
const protocol = process.env.protocol || 'http';
const host = process.env.host || 'localhost';
const port = process.env.port || 64567;
const url_base = process.env.base_url || "/temp";

if (process.env.hide_ports)
    url = `${protocol}://${host}${url_base}`;
else
    url = `${protocol}://${host}:${port}${url_base}`;

getTemp = () => {
    fetch(url)
        .then(res => res.json())
        .then(temp => document.getElementById('value').innerHTML = temp.temp);
    if (call_back > 1000)
        setTimeout(() => { getTemp(); }, call_back);
}; getTemp();

/*
This depending on code generation becomes

getTemp = () => {
    fetch('http://localhost:64567/temp')
        .then(res => res.json())
        .then(temp => document.getElementById('value').innerHTML = temp.temp);
    setTimeout(() => { getTemp(); }, 1001);
}; getTemp();


or 

getTemp = () => {
    fetch('http://localhost:64567/temp')
    .then(res => res.json())
    .then(temp => document.getElementById('value').innerHTML = temp.temp);
}; getTemp();

*/



