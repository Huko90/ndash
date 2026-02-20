(function() {
var $ = App.$;

// === STATE ===
var active = false;
var weatherLoaded = false;
var weatherLat = null, weatherLon = null;
var weatherData = null;
var selectedDayIndex = 0;
var intervals = [];
var defaultWeather = { name: 'Dundee, UK', lat: 56.4620, lon: -2.9707 };
var weatherConfig = {};
var weatherApiBase = 'https://api.open-meteo.com/v1/forecast';
var weatherApiFallbackBases = [];
var reverseGeoBase = 'https://nominatim.openstreetmap.org/reverse';
var weatherRefreshMs = 600000;
var prevTemp = null;

// === ELEMENT REFS ===
var weatherLocation = $('weatherLocation');
var weatherTemp = $('weatherTemp');
var weatherIcon = $('weatherIcon');
var weatherDesc = $('weatherDesc');
var weatherFeels = $('weatherFeels');
var wsHumidity = $('wsHumidity');
var wsWind = $('wsWind');
var wsWindDir = $('wsWindDir');
var wsPressure = $('wsPressure');
var wsVisibility = $('wsVisibility');
var wsSunrise = $('wsSunrise');
var wsSunset = $('wsSunset');
var wsUV = $('wsUV');
var todayMarker = $('todayMarker');
var todayLow = $('todayLow');
var todayHigh = $('todayHigh');
var hourlyScroll = $('hourlyScroll');
var forecastGrid = $('forecastGrid');
var dayDetailTitle = $('dayDetailTitle');
var dayDetailIcon = $('dayDetailIcon');
var dayDetailDay = $('dayDetailDay');
var dayDetailDesc = $('dayDetailDesc');
var dayDetailHigh = $('dayDetailHigh');
var dayDetailLow = $('dayDetailLow');
var dayDetailSunrise = $('dayDetailSunrise');
var dayDetailSunset = $('dayDetailSunset');
var dayDetailUV = $('dayDetailUV');
var dayDetailRain = $('dayDetailRain');
var dayDetailWind = $('dayDetailWind');
var dayDetailHumidity = $('dayDetailHumidity');
var dayDetailSummary = $('dayDetailSummary');
var dayDetailPressure = $('dayDetailPressure');
var dayDetailVisibility = $('dayDetailVisibility');

// === WEATHER CODES ===
var weatherCodes = {
    0:{icon:'☀️',desc:'Clear sky'},
    1:{icon:'🌤️',desc:'Mainly clear'},
    2:{icon:'⛅',desc:'Partly cloudy'},
    3:{icon:'☁️',desc:'Overcast'},
    45:{icon:'🌫️',desc:'Foggy'},
    48:{icon:'🌫️',desc:'Depositing rime fog'},
    51:{icon:'🌧️',desc:'Light drizzle'},
    53:{icon:'🌧️',desc:'Moderate drizzle'},
    55:{icon:'🌧️',desc:'Dense drizzle'},
    56:{icon:'🌨️',desc:'Freezing drizzle'},
    57:{icon:'🌨️',desc:'Dense freezing drizzle'},
    61:{icon:'🌧️',desc:'Slight rain'},
    63:{icon:'🌧️',desc:'Moderate rain'},
    65:{icon:'🌧️',desc:'Heavy rain'},
    66:{icon:'🌨️',desc:'Freezing rain'},
    67:{icon:'🌨️',desc:'Heavy freezing rain'},
    71:{icon:'🌨️',desc:'Slight snow'},
    73:{icon:'🌨️',desc:'Moderate snow'},
    75:{icon:'❄️',desc:'Heavy snow'},
    77:{icon:'🌨️',desc:'Snow grains'},
    80:{icon:'🌦️',desc:'Slight showers'},
    81:{icon:'🌦️',desc:'Moderate showers'},
    82:{icon:'⛈️',desc:'Violent showers'},
    85:{icon:'🌨️',desc:'Slight snow showers'},
    86:{icon:'🌨️',desc:'Heavy snow showers'},
    95:{icon:'⛈️',desc:'Thunderstorm'},
    96:{icon:'⛈️',desc:'Thunderstorm with hail'},
    99:{icon:'⛈️',desc:'Thunderstorm with heavy hail'}
};

// === UTILS ===
function getWeatherInfo(code) {
    return weatherCodes[code] || {icon:'❓', desc:'Unknown'};
}

function windDirection(deg) {
    var dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
}

function tempColor(temp) {
    if (temp >= 30) return '#ef4444';
    if (temp >= 25) return '#f97316';
    if (temp >= 20) return '#eab308';
    if (temp >= 15) return '#22c55e';
    if (temp >= 10) return '#06b6d4';
    if (temp >= 5) return '#3b82f6';
    if (temp >= 0) return '#6366f1';
    return '#8b5cf6';
}

function animateValue(el, from, to, suffix, durationMs) {
    if (from === to) { el.textContent = to + (suffix || ''); return; }
    var start = performance.now();
    var dur = durationMs || 400;
    function step(now) {
        var t = Math.min((now - start) / dur, 1);
        t = t * (2 - t); // ease-out
        el.textContent = Math.round(from + (to - from) * t) + (suffix || '');
        if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function formatTime(isoStr) {
    var d = new Date(isoStr);
    return d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
}

function getDayName(isoStr, short) {
    var d = new Date(isoStr);
    var days = short ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] : ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return days[d.getDay()];
}

// === FETCH LOCATION NAME ===
function fetchLocationName(lat, lon) {
    fetch(reverseGeoBase + '?lat=' + lat + '&lon=' + lon + '&format=json')
    .then(function(r) { return r.json(); })
    .then(function(data) {
        var city = data.address.city || data.address.town || data.address.village || data.address.municipality || 'Unknown';
        var country = data.address.country_code ? data.address.country_code.toUpperCase() : '';
        weatherLocation.innerHTML = '<span class="dot"></span>' + App.escapeHTML(city) + (country ? ', ' + App.escapeHTML(country) : '');
    }).catch(function() {
        weatherLocation.innerHTML = '<span class="dot"></span>' + lat.toFixed(2) + '°, ' + lon.toFixed(2) + '°';
    });
}

function syncWeatherConfig() {
    weatherConfig = (window.BTCT_CONFIG && window.BTCT_CONFIG.weather) || {};
    weatherApiBase = weatherConfig.apiBase || 'https://api.open-meteo.com/v1/forecast';
    weatherApiFallbackBases = Array.isArray(weatherConfig.apiFallbackBases) ? weatherConfig.apiFallbackBases.slice(0, 3) : [];
    reverseGeoBase = weatherConfig.reverseGeocodeBase || 'https://nominatim.openstreetmap.org/reverse';
    weatherRefreshMs = weatherConfig.refreshMs || 600000;
}

function fetchWeatherFromBases(urlSuffix, idx) {
    var bases = [weatherApiBase].concat(weatherApiFallbackBases || []);
    idx = idx || 0;
    if (idx >= bases.length) return Promise.reject(new Error('weather_all_sources_failed'));
    var base = String(bases[idx] || '').trim();
    if (!base) return fetchWeatherFromBases(urlSuffix, idx + 1);
    return fetch(base + urlSuffix)
    .then(function(r) {
        if (!r.ok) throw new Error('weather_http_' + r.status);
        return r.json();
    })
    .catch(function() {
        return fetchWeatherFromBases(urlSuffix, idx + 1);
    });
}

// === FETCH WEATHER ===
function fetchWeather() {
    if (weatherLat === null || weatherLon === null) return;
    if (document.hidden) return;

    var url = '?latitude=' + weatherLat + '&longitude=' + weatherLon;
    url += '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure';
    url += '&hourly=temperature_2m,weather_code,precipitation_probability';
    url += '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,wind_speed_10m_max,relative_humidity_2m_mean';
    url += '&timezone=auto&forecast_days=7';

    fetchWeatherFromBases(url, 0)
    .then(function(data) {
        weatherData = data;

        // Current weather
        var cur = data.current;
        var info = getWeatherInfo(cur.weather_code);
        var curTemp = Math.round(cur.temperature_2m);
        if (prevTemp !== null && prevTemp !== curTemp) {
            animateValue(weatherTemp, prevTemp, curTemp, '');
        } else {
            weatherTemp.textContent = curTemp;
        }
        prevTemp = curTemp;
        weatherTemp.style.color = tempColor(curTemp);
        weatherIcon.textContent = info.icon;
        weatherDesc.textContent = info.desc;
        var feelsTemp = Math.round(cur.apparent_temperature);
        weatherFeels.innerHTML = 'Feels like <span style="color:' + tempColor(feelsTemp) + '">' + feelsTemp + '°C</span>';
        wsHumidity.textContent = cur.relative_humidity_2m + '%';
        wsWind.textContent = Math.round(cur.wind_speed_10m) + ' km/h';
        wsWindDir.textContent = windDirection(cur.wind_direction_10m);
        wsPressure.textContent = Math.round(cur.surface_pressure) + ' hPa';
        var vis = cur.weather_code <= 3 ? '10+ km' : cur.weather_code <= 48 ? '2-5 km' : '<2 km';
        wsVisibility.textContent = vis;
        if (active) App.setTitle(info.icon + ' ' + curTemp + '\u00b0C');

        // Daily data (today)
        var daily = data.daily;
        wsSunrise.textContent = formatTime(daily.sunrise[0]);
        wsSunset.textContent = formatTime(daily.sunset[0]);
        wsUV.textContent = daily.uv_index_max[0].toFixed(1);

        var tLow = Math.round(daily.temperature_2m_min[0]);
        var tHigh = Math.round(daily.temperature_2m_max[0]);
        todayLow.textContent = tLow + '°';
        todayHigh.textContent = tHigh + '°';

        var curT = cur.temperature_2m;
        var pct = ((curT - tLow) / (tHigh - tLow)) * 100;
        pct = Math.max(0, Math.min(100, pct));
        todayMarker.style.left = pct + '%';

        // Hourly forecast (next 24 hours)
        var hourly = data.hourly;
        var nowHour = new Date().getHours();
        var html = '';
        for (var i = 0; i < 24; i++) {
            var idx = nowHour + i;
            if (idx >= hourly.time.length) break;
            var t = new Date(hourly.time[idx]);
            var hInfo = getWeatherInfo(hourly.weather_code[idx]);
            var precip = hourly.precipitation_probability[idx] || 0;
            var hTemp = Math.round(hourly.temperature_2m[idx]);
            html += '<div class="hourly-item">';
            html += '<div class="hourly-time">' + (i === 0 ? 'Now' : t.getHours().toString().padStart(2, '0') + ':00') + '</div>';
            html += '<div class="hourly-icon">' + hInfo.icon + '</div>';
            html += '<div class="hourly-temp" style="color:' + tempColor(hTemp) + '">' + hTemp + '°</div>';
            if (precip > 0) html += '<div class="hourly-precip">' + precip + '%</div>';
            html += '</div>';
        }
        hourlyScroll.innerHTML = html;

        // 7-day forecast
        html = '';
        for (var i = 0; i < 7; i++) {
            var dInfo = getWeatherInfo(daily.weather_code[i]);
            var dayName = i === 0 ? 'Today' : getDayName(daily.time[i], true);
            var precip = daily.precipitation_probability_max[i] || 0;
            var activeClass = i === selectedDayIndex ? ' active' : '';
            var dHigh = Math.round(daily.temperature_2m_max[i]);
            var dLow = Math.round(daily.temperature_2m_min[i]);
            html += '<div class="forecast-day' + activeClass + '" data-day="' + i + '">';
            html += '<div class="fd-name">' + dayName + '</div>';
            html += '<div class="fd-icon">' + dInfo.icon + '</div>';
            html += '<div class="fd-temps">';
            html += '<div class="fd-high" style="color:' + tempColor(dHigh) + '">' + dHigh + '°</div>';
            html += '<div class="fd-low" style="color:' + tempColor(dLow) + '">' + dLow + '°</div>';
            html += '</div>';
            if (precip > 0) html += '<div class="fd-precip">💧' + precip + '%</div>';
            html += '</div>';
        }
        forecastGrid.innerHTML = html;

        // Add click handlers to forecast days
        forecastGrid.querySelectorAll('.forecast-day').forEach(function(dayEl) {
            dayEl.addEventListener('click', function() {
                var dayIdx = parseInt(dayEl.dataset.day);
                selectDay(dayIdx);
            });
        });

        // Update day detail panel
        updateDayDetail(selectedDayIndex);

        weatherLoaded = true;
        App.setSourceStatus('weather', true);
        App.touchSection('weather');
        App.setLive(true, 'Updated');

        // Cache current weather for instant display on next load
        App.setSetting('weatherCache', {
            curTemp: curTemp, feelsTemp: feelsTemp, icon: info.icon, desc: info.desc,
            humidity: cur.relative_humidity_2m, wind: Math.round(cur.wind_speed_10m),
            windDir: windDirection(cur.wind_direction_10m), pressure: Math.round(cur.surface_pressure),
            lat: weatherLat, lon: weatherLon, ts: Date.now()
        });
    }).catch(function(e) {
        App.setSourceStatus('weather', false);
        console.error('Weather fetch error:', e);
        weatherDesc.textContent = 'Failed to load weather';
    });
}

// === SELECT DAY ===
function selectDay(dayIdx) {
    selectedDayIndex = dayIdx;
    forecastGrid.querySelectorAll('.forecast-day').forEach(function(el, i) {
        el.classList.toggle('active', i === dayIdx);
    });
    updateDayDetail(dayIdx);
}

// === UPDATE DAY DETAIL ===
function updateDayDetail(dayIdx) {
    if (!weatherData) return;
    var daily = weatherData.daily;
    var dInfo = getWeatherInfo(daily.weather_code[dayIdx]);
    var dayName = dayIdx === 0 ? 'Today' : getDayName(daily.time[dayIdx], false);
    var dHigh = Math.round(daily.temperature_2m_max[dayIdx]);
    var dLow = Math.round(daily.temperature_2m_min[dayIdx]);
    var rain = daily.precipitation_probability_max[dayIdx] || 0;
    var wind = Math.round(daily.wind_speed_10m_max[dayIdx]);
    var uv = daily.uv_index_max[dayIdx];

    dayDetailTitle.textContent = dayName + "'s Details";
    dayDetailIcon.textContent = dInfo.icon;
    dayDetailDay.textContent = dayName;
    dayDetailDesc.textContent = dInfo.desc;
    dayDetailHigh.innerHTML = '↑ <span style="color:' + tempColor(dHigh) + '">' + dHigh + '°</span>';
    dayDetailLow.innerHTML = '↓ <span style="color:' + tempColor(dLow) + '">' + dLow + '°</span>';

    // Generate summary
    var summary = '';
    if (rain > 70) summary = 'Heavy rain expected. ';
    else if (rain > 40) summary = 'Possible rain showers. ';
    else if (rain > 10) summary = 'Slight chance of rain. ';
    else summary = 'No rain expected. ';

    if (wind > 40) summary += 'Strong winds up to ' + wind + ' km/h. ';
    else if (wind > 20) summary += 'Moderate winds. ';
    else summary += 'Light winds. ';

    if (uv > 7) summary += 'Very high UV - protection essential.';
    else if (uv > 5) summary += 'High UV - use sun protection.';
    else if (uv > 3) summary += 'Moderate UV levels.';
    else summary += 'Low UV levels.';

    dayDetailSummary.textContent = summary;

    dayDetailSunrise.textContent = formatTime(daily.sunrise[dayIdx]);
    dayDetailSunset.textContent = formatTime(daily.sunset[dayIdx]);
    dayDetailUV.textContent = uv.toFixed(1);
    dayDetailRain.textContent = rain + '%';
    dayDetailWind.textContent = wind + ' km/h';
    dayDetailHumidity.textContent = Math.round(daily.relative_humidity_2m_mean[dayIdx]) + '%';

    if (dayIdx === 0 && weatherData.current) {
        dayDetailPressure.textContent = Math.round(weatherData.current.surface_pressure) + ' hPa';
        var vis = weatherData.current.weather_code <= 3 ? '10+ km' : weatherData.current.weather_code <= 48 ? '5-10 km' : '<5 km';
        dayDetailVisibility.textContent = vis;
    } else {
        dayDetailPressure.textContent = '~1013 hPa';
        var vis = daily.weather_code[dayIdx] <= 3 ? '10+ km' : daily.weather_code[dayIdx] <= 48 ? '5-10 km' : '<5 km';
        dayDetailVisibility.textContent = vis;
    }
}

// === INIT / DESTROY ===
function init() {
    active = true;
    syncWeatherConfig();

    weatherLat = typeof weatherConfig.lat === 'number' ? weatherConfig.lat : defaultWeather.lat;
    weatherLon = typeof weatherConfig.lon === 'number' ? weatherConfig.lon : defaultWeather.lon;
    var weatherName = weatherConfig.name || defaultWeather.name;
    weatherLocation.innerHTML = '<span class="dot"></span>' + App.escapeHTML(weatherName);

    // Loading placeholders
    weatherTemp.textContent = '--';
    weatherIcon.textContent = '';
    weatherDesc.textContent = 'Loading\u2026';
    weatherFeels.textContent = '';
    hourlyScroll.innerHTML = '<span class="loading-text">Loading\u2026</span>';
    forecastGrid.innerHTML = '<span class="loading-text">Loading\u2026</span>';

    // Restore cached weather for instant display
    var cached = App.getSetting('weatherCache', null);
    if (cached && cached.ts && Date.now() - cached.ts < 3600000 &&
        Math.abs((cached.lat || 0) - weatherLat) < 0.01 && Math.abs((cached.lon || 0) - weatherLon) < 0.01) {
        weatherTemp.textContent = cached.curTemp;
        weatherTemp.style.color = tempColor(cached.curTemp);
        prevTemp = cached.curTemp;
        weatherIcon.textContent = cached.icon || '';
        weatherDesc.textContent = cached.desc || '';
        var ft = cached.feelsTemp;
        weatherFeels.innerHTML = 'Feels like <span style="color:' + tempColor(ft) + '">' + ft + '°C</span>';
        if (cached.humidity) wsHumidity.textContent = cached.humidity + '%';
        if (cached.wind) wsWind.textContent = cached.wind + ' km/h';
        if (cached.windDir) wsWindDir.textContent = cached.windDir;
        if (cached.pressure) wsPressure.textContent = cached.pressure + ' hPa';
    }

    fetchWeather();

    // Refresh weather every 10 minutes
    intervals.push(setInterval(function() {
        if (!document.hidden) fetchWeather();
    }, weatherRefreshMs));

    document.addEventListener('visibilitychange', onDocVisibilityChange);
    App.setLive(true, 'Weather');
}

var onDocVisibilityChange = function() {
    if (!active || document.hidden) return;
    fetchWeather();
};

function destroy() {
    active = false;
    intervals.forEach(clearInterval);
    intervals = [];
    document.removeEventListener('visibilitychange', onDocVisibilityChange);
}

// === REGISTER ===
App.registerDashboard('weather', {
    name: 'Weather Dashboard',
    icon: '☀',
    brandHTML: '<span>Weather</span> Dashboard',
    brandSub: weatherConfig.name || defaultWeather.name,
    orbColors: ['rgba(59,130,246,0.12)', 'rgba(6,182,212,0.08)'],
    logoGradient: 'linear-gradient(135deg,#3b82f6,#06b6d4)',
    containerId: 'weatherDash',
    init: init,
    destroy: destroy,
    syncConfig: syncWeatherConfig
});

})();
