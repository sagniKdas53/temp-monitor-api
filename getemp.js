function getTemp() {
    fetch(__URL__)
        .then(res => res.json())
        .then(temp => document.getElementById('value').innerHTML = temp.temp);
    if (__INTERVAL__ > 1000)
        setTimeout(() => { getTemp(); }, __INTERVAL__);
};

getTemp();