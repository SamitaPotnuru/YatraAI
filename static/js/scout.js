/**
 * Scout Pro client: map, weather, chat (Groq), routing, nearby POIs.
 * API keys injected via window.__SCOUT_CONFIG__ from the server template.
 */
(function () {
    "use strict";

    const cfg = window.__SCOUT_CONFIG__ || {};
    const MASTER_GROQ_KEY =
        cfg.groqKey || (typeof localStorage !== "undefined" && localStorage.getItem("keys/groq")) || "";
    const WEATHER_KEY =
        cfg.weatherKey || (typeof localStorage !== "undefined" && localStorage.getItem("keys/weather")) || "";
    const GEMINI_API_KEY =
        cfg.geminiKey || (typeof localStorage !== "undefined" && localStorage.getItem("keys/gemini")) || "";

    const map = L.map("map").setView([17.385, 78.4867], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

    let routing = null;
    let userPos = null;
    let userCircle = null;
    let destinationCoords = null;
    const attractionMarkers = L.layerGroup().addTo(map);

    function invalidateMapAfterTheme() {
        setTimeout(function () {
            map.invalidateSize();
            if (userPos) {
                if (userCircle) userCircle.remove();
                userCircle = L.circle(userPos, { radius: 400, color: "#3b82f6" }).addTo(map);
            }
        }, 180);
    }

    function isLightMode() {
        return document.body.classList.contains("light-mode");
    }

    /** Button label = the mode you switch *to* when you click (clearer for screen readers). */
    function syncThemeToggle() {
        var btn = document.getElementById("themeToggle");
        if (!btn) return;
        if (isLightMode()) {
            btn.textContent = "Switch to dark mode";
            btn.setAttribute("aria-pressed", "true");
        } else {
            btn.textContent = "Switch to light mode";
            btn.setAttribute("aria-pressed", "false");
        }
    }

    function setTheme(light) {
        if (light) document.body.classList.add("light-mode");
        else document.body.classList.remove("light-mode");
        try {
            localStorage.setItem("theme_preference", light ? "light" : "dark");
        } catch (e) {
            /* ignore */
        }
        syncThemeToggle();
        invalidateMapAfterTheme();
    }

    try {
        const stored = localStorage.getItem("user_position");
        if (stored) {
            const p = JSON.parse(stored);
            if (p && p.lat && p.lon) {
                userPos = L.latLng(p.lat, p.lon);
                map.setView(userPos, 13);
                userCircle = L.circle(userPos, { radius: 400, color: "#3b82f6" }).addTo(map);
            }
        }
    } catch (e) {
        console.warn("Could not read stored user position", e);
    }

    async function findMe() {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            async function (pos) {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                userPos = L.latLng(lat, lon);
                map.setView(userPos, 14);
                if (userCircle) userCircle.remove();
                userCircle = L.circle(userPos, {
                    radius: 200,
                    color: "#3b82f6",
                    fillColor: "#3b82f6",
                    fillOpacity: 0.2,
                }).addTo(map);

                const startEl = document.getElementById("startLoc");
                if (startEl) startEl.value = "Current Location (GPS)";
                try {
                    localStorage.setItem("user_position", JSON.stringify({ lat: lat, lon: lon }));
                } catch (e) {
                    /* ignore */
                }

                try {
                    const res = await fetch(
                        "https://nominatim.openstreetmap.org/reverse?format=json&lat=" +
                            lat +
                            "&lon=" +
                            lon
                    );
                    const data = await res.json();
                    const cityName =
                        data.address.city ||
                        data.address.town ||
                        data.address.village ||
                        data.address.county ||
                        "";
                    if (cityName) {
                        document.getElementById("wSearch").value = cityName;
                        manualWeather();
                    }
                } catch (e) {
                    console.warn("Reverse geocode failed:", e);
                }
            },
            function (err) {
                console.error("GPS error:", err.message);
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    }

    findMe();

    try {
        setTheme(localStorage.getItem("theme_preference") === "light");
    } catch (e) {
        setTheme(false);
    }

    const themeBtn = document.getElementById("themeToggle");
    if (themeBtn) {
        themeBtn.addEventListener("click", function () {
            setTheme(!isLightMode());
        });
    }

    async function getCoords(query) {
        try {
            const res = await fetch(
                "https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(query)
            );
            const data = await res.json();
            return data.length > 0
                ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) }
                : null;
        } catch (e) {
            return null;
        }
    }

    window.findMe = findMe;

    window.runVision = async function () {
        const file = document.getElementById("imgInput").files[0];
        if (!file) {
            alert("Select an image.");
            return;
        }
        const btn = document.getElementById("vBtn");
        const output = document.getElementById("vOut");
        btn.disabled = true;
        btn.textContent = "Scanning...";
        output.classList.add("hidden");

        const formData = new FormData();
        formData.append("image", file);

        try {
            const response = await fetch("/predict", { method: "POST", body: formData });
            if (!response.ok) throw new Error("Server error");
            const data = await response.json();
            output.classList.remove("hidden");
            let text = "Found: " + data.prediction;
            if (data.engine) text += "\n" + data.engine;
            output.textContent = text;
            document.getElementById("endLoc").value = data.prediction;
            manualWeather();
        } catch (error) {
            console.error(error);
            output.classList.remove("hidden");
            output.textContent = "Server error. Check backend.";
        } finally {
            btn.disabled = false;
            btn.textContent = "Scan landmark";
        }
    };

    window.calculateRoute = async function () {
        const eStr = document.getElementById("endLoc").value;
        if (!eStr) return alert("Enter destination.");
        const sStr = document.getElementById("startLoc").value;
        const sCoords = sStr ? await getCoords(sStr) : userPos ? { lat: userPos.lat, lon: userPos.lng } : null;
        const eCoords = await getCoords(eStr);
        if (!sCoords || !eCoords) return alert("Location not found.");

        destinationCoords = eCoords;
        if (routing) map.removeControl(routing);
        routing = L.Routing.control({
            waypoints: [
                L.latLng(sCoords.lat, sCoords.lon),
                L.latLng(eCoords.lat, eCoords.lon),
            ],
            lineOptions: { styles: [{ color: "#3b82f6", weight: 6, opacity: 0.8 }] },
            createMarker: function () {
                return null;
            },
        })
            .on("routesfound", function (e) {
                const s = e.routes[0].summary;
                document.getElementById("routeBadge").classList.remove("hidden");
                document.getElementById("distVal").textContent = (s.totalDistance / 1000).toFixed(1) + " km";
                document.getElementById("timeVal").textContent = Math.round(s.totalTime / 60) + " min";
                map.fitBounds([
                    L.latLng(sCoords.lat, sCoords.lon),
                    L.latLng(eCoords.lat, eCoords.lon),
                ]);
            })
            .addTo(map);
    };

    window.manualWeather = async function () {
        const query = document.getElementById("wSearch").value.trim();
        if (!query) return;
        if (!WEATHER_KEY) {
            alert("Set OPENWEATHER_API_KEY in .env for weather.");
            return;
        }

        const display = document.getElementById("wDisplay");
        try {
            const geoRes = await fetch(
                "https://api.openweathermap.org/geo/1.0/direct?q=" +
                    encodeURIComponent(query) +
                    "&limit=1&appid=" +
                    WEATHER_KEY
            );
            const geoData = await geoRes.json();
            if (!geoData || geoData.length === 0) {
                alert("Could not locate this place.");
                return;
            }
            const row = geoData[0];
            const lat = row.lat;
            const lon = row.lon;
            const name = row.name;
            const country = row.country;
            const state = row.state;

            const weatherRes = await fetch(
                "https://api.openweathermap.org/data/2.5/weather?lat=" +
                    lat +
                    "&lon=" +
                    lon +
                    "&appid=" +
                    WEATHER_KEY +
                    "&units=metric"
            );
            const weatherData = await weatherRes.json();

            const iconEmoji = {
                "01d": "☀️",
                "01n": "🌙",
                "02d": "⛅",
                "02n": "☁️",
                "03d": "☁️",
                "03n": "☁️",
                "04d": "☁️",
                "04n": "☁️",
                "09d": "🌧️",
                "09n": "🌧️",
                "10d": "🌦️",
                "10n": "🌧️",
                "11d": "⛈️",
                "11n": "⛈️",
                "13d": "🌨️",
                "13n": "🌨️",
                "50d": "🌫️",
                "50n": "🌫️",
            };
            const icon = weatherData.weather[0].icon;

            document.getElementById("wIcon").innerHTML =
                '<span style="font-size:4rem;">' + (iconEmoji[icon] || "🌤️") + "</span>";
            document.getElementById("wCityName").textContent = name;
            document.getElementById("wStateName").textContent = (state ? state + ", " : "") + country;
            document.getElementById("wTemp").textContent = Math.round(weatherData.main.temp) + "°C";
            document.getElementById("wHumid").textContent = weatherData.main.humidity + "%";
            document.getElementById("wWind").textContent =
                Math.round(weatherData.wind.speed * 3.6) + " km/h";
            display.classList.remove("hidden");
            fetchWikiIntel(name);
        } catch (e) {
            console.error("Weather fetch failed", e);
        }
    };

    async function fetchWikiIntel(place) {
        try {
            const res = await fetch(
                "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(place)
            );
            const data = await res.json();
            if (data.extract) {
                document.getElementById("wWikiOut").classList.remove("hidden");
                document.getElementById("wWikiText").textContent = data.extract;
                document.getElementById("wWikiLink").href = data.content_urls.desktop.page;
            }
        } catch (e) {
            document.getElementById("wWikiOut").classList.add("hidden");
        }
    }

    window.runChat = async function () {
        const input = document.getElementById("chatInput");
        const message = input.value.trim();
        if (!message) return;
        if (!MASTER_GROQ_KEY) {
            alert("Set GROQ_API_KEY in .env for chat.");
            return;
        }

        const chatBox = document.getElementById("chatBox");

        var userRow = document.createElement("div");
        userRow.className = "chat-row chat-row--user";
        var userBubble = document.createElement("div");
        userBubble.className = "chat-bubble chat-bubble--user";
        userBubble.textContent = message;
        userRow.appendChild(userBubble);
        chatBox.appendChild(userRow);
        chatBox.scrollTop = chatBox.scrollHeight;
        input.value = "";
        input.disabled = true;

        var botRow = document.createElement("div");
        botRow.className = "chat-row";
        var botBubble = document.createElement("div");
        botBubble.className = "chat-bubble chat-bubble--bot chat-bubble--thinking";
        botBubble.textContent = "Thinking…";
        botRow.appendChild(botBubble);
        chatBox.appendChild(botRow);
        chatBox.scrollTop = chatBox.scrollHeight;

        try {
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: "Bearer " + MASTER_GROQ_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    messages: [
                        {
                            role: "system",
                            content:
                                "You are Scout AI, a helpful travel assistant. Keep responses concise and travel-focused.",
                        },
                        { role: "user", content: message },
                    ],
                    temperature: 0.7,
                    max_tokens: 500,
                }),
            });
            if (!response.ok) throw new Error("API error: " + response.status);
            const data = await response.json();
            const reply =
                (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
                "Sorry, I couldn't generate a response.";
            botBubble.classList.remove("chat-bubble--thinking");
            botBubble.textContent = reply;
        } catch (error) {
            console.error("Chat error:", error);
            botBubble.classList.remove("chat-bubble--bot", "chat-bubble--thinking");
            botBubble.classList.add("chat-bubble--error");
            botBubble.textContent = "Could not reach AI. Check your API key.";
        } finally {
            input.disabled = false;
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    };

    const queryMap = {
        beach: '["natural"="beach"]',
        temple: '["amenity"="place_of_worship"]["religion"="hindu"]',
        church: '["amenity"="place_of_worship"]["religion"="christian"]',
        hotel: '["tourism"="hotel"]',
        restaurant: '["amenity"="restaurant"]',
        park: '["leisure"="park"]',
        scenery: '["tourism"="viewpoint"]',
    };

    function setNearbyFilterActive(category) {
        document.querySelectorAll("[data-nearby-cat]").forEach(function (btn) {
            var on = btn.getAttribute("data-nearby-cat") === category;
            btn.classList.toggle("filter-btn--active", on);
            btn.setAttribute("aria-pressed", on ? "true" : "false");
        });
    }

    function wikiSearchUrl(title) {
        return "https://en.wikipedia.org/wiki/Special:Search?search=" + encodeURIComponent(title);
    }

    function osmSearchUrl(lat, lon) {
        return "https://www.openstreetmap.org/search?query=" + encodeURIComponent(lat + "," + lon);
    }

    function escapeHtmlAttr(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    var _wikiOpenInProgress = false;

    /** Open Wikipedia article if found, else Wikipedia search; unnamed places → OpenStreetMap search. */
    async function openReferenceForPlace(name, lat, lon) {
        if (_wikiOpenInProgress) return;
        _wikiOpenInProgress = true;
        var clean = (name || "").trim();
        var unnamed = !clean || /^unnamed\b/i.test(clean);
        try {
            if (unnamed) {
                window.open(osmSearchUrl(lat, lon), "_blank", "noopener,noreferrer");
                return;
            }
            var openUrl = wikiSearchUrl(clean);
            try {
                var res = await fetch(
                    "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(clean)
                );
                if (res.ok) {
                    var data = await res.json();
                    if (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page) {
                        openUrl = data.content_urls.desktop.page;
                    }
                }
            } catch (e) {
                /* keep search URL */
            }
            window.open(openUrl, "_blank", "noopener,noreferrer");
        } finally {
            _wikiOpenInProgress = false;
        }
    }

    function activateNearbyRow(row, listRoot) {
        if (!row || !listRoot.contains(row)) return;
        var enc = row.getAttribute("data-place-name");
        if (enc == null || enc === "") return;
        var name;
        try {
            name = decodeURIComponent(enc);
        } catch (e) {
            return;
        }
        var lat = parseFloat(row.getAttribute("data-lat"));
        var lon = parseFloat(row.getAttribute("data-lon"));
        if (isNaN(lat) || isNaN(lon)) return;
        map.setView([lat, lon], 15);
        openReferenceForPlace(name, lat, lon);
    }

    (function bindNearbyListOnce() {
        var lb = document.getElementById("listBody");
        if (!lb || lb.dataset.scoutNearbyBound === "1") return;
        lb.dataset.scoutNearbyBound = "1";
        lb.addEventListener(
            "click",
            function (ev) {
                var row = ev.target.closest(".attraction-item");
                if (!row || !lb.contains(row)) return;
                ev.preventDefault();
                ev.stopPropagation();
                if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
                activateNearbyRow(row, lb);
            },
            true
        );
        lb.addEventListener(
            "keydown",
            function (ev) {
                if (ev.key !== "Enter" && ev.key !== " ") return;
                var row = ev.target.closest(".attraction-item");
                if (!row || !lb.contains(row)) return;
                ev.preventDefault();
                ev.stopPropagation();
                activateNearbyRow(row, lb);
            },
            true
        );
    })();

    window.findNearby = async function (category) {
        const searchPoint = destinationCoords
            ? L.latLng(destinationCoords.lat, destinationCoords.lon)
            : map.getCenter();
        const radius = document.getElementById("radiusRange").value * 1000;
        const listPanel = document.getElementById("attractionList");
        const listBody = document.getElementById("listBody");

        attractionMarkers.clearLayers();
        listBody.innerHTML =
            '<div class="scout-msg-warn" style="animation: scout-pulse 1.2s ease-in-out infinite">Searching near destination…</div>';
        listPanel.classList.remove("hidden");

        const filter = queryMap[category];
        if (!filter) return;

        setNearbyFilterActive(category);

        const q =
            "[out:json];node(around:" +
            radius +
            "," +
            searchPoint.lat +
            "," +
            searchPoint.lng +
            ")" +
            filter +
            ";out;";

        try {
            const res = await fetch(
                "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(q)
            );
            const data = await res.json();
            listBody.innerHTML = "";

            if (!data.elements || data.elements.length === 0) {
                listBody.innerHTML = '<div class="scout-msg-muted">No results in this radius.</div>';
                return;
            }

            data.elements.forEach(function (el) {
                const latlng = L.latLng(el.lat, el.lon);
                const distance = (searchPoint.distanceTo(latlng) / 1000).toFixed(2);
                const name = (el.tags && el.tags.name) || "Unnamed " + category;
                const place = el.lat.toFixed(3) + ", " + el.lon.toFixed(3);

                var wUrl = wikiSearchUrl(name);
                var oUrl = osmSearchUrl(el.lat, el.lon);
                var safeName = escapeHtmlAttr(name);
                L.marker([el.lat, el.lon])
                    .bindPopup(
                        "<b style=\"color:#111\">" +
                            safeName +
                            "</b><br><span style=\"color:#555\">" +
                            distance +
                            " km</span><br>" +
                            '<a style="color:#0369a1;font-weight:600" href="' +
                            wUrl +
                            '" target="_blank" rel="noopener noreferrer">Wikipedia</a>' +
                            ' · <a style="color:#0369a1;font-weight:600" href="' +
                            oUrl +
                            '" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
                    )
                    .addTo(attractionMarkers);

                const item = document.createElement("div");
                item.className = "attraction-item cursor-pointer";
                item.setAttribute("role", "button");
                item.setAttribute("tabindex", "0");
                item.setAttribute("data-place-name", encodeURIComponent(name));
                item.setAttribute("data-lat", String(el.lat));
                item.setAttribute("data-lon", String(el.lon));
                item.innerHTML =
                    '<div class="flex-between">' +
                    "<div>" +
                    "<h4>" +
                    name +
                    "</h4>" +
                    '<p class="place-coords">' +
                    place +
                    "</p>" +
                    "</div>" +
                    '<div class="text-right">' +
                    '<span class="dist-val">' +
                    distance +
                    " km</span>" +
                    '<p class="dist-label">from target</p>' +
                    "</div>" +
                    "</div>";
                listBody.appendChild(item);
            });
            map.setView(searchPoint, 13);
        } catch (e) {
            listBody.innerHTML = '<div class="scout-msg-error">Connection error.</div>';
        }
    };
})();
