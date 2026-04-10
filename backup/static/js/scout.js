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
        const themeColor = getComputedStyle(document.body).getPropertyValue("--primary").trim() || "#3b82f6";
        setTimeout(function () {
            map.invalidateSize();
            if (userPos) {
                if (userCircle) userCircle.remove();
                userCircle = L.circle(userPos, { radius: 400, color: themeColor }).addTo(map);
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
                userCircle = L.circle(userPos, { radius: 400, color: "#ea580c" }).addTo(map);
                
                if (p.name) {
                    const startEl = document.getElementById("startLoc");
                    if (startEl) startEl.value = p.name;
                }
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
                userCircle = L.circle(userPos, {
                    radius: 200,
                    color: "#ea580c",
                    fillColor: "#ea580c",
                    fillOpacity: 0.2,
                }).addTo(map);

                const startEl = document.getElementById("startLoc");
                if (startEl) startEl.value = "Locating...";

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
                        "Current Location (GPS)";
                    
                    if (startEl) startEl.value = cityName;
                    
                    try {
                        localStorage.setItem("user_position", JSON.stringify({ lat: lat, lon: lon, name: cityName }));
                    } catch (e) {}

                    if (cityName && cityName !== "Current Location (GPS)") {
                        document.getElementById("wSearch").value = cityName;
                        manualWeather();
                    }
                } catch (e) {
                    console.warn("Reverse geocode failed:", e);
                    if (startEl) startEl.value = "Current Location (GPS)";
                    try {
                        localStorage.setItem("user_position", JSON.stringify({ lat: lat, lon: lon }));
                    } catch (err) {}
                }
            },
            function (err) {
                console.error("GPS error:", err.message);
                if (err.code === err.TIMEOUT) {
                    if (startEl) startEl.value = "GPS Timeout — try again or enter city";
                } else if (err.code === err.PERMISSION_DENIED) {
                    if (startEl) startEl.value = "GPS Permission Denied";
                }
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    }

    // findMe(); // Commented out to prevent intrusive prompt on load.

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
        if (!query) return null;
        let searchQuery = query;
        if (MASTER_GROQ_KEY && query.split(/\s+/).length >= 2) {
            try {
                const aiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": "Bearer " + MASTER_GROQ_KEY, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "llama-3.1-8b-instant",
                        messages: [
                            { role: "system", content: "Extract ONLY the core geographic location from the messy text so it can be passed to Geocoding APIs. Remove generic words like 'state', 'city', 'district', 'temple', 'hotel'. Return ONLY the clean location string." },
                            { role: "user", content: query }
                        ],
                        temperature: 0.1, max_tokens: 30
                    })
                });
                if (aiRes.ok) {
                    const aiData = await aiRes.json();
                    const extracted = (aiData.choices && aiData.choices[0] && aiData.choices[0].message && aiData.choices[0].message.content) ? aiData.choices[0].message.content.trim() : "";
                    if (extracted && extracted.length < 60) searchQuery = extracted;
                }
            } catch (e) { /* ignore */ }
        }

        try {
            const res = await fetch(
                "https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(searchQuery)
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
            let searchQuery = query;
            if (MASTER_GROQ_KEY && query.split(/\s+/).length >= 2) {
                try {
                    const aiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST",
                        headers: { "Authorization": "Bearer " + MASTER_GROQ_KEY, "Content-Type": "application/json" },
                        body: JSON.stringify({
                            model: "llama-3.1-8b-instant",
                            messages: [
                                { role: "system", content: "Extract ONLY the core geographic location from the messy text so it can be passed to Geocoding APIs. Remove generic words like 'state', 'city', 'district', 'temple', 'hotel'. Return ONLY the clean location string, nothing else." },
                                { role: "user", content: query }
                            ],
                            temperature: 0.1, max_tokens: 30
                        })
                    });
                    if (aiRes.ok) {
                        const aiData = await aiRes.json();
                        const extracted = (aiData.choices && aiData.choices[0] && aiData.choices[0].message && aiData.choices[0].message.content) ? aiData.choices[0].message.content.trim() : "";
                        if (extracted && extracted.length < 60) searchQuery = extracted;
                    }
                } catch (e) {
                    console.warn("AI extraction failed, using raw query.", e);
                }
            }

            const geoRes = await fetch(
                "https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=" +
                    encodeURIComponent(searchQuery)
            );
            const geoData = await geoRes.json();
            if (!geoData || geoData.length === 0) {
                alert("Could not locate this place.");
                return;
            }
            const row = geoData[0];
            const lat = parseFloat(row.lat);
            const lon = parseFloat(row.lon);
            const addr = row.address || {};
            const name = row.name || addr.city || addr.town || addr.village || addr.county || "Selected Location";
            const country = addr.country || "";
            const state = addr.state || addr.county || "";

            const weatherRes = await fetch(
                "https://api.openweathermap.org/data/2.5/weather?lat=" + lat + "&lon=" + lon + "&appid=" + WEATHER_KEY + "&units=metric"
            );
            const weatherData = await weatherRes.json();

            // Fetch a full 7-day forecast from Open-Meteo (no key required, 7 full days)
            const forecastRes = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto`
            );
            const forecastData = await forecastRes.json();

            const iconEmoji = {
                "01d": "☀️", "01n": "🌙", "02d": "⛅", "02n": "☁️",
                "03d": "☁️", "03n": "☁️", "04d": "☁️", "04n": "☁️",
                "09d": "🌧️", "09n": "🌧️", "10d": "🌦️", "10n": "🌧️",
                "11d": "⛈️", "11n": "⛈️", "13d": "🌨️", "13n": "🌨️",
                "50d": "🌫️", "50n": "🌫️",
            };

            // Mapping for Open-Meteo (WMO Codes)
            const wmoIconMapping = {
                0: "☀️", // Clear sky
                1: "🌤️", 2: "🌤️", 3: "☁️", // Partly cloudy
                45: "🌫️", 48: "🌫️", // Fog
                51: "🌦️", 53: "🌦️", 55: "🌦️", // Drizzle
                61: "🌧️", 63: "🌧️", 65: "🌧️", // Rain
                71: "🌨️", 73: "🌨️", 75: "🌨️", // Snow
                80: "🌧️", 81: "🌧️", 82: "🌧️", // Rain showers
                95: "⛈️", 96: "⛈️", 99: "⛈️", // Thunderstorm
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
            
            const forecastContainer = document.getElementById("wForecast");
            forecastContainer.innerHTML = "";
            forecastContainer.classList.remove("hidden");

            if (forecastData && forecastData.daily) {
                const daily = forecastData.daily;
                daily.time.forEach((time, index) => {
                    const date = new Date(time);
                    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                    const code = daily.weathercode[index];
                    const tMax = Math.round(daily.temperature_2m_max[index]);
                    const tMin = Math.round(daily.temperature_2m_min[index]);

                    const card = document.createElement("div");
                    card.className = "forecast-card";
                    card.innerHTML = `
                        <p class="forecast-day">${dayName}</p>
                        <span class="forecast-icon">${wmoIconMapping[code] || "🌤️"}</span>
                        <p class="forecast-temp">${tMax}° <span>${tMin}°</span></p>
                    `;
                    forecastContainer.appendChild(card);
                });
            }

            display.classList.remove("hidden");
            fetchWikiIntel(name);
        } catch (e) {
            console.error("Weather fetch failed", e);
        }
    };

    /** —— Text-to-Speech (TTS) Logic —— **/
    const ScoutTTS = (function() {
        const synthesis = window.speechSynthesis;
        let currentUtterance = null;
        let selectedRate = 1;
        let isPlaying = false;
        let activeBtn = null;

        function getMaleVoice() {
            const voices = synthesis.getVoices();
            // Look for common male voice keywords
            return voices.find(v => 
                v.name.includes("Male") || 
                v.name.includes("David") || 
                v.name.includes("Mark") || 
                v.name.includes("Google US English") || 
                v.name.includes("Microsoft David")
            ) || voices.find(v => v.lang.startsWith("en")) || voices[0];
        }

        // Handle async voice loading
        if (synthesis.onvoiceschanged !== undefined) {
            synthesis.onvoiceschanged = getMaleVoice;
        }

        function stop() {
            synthesis.cancel();
            isPlaying = false;
            if (activeBtn) {
                activeBtn.innerHTML = '<span>▶️</span> Listen';
                activeBtn.classList.remove('active');
            }
        }

        function play(text, buttonEl) {
            if (isPlaying && activeBtn === buttonEl) {
                stop();
                return;
            }

            stop();
            
            const utter = new SpeechSynthesisUtterance(text);
            utter.voice = getMaleVoice();
            utter.rate = selectedRate;
            
            utter.onstart = () => {
                isPlaying = true;
                activeBtn = buttonEl;
                buttonEl.innerHTML = '<span>⏸️</span> Stop';
                buttonEl.classList.add('active');
            };

            utter.onend = () => {
                isPlaying = false;
                buttonEl.innerHTML = '<span>▶️</span> Listen';
                buttonEl.classList.remove('active');
            };

            utter.onerror = () => {
                isPlaying = false;
                buttonEl.innerHTML = '<span>▶️</span> Listen';
                buttonEl.classList.remove('active');
            };

            synthesis.speak(utter);
            currentUtterance = utter;
        }

        function setRate(rate, rateButtons) {
            selectedRate = rate;
            rateButtons.forEach(btn => {
                btn.classList.toggle('active', parseFloat(btn.dataset.rate) === rate);
            });
            if (isPlaying && currentUtterance) {
                const text = currentUtterance.text;
                const btn = activeBtn;
                stop();
                play(text, btn);
            }
        }

        function createControls(text) {
            const container = document.createElement('div');
            container.className = 'tts-controls';

            const playBtn = document.createElement('button');
            playBtn.className = 'btn-tts';
            playBtn.innerHTML = '<span>▶️</span> Listen';
            playBtn.onclick = (e) => {
                e.preventDefault();
                play(text, playBtn);
            };

            const speedGroup = document.createElement('div');
            speedGroup.className = 'tts-speed-group';

            [0.5, 1, 2].forEach(rate => {
                const sBtn = document.createElement('button');
                sBtn.className = 'btn-speed' + (rate === selectedRate ? ' active' : '');
                sBtn.textContent = rate + 'x';
                sBtn.dataset.rate = rate;
                sBtn.onclick = (e) => {
                    e.preventDefault();
                    setRate(rate, container.querySelectorAll('.btn-speed'));
                };
                speedGroup.appendChild(sBtn);
            });

            container.appendChild(playBtn);
            container.appendChild(speedGroup);
            return container;
        }

        return {
            createControls,
            stop
        };
    })();

    async function fetchWikiIntel(place) {
        try {
            const res = await fetch(
                "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(place)
            );
            const data = await res.json();
            const wikiOut = document.getElementById("wWikiOut");
            const wikiText = document.getElementById("wWikiText");
            
            ScoutTTS.stop(); // Stop any current speech

            if (data.extract) {
                wikiOut.classList.remove("hidden");
                wikiText.textContent = data.extract;
                document.getElementById("wWikiLink").href = data.content_urls.desktop.page;

                // Remove old controls if any
                const oldControls = wikiOut.querySelector('.tts-controls');
                if (oldControls) oldControls.remove();
                
                // Add TTS controls
                wikiOut.appendChild(ScoutTTS.createControls(data.extract));
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

            // Add TTS controls to bot response
            botBubble.appendChild(ScoutTTS.createControls(reply));
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
            
            if (res.status === 504) {
                listBody.innerHTML = '<div class="scout-msg-warn">Overpass API timed out (504). This happens when the server is overloaded. Please try again or reduce the radius.</div>';
                return;
            }
            if (!res.ok) throw new Error("Overpass error: " + res.status);
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

    /** —— Budget Planner Logic —— **/
    let budgetData = { income: 0, expenses: [] };
    let budgetChartInstance = null;
    let editingId = null;

    function saveBudget() {
        localStorage.setItem("scout_budget", JSON.stringify(budgetData));
    }

    function loadBudget() {
        const stored = localStorage.getItem("scout_budget");
        if (stored) {
            try { budgetData = JSON.parse(stored); } catch (e) {}
        }
        updateBudgetUI();
    }

    window.setBudgetIncome = function() {
        const val = parseFloat(document.getElementById("budgetIncomeInput").value);
        if (isNaN(val) || val < 0) return alert("Enter valid income.");
        budgetData.income = val;
        saveBudget();
        updateBudgetUI();
        document.getElementById("budgetIncomeInput").value = "";
    };

    window.addExpense = function() {
        const amt = parseFloat(document.getElementById("expAmount").value);
        const cat = document.getElementById("expCategory").value;
        const note = document.getElementById("expNote").value.trim();
        const btn = document.querySelector('button[onclick="addExpense()"]');
        
        if (isNaN(amt) || amt <= 0) return alert("Enter valid amount.");
        
        if (editingId) {
            const idx = budgetData.expenses.findIndex(e => e.id === editingId);
            if (idx !== -1) {
                budgetData.expenses[idx].amount = amt;
                budgetData.expenses[idx].category = cat;
                budgetData.expenses[idx].note = note;
                editingId = null;
                btn.textContent = "Log Trip Expense";
            }
        } else {
            budgetData.expenses.push({
                id: Date.now(),
                amount: amt,
                category: cat,
                note: note,
                date: new Date().toLocaleDateString()
            });
        }
        
        saveBudget();
        updateBudgetUI();
        document.getElementById("expAmount").value = "";
        document.getElementById("expNote").value = "";
        document.getElementById("expCategory").selectedIndex = 0; // Reset category
    };

    window.editExpense = function(id) {
        const exp = budgetData.expenses.find(e => e.id === id);
        if (!exp) return;
        
        document.getElementById("expAmount").value = exp.amount;
        document.getElementById("expCategory").value = exp.category;
        document.getElementById("expNote").value = exp.note || "";
        
        editingId = id;
        const btn = document.querySelector('button[onclick="addExpense()"]');
        if (btn) btn.textContent = "Update Expense";
        
        document.getElementById("expAmount").focus();
    };

    window.deleteExpense = function(id) {
        if (editingId === id) {
            editingId = null;
            document.querySelector('button[onclick="addExpense()"]').textContent = "Log Trip Expense";
            document.getElementById("expAmount").value = "";
            document.getElementById("expNote").value = "";
        }
        budgetData.expenses = budgetData.expenses.filter(e => e.id !== id);
        saveBudget();
        updateBudgetUI();
    };

    function updateBudgetUI() {
        const totalSpent = budgetData.expenses.reduce((sum, e) => sum + e.amount, 0);
        const balance = budgetData.income - totalSpent;
        
        document.getElementById("budgeIncomeVal").textContent = "₹" + budgetData.income.toLocaleString();
        document.getElementById("budgetSpentVal").textContent = "₹" + totalSpent.toLocaleString();
        document.getElementById("budgetBalanceVal").textContent = "₹" + balance.toLocaleString();
        
        const listBody = document.getElementById("expenseBody");
        listBody.innerHTML = "";
        
        budgetData.expenses.slice().reverse().forEach(e => {
            const item = document.createElement("div");
            item.className = "attraction-item flex-between";
            item.innerHTML = `
                <div>
                    <h4 class="flex items-center gap-2">${getCatEmoji(e.category)} ${e.category} <span class="text-[10px] opacity-60 font-normal">(${e.date})</span></h4>
                    <p class="place-coords">${e.note || "No note"}</p>
                </div>
                <div class="text-right flex items-center gap-3">
                    <div class="text-right">
                        <span class="dist-val !text-red-500">₹${e.amount.toLocaleString()}</span>
                    </div>
                    <div class="flex flex-col gap-1 items-end">
                        <button onclick="editExpense(${e.id})" class="text-[10px] text-blue-400 hover:underline">Edit</button>
                        <button onclick="deleteExpense(${e.id})" class="text-[10px] text-red-400 hover:underline">Remove</button>
                    </div>
                </div>
            `;
            listBody.appendChild(item);
        });

        updateChart(totalSpent);
    }

    function getCatEmoji(cat) {
        const m = {
            Transport: "✈️",
            Stay: "🏨",
            Food: "🍽️",
            Tours: "🎟️",
            Shopping: "🛍️",
            Misc: "📦"
        };
        return m[cat] || "💰";
    }

    function updateChart(totalSpent) {
        const ctx = document.getElementById("budgetChart");
        if (!ctx) return;
        
        const catTotals = {};
        budgetData.expenses.forEach(e => {
            catTotals[e.category] = (catTotals[e.category] || 0) + e.amount;
        });

        const labels = Object.keys(catTotals);
        const data = Object.values(catTotals);
        
        const isDark = !document.body.classList.contains("light-mode");
        const textColor = isDark ? "#f4f4f5" : "#18181b";

        if (budgetChartInstance) budgetChartInstance.destroy();

        if (data.length === 0) {
            // Placeholder if no data
            budgetChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['No Data'],
                    datasets: [{
                        data: [1],
                        backgroundColor: [isDark ? '#334155' : '#e4e4e7'],
                        borderWidth: 0
                    }]
                },
                options: {
                    cutout: '70%',
                    plugins: { legend: { display: false } }
                }
            });
            return;
        }

        budgetChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: textColor, font: { size: 10, family: 'Inter' } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ₹${ctx.raw.toLocaleString()}`
                        }
                    }
                }
            }
        });
    }

    // Initialize budget on load
    setTimeout(loadBudget, 100);

    // Watch for theme changes to refresh chart colors
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === "class") {
                updateBudgetUI();
            }
        });
    });
    observer.observe(document.body, { attributes: true });

    /** —— Voice Recognition (Speech-to-Text) —— **/
    window.runVoice = function(inputID) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Your browser does not support Speech Recognition. Try Chrome or Edge.");
            return;
        }

        const inputEl = document.getElementById(inputID);
        const btn = document.querySelector(`button[onclick="runVoice('${inputID}')"]`);
        if (!inputEl || !btn) return;

        if (btn.classList.contains("listening")) return; // Already listening

        const recognition = new SpeechRecognition();
        recognition.lang = "en-US";
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = function() {
            btn.classList.add("listening");
            inputEl.placeholder = "Listening...";
        };

        recognition.onresult = function(event) {
            const transcript = event.results[0][0].transcript;
            inputEl.value = transcript;
            
            // Optional: Automatically trigger action for search/chat
            if (inputID === "wSearch") {
                manualWeather();
            } else if (inputID === "chatInput") {
                // We keep it in the input so the user can review it
                // unless it was a very clear command.
            }
        };

        recognition.onend = function() {
            btn.classList.remove("listening");
            restorePlaceholder(inputID, inputEl);
        };

        function restorePlaceholder(id, el) {
            if (id === "wSearch") el.placeholder = "City, monument, or state…";
            else if (id === "chatInput") el.placeholder = "Ask Scout AI…";
            else if (id === "startLoc") el.placeholder = "Origin (optional — GPS if empty)";
            else if (id === "endLoc") el.placeholder = "Destination";
        }

        recognition.onerror = function(event) {
            console.error("Speech recognition error", event.error);
            btn.classList.remove("listening");
            if (event.error === "not-allowed") {
                alert("Microphone access was denied. Please allow it in your browser settings to use voice features.");
            } else if (event.error === "network") {
                alert("Speech recognition failed due to a network error. Check your connection.");
            } else {
                alert("Speech recognition error: " + event.error);
            }
            restorePlaceholder(inputID, inputEl);
        };

        recognition.start();
    };

    /** —— Travel Buddy Logic —— **/
    const DUMMY_PROFILES = [
        { id: 1, name: "Rahul S.", age: 28, destination: "Goa", interests: ["Beaches", "Nightlife", "Photography"] },
        { id: 2, name: "Sneha M.", age: 24, destination: "Jaipur", interests: ["History", "Architecture", "Food"] },
        { id: 3, name: "Vikram P.", age: 32, destination: "Manali", interests: ["Trekking", "Adventure", "Nature"] },
        { id: 4, name: "Anjali K.", age: 26, destination: "Kerala", interests: ["Ayurveda", "Houseboats", "Culture"] },
        { id: 5, name: "Aditya R.", age: 29, destination: "Goa", interests: ["Water Sports", "Relaxing", "Food"] },
        { id: 6, name: "Kavya T.", age: 25, destination: "Varanasi", interests: ["Spirituality", "Photography", "Culture"] },
        { id: 7, name: "Rohan D.", age: 30, destination: "Jaipur", interests: ["Photography", "Forts", "Local Cuisine"] },
        { id: 8, name: "Priya V.", age: 27, destination: "Kerala", interests: ["Food", "Culture", "Relaxing"] },
        { id: 9, name: "Amit J.", age: 31, destination: "Manali", interests: ["Snowboarding", "Trekking", "Photography"] },
        { id: 10, name: "Neha B.", age: 25, destination: "Udaipur", interests: ["Palaces", "Lakes", "Shopping"] },
        { id: 11, name: "Arjun K.", age: 29, destination: "Ladakh", interests: ["Biking", "Mountains", "Photography"] },
        { id: 12, name: "Meera L.", age: 26, destination: "Agra", interests: ["Taj Mahal", "History", "Food"] },
        { id: 13, name: "Raj P.", age: 35, destination: "Goa", interests: ["Parties", "Relaxing", "Beaches"] },
        { id: 14, name: "Sonia H.", age: 28, destination: "Rishikesh", interests: ["Yoga", "Meditation", "Rafting"] }
    ];

    window.findBuddy = async function() {
        const locBox = document.getElementById("buddyLocation");
        const intBox = document.getElementById("buddyInterest");
        const loc = locBox.value.trim();
        const interests = intBox.value.trim();

        if (!loc) {
            alert("Please enter a destination to find a buddy.");
            return;
        }
        
        if (!MASTER_GROQ_KEY) {
            alert("Set GROQ_API_KEY in .env for AI matching.");
            return;
        }

        const btn = document.getElementById("buddyBtn");
        const outBox = document.getElementById("buddyOut");
        const resBox = document.getElementById("buddyResults");
        
        btn.disabled = true;
        btn.textContent = "Analyzing profiles...";
        outBox.classList.add("hidden");
        resBox.innerHTML = "";

        try {
            const aiPrompt = `A user wants to travel to: ${loc}. Their interests are: ${interests || "Not specified"}.
Here are the available dummy profiles:
${JSON.stringify(DUMMY_PROFILES)}

Select the best 2 matches from the profiles according to their travel destination and interests. 
For each match, provide a very short 1-sentence reason why they are a good match.
If there are no good matches for the location, you can suggest profiles that have similar interests for a different location, but explicitly mention that in the reason. 
Return your response ONLY as valid JSON in this exact structure:
[
  {
    "id": 1,
    "name": "Person Name",
    "reason": "Short reason"
  }
]`;

            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: "Bearer " + MASTER_GROQ_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    messages: [
                        { role: "system", content: "You are a matchmaking AI for travel companions. Output valid JSON array only, without markdown formatting blocks if possible." },
                        { role: "user", content: aiPrompt },
                    ],
                    temperature: 0.1,
                    max_tokens: 400,
                }),
            });
            
            if (!response.ok) throw new Error("API error: " + response.status);
            const data = await response.json();
            const reply = data.choices[0].message.content.trim();
            
            let jsonStr = reply;
            if (jsonStr.startsWith("```")) {
               const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
               if (match) jsonStr = match[1];
            }

            const matches = JSON.parse(jsonStr);
            if (matches && matches.length > 0) {
                matches.forEach(m => {
                    const profile = DUMMY_PROFILES.find(p => p.id === m.id) || DUMMY_PROFILES[0];
                    const card = document.createElement("div");
                    card.className = "scout-wiki-box flex flex-col gap-1 mx-auto text-left";
                    card.style.borderColor = "var(--h-teal)";
                    card.style.maxWidth = "100%";
                    card.innerHTML = `
                        <div class="flex justify-between items-center">
                            <strong class="text-sm font-bold truncate" style="color: var(--text)">🙎‍♂️ ${m.name || profile.name} (${profile.age})</strong>
                            <span class="text-xs font-semibold px-2 py-1 rounded" style="background: var(--input-bg); color: var(--text-secondary)">📍 ${profile.destination}</span>
                        </div>
                        <div class="text-xs text-[var(--muted)] mb-1">❤️ ${profile.interests.join(", ")}</div>
                        <p class="scout-wiki-text text-sm" style="color: var(--text-secondary)"><strong>Match Reason:</strong> ${m.reason}</p>
                        <button class="btn-scout btn-scout-teal !py-1.5 !text-xs mt-2" onclick="alert('Connect request sent to ${m.name}')">Send Connect Request</button>
                    `;
                    resBox.appendChild(card);
                });
            } else {
                resBox.innerHTML = '<div class="scout-msg-muted">No suitable matches found for this destination.</div>';
            }
        } catch (error) {
            console.error("Match error:", error);
            resBox.innerHTML = '<div class="scout-msg-muted" style="color:#f87171">Error connecting to AI matcher. Try again later.</div>';
        } finally {
            outBox.classList.remove("hidden");
            btn.disabled = false;
            btn.textContent = "Find Companion";
        }
    }
})();
