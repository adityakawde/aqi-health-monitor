/**
 * Urban Pollution & Human Health Monitor — script.js
 *
 * Features:
 *  • Browser geolocation → fetch AQI
 *  • City name search (geocoding → AQI)
 *  • Signal-color AQI display with animated ring
 *  • Health recommendations & tips
 *  • Pollutant breakdown bars
 *  • AQI history mini-chart (Chart.js)
 *  • Leaflet pollution map with marker
 */

"use strict";

/* ─────────────────────────────────────────
   CONFIG
───────────────────────────────────────── */
const API_KEY = "b871b4234c3395d1b1321ebf4148e3c7";
const OWM_BASE = "https://api.openweathermap.org";

/* ─────────────────────────────────────────
   AQI LEVEL DEFINITIONS
   OpenWeatherMap returns AQI 1–5:
   1=Good, 2=Fair, 3=Moderate, 4=Poor, 5=Very Poor
───────────────────────────────────────── */
const AQI_LEVELS = {
  1: {
    label:    "Good",
    cssClass: "aqi-good",
    color:    "#3dd68c",
    icon:     "🌿",
    message:  "Air quality is excellent. It's a perfect day for outdoor activities — breathe easy!",
    tips:     ["Safe for all outdoor activities", "Open windows for fresh air", "Great day for exercise"],
  },
  2: {
    label:    "Fair",
    cssClass: "aqi-moderate",
    color:    "#f5c842",
    icon:     "☀️",
    message:  "Air quality is acceptable. Very sensitive individuals may experience minor discomfort.",
    tips:     ["Generally safe outdoors", "Sensitive groups limit prolonged exertion", "Monitor symptoms if asthmatic"],
  },
  3: {
    label:    "Moderate",
    cssClass: "aqi-sensitive",
    color:    "#ff8c42",
    icon:     "😷",
    message:  "Unhealthy for sensitive groups. People with respiratory or heart conditions should reduce outdoor exertion.",
    tips:     ["Wear a mask if going out", "Reduce outdoor exercise duration", "Keep windows closed", "Use air purifiers indoors"],
  },
  4: {
    label:    "Poor",
    cssClass: "aqi-unhealthy",
    color:    "#e84545",
    icon:     "⚠️",
    message:  "Air quality is poor. Everyone may experience health effects. Limit outdoor activities.",
    tips:     ["Wear N95/KN95 mask outdoors", "Avoid outdoor exercise", "Keep all windows shut", "Stay hydrated", "Seek medical advice if symptomatic"],
  },
  5: {
    label:    "Very Poor",
    cssClass: "aqi-very",
    color:    "#b44fff",
    icon:     "🚨",
    message:  "Very poor air quality. Health alert — everyone should avoid outdoor exposure. Stay indoors.",
    tips:     ["Stay indoors with windows sealed", "Use air purifier on max", "Wear a mask even indoors if possible", "Avoid any physical exertion", "Seek medical help if breathing is difficult"],
  },
};

/* ─────────────────────────────────────────
   POLLUTANT METADATA
───────────────────────────────────────── */
const POLLUTANT_INFO = {
  co:    { name: "CO — Carbon Monoxide",      unit: "µg/m³", max: 15400 },
  no:    { name: "NO — Nitric Oxide",         unit: "µg/m³", max: 200   },
  no2:   { name: "NO₂ — Nitrogen Dioxide",   unit: "µg/m³", max: 200   },
  o3:    { name: "O₃ — Ozone",               unit: "µg/m³", max: 240   },
  so2:   { name: "SO₂ — Sulfur Dioxide",     unit: "µg/m³", max: 500   },
  pm2_5: { name: "PM2.5 — Fine Particles",   unit: "µg/m³", max: 75    },
  pm10:  { name: "PM10 — Coarse Particles",  unit: "µg/m³", max: 150   },
  nh3:   { name: "NH₃ — Ammonia",           unit: "µg/m³", max: 200   },
};

/* ─────────────────────────────────────────
   STATE
───────────────────────────────────────── */
let mapInstance     = null;  // Leaflet map
let mapMarker       = null;  // Leaflet marker
let aqiChart        = null;  // Chart.js instance
let aqiHistory      = [];    // Rolling array of { label, value, color }

/* ─────────────────────────────────────────
   DOM REFERENCES
───────────────────────────────────────── */
const $ = id => document.getElementById(id);
const locationBtn    = $("locationBtn");
const searchBtn      = $("searchBtn");
const cityInput      = $("cityInput");
const statusMsg      = $("statusMsg");
const resultsSection = $("resultsSection");
const lastUpdated    = $("lastUpdated");

const locationName   = $("locationName");
const coordsText     = $("coordsText");
const aqiScore       = $("aqiScore");
const aqiRingFill    = $("aqiRingFill");
const aqiBadge       = $("aqiBadge");
const aqiCategory    = $("aqiCategory");
const healthIcon     = $("healthIcon");
const healthMsg      = $("healthMsg");
const healthTips     = $("healthTips");
const pollutantsList = $("pollutantsList");

/* ─────────────────────────────────────────
   EVENT LISTENERS
───────────────────────────────────────── */

/** "Check AQI Around Me" — uses browser geolocation */
locationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("❌ Geolocation is not supported by your browser.", "error");
    return;
  }
  setStatus("Detecting your location…", "loading");
  navigator.geolocation.getCurrentPosition(
    position => {
      const { latitude, longitude } = position.coords;
      fetchAQI(latitude, longitude, "Your Location");
    },
    err => {
      setStatus(`❌ Location access denied: ${err.message}`, "error");
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

/** "Search City" button */
searchBtn.addEventListener("click", searchCity);

/** Allow pressing Enter in the input */
cityInput.addEventListener("keydown", e => {
  if (e.key === "Enter") searchCity();
});

/* ─────────────────────────────────────────
   CITY GEOCODING → AQI
───────────────────────────────────────── */
async function searchCity() {
  const city = cityInput.value.trim();
  if (!city) {
    setStatus("Please enter a city name.", "");
    return;
  }
  setStatus(`Searching for "${city}"…`, "loading");

  try {
    // Use OWM Geocoding API to get lat/lon
    const geoURL = `${OWM_BASE}/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${API_KEY}`;
    const geoRes = await fetch(geoURL);
    if (!geoRes.ok) throw new Error(`Geocoding API error: ${geoRes.status}`);
    const geoData = await geoRes.json();

    if (!geoData.length) {
      setStatus(`❌ City "${city}" not found. Try another name.`, "error");
      return;
    }

    const { lat, lon, name, country, state } = geoData[0];
    const displayName = state ? `${name}, ${state}, ${country}` : `${name}, ${country}`;
    fetchAQI(lat, lon, displayName);

  } catch (err) {
    console.error(err);
    setStatus(`❌ Error: ${err.message}`, "error");
  }
}

/* ─────────────────────────────────────────
   FETCH AQI FROM OPENWEATHERMAP
───────────────────────────────────────── */
async function fetchAQI(lat, lon, label) {
  setStatus("Fetching air quality data…", "loading");

  try {
    const aqiURL = `${OWM_BASE}/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`;
    const res    = await fetch(aqiURL);
    if (!res.ok) throw new Error(`AQI API error: ${res.status}`);
    const data   = await res.json();

    if (!data.list || !data.list.length) {
      throw new Error("No AQI data returned for this location.");
    }

    const record     = data.list[0];
    const aqiValue   = record.main.aqi;       // 1–5
    const components = record.components;     // individual pollutants

    // Clear status
    setStatus("", "");

    // Render everything
    renderLocation(lat, lon, label);
    renderAQI(aqiValue);
    renderHealth(aqiValue);
    renderPollutants(components);
    updateHistory(aqiValue, label);
    renderChart();
    renderMap(lat, lon, aqiValue);

    // Show results
    resultsSection.classList.remove("hidden");
    lastUpdated.classList.remove("hidden");
    lastUpdated.textContent = `Last updated: ${new Date().toLocaleString()}`;

  } catch (err) {
    console.error(err);
    setStatus(`❌ Failed to load AQI data: ${err.message}`, "error");
  }
}

/* ─────────────────────────────────────────
   RENDER HELPERS
───────────────────────────────────────── */

/** Show status / loading message */
function setStatus(msg, type) {
  statusMsg.textContent = msg;
  statusMsg.className   = "status-msg" + (type ? ` ${type}` : "");
}

/** Location card */
function renderLocation(lat, lon, label) {
  locationName.textContent = label;
  coordsText.textContent   = `${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E`;
}

/** AQI ring + badge */
function renderAQI(aqiValue) {
  const info        = AQI_LEVELS[aqiValue];
  const circumference = 2 * Math.PI * 50; // r=50 → ~314

  // Animated ring (map 1–5 to 20%–100%)
  const pct    = ((aqiValue - 1) / 4) * 0.8 + 0.2;
  const offset = circumference * (1 - pct);

  aqiRingFill.style.stroke          = info.color;
  aqiRingFill.style.strokeDasharray = circumference;
  aqiRingFill.style.strokeDashoffset = offset;

  aqiScore.textContent   = aqiValue;
  aqiScore.style.color   = info.color;
  aqiBadge.textContent   = info.label;

  // Badge colors
  aqiBadge.style.color       = info.color;
  aqiBadge.style.background  = `${info.color}18`;
  aqiBadge.style.borderColor = `${info.color}40`;

  aqiCategory.textContent = `Index level ${aqiValue} of 5`;

  // Body class for ambient color shifting
  document.body.className = info.cssClass;
}

/** Health advisory */
function renderHealth(aqiValue) {
  const info        = AQI_LEVELS[aqiValue];
  healthIcon.textContent = info.icon;
  healthMsg.textContent  = info.message;

  healthTips.innerHTML = "";
  info.tips.forEach(tip => {
    const el      = document.createElement("span");
    el.className  = "health-tip";
    el.textContent = tip;
    healthTips.appendChild(el);
  });
}

/** Pollutant breakdown bars */
function renderPollutants(components) {
  pollutantsList.innerHTML = "";

  Object.entries(POLLUTANT_INFO).forEach(([key, meta]) => {
    const value = components[key] ?? 0;
    const pct   = Math.min((value / meta.max) * 100, 100);

    // Bar color based on percentage
    let barColor = "#3dd68c";
    if      (pct > 80) barColor = "#b44fff";
    else if (pct > 60) barColor = "#e84545";
    else if (pct > 40) barColor = "#ff8c42";
    else if (pct > 20) barColor = "#f5c842";

    const row = document.createElement("div");
    row.className = "pollutant-row";
    row.innerHTML = `
      <span class="pollutant-name">${meta.name}</span>
      <span class="pollutant-value">${value.toFixed(2)} ${meta.unit}</span>
      <div class="pollutant-bar-wrap">
        <div class="pollutant-bar" style="width:0; background:${barColor}" data-pct="${pct}"></div>
      </div>
    `;
    pollutantsList.appendChild(row);
  });

  // Animate bars after paint
  requestAnimationFrame(() => {
    document.querySelectorAll(".pollutant-bar").forEach(bar => {
      bar.style.width = bar.dataset.pct + "%";
    });
  });
}

/* ─────────────────────────────────────────
   AQI HISTORY CHART (Chart.js)
───────────────────────────────────────── */

/** Keep a rolling history of up to 8 readings */
function updateHistory(aqiValue, label) {
  const info    = AQI_LEVELS[aqiValue];
  const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const tag     = label.split(",")[0]; // first word of city

  aqiHistory.push({
    label: `${tag} ${timeStr}`,
    value: aqiValue,
    color: info.color,
  });
  if (aqiHistory.length > 8) aqiHistory.shift();
}

/** Draw / update Chart.js chart */
function renderChart() {
  const ctx    = $("aqiChart").getContext("2d");
  const labels = aqiHistory.map(h => h.label);
  const values = aqiHistory.map(h => h.value);
  const colors = aqiHistory.map(h => h.color);

  if (aqiChart) {
    // Update existing chart
    aqiChart.data.labels         = labels;
    aqiChart.data.datasets[0].data           = values;
    aqiChart.data.datasets[0].pointBackgroundColor = colors;
    aqiChart.data.datasets[0].borderColor    = colors[colors.length - 1];
    aqiChart.update();
    return;
  }

  // Create chart
  aqiChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label:                "AQI Level",
        data:                 values,
        borderColor:          colors[colors.length - 1],
        pointBackgroundColor: colors,
        pointRadius:          6,
        pointHoverRadius:     9,
        borderWidth:          2.5,
        fill:                 true,
        backgroundColor:      "rgba(255,180,60,0.06)",
        tension:              0.45,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const lvl  = ctx.parsed.y;
              const info = AQI_LEVELS[lvl] || {};
              return ` AQI ${lvl} — ${info.label || ""}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#4a4d58", font: { size: 10 } },
          grid:  { color: "rgba(255,255,255,0.04)" },
        },
        y: {
          min:   0, max: 5, ticks: {
            stepSize:  1, color: "#4a4d58", font: { size: 11 },
            callback: v => ["", "Good", "Fair", "Moderate", "Poor", "Very Poor"][v] || v,
          },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
      },
    },
  });
}

/* ─────────────────────────────────────────
   LEAFLET MAP
───────────────────────────────────────── */
function renderMap(lat, lon, aqiValue) {
  const info = AQI_LEVELS[aqiValue];

  if (!mapInstance) {
    // Initialize map
    mapInstance = L.map("leafletMap", {
      zoomControl:        true,
      scrollWheelZoom:    false,
      attributionControl: true,
    }).setView([lat, lon], 11);

    // Dark tile layer from CartoDB
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CartoDB</a>',
      subdomains:  "abcd",
      maxZoom:     19,
    }).addTo(mapInstance);

    // OWM Air pollution tile overlay
    L.tileLayer(
      `https://tile.openweathermap.org/map/PM2_5/{z}/{x}/{y}.png?appid=${API_KEY}`,
      { opacity: 0.55, attribution: "OWM Air Pollution" }
    ).addTo(mapInstance);
  } else {
    mapInstance.setView([lat, lon], 11);
    if (mapMarker) mapMarker.remove();
  }

  // Custom colored marker
  const markerHtml = `
    <div style="
      width:20px; height:20px; border-radius:50%;
      background:${info.color};
      border:3px solid #fff;
      box-shadow:0 0 14px ${info.color};
    "></div>`;

  const icon = L.divIcon({
    html:      markerHtml,
    className: "",
    iconSize:  [20, 20],
    iconAnchor:[10, 10],
  });

  mapMarker = L.marker([lat, lon], { icon })
    .addTo(mapInstance)
    .bindPopup(`<b>AQI: ${aqiValue} — ${info.label}</b><br>${info.message}`)
    .openPopup();
}
