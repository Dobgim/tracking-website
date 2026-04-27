/* ===== TRACK.JS - Professional Package Tracking with Supabase ===== */
/* v6 — Multi-leg waypoint routing + pause-at-location support        */

document.addEventListener('DOMContentLoaded', () => {
    const trackForm     = document.getElementById('trackForm');
    const trackResult   = document.getElementById('trackResult');
    const trackNoResult = document.getElementById('trackNoResult');

    if (!trackForm) return;

    // === VEHICLE ICON MAP ===
    const ICONS = {
        air:  'https://maps.gstatic.com/mapfiles/ms2/micons/plane.png',
        sea:  'https://maps.gstatic.com/mapfiles/ms2/micons/ferry.png',
        land: 'https://maps.gstatic.com/mapfiles/ms2/micons/truck.png',
        box:  'https://maps.gstatic.com/mapfiles/ms2/micons/package.png'
    };

    function getIconForType(type) {
        if (!type) return ICONS.box;
        const t = type.toLowerCase();
        if (t.includes('air') || t.includes('plane') || t.includes('flight')) return ICONS.air;
        if (t.includes('sea') || t.includes('ocean') || t.includes('ship'))   return ICONS.sea;
        if (t.includes('land') || t.includes('road') || t.includes('truck') ||
            t.includes('car')  || t.includes('express') || t.includes('motor') ||
            t.includes('bike') || t.includes('ground'))                        return ICONS.land;
        return ICONS.box;
    }

    // === LIVE MAP STATE ===
    let mapState = {
        marker:            null,
        pathCoords:        [],
        index:             0,
        interval:          null,
        trackId:           null,
        savePending:       false,
        saveTimer:         null,
        pauseAtIndex:      null,   // path index where vehicle must freeze (from a waypoint pause)
        waypointIndices:   []      // path indices for each intermediate waypoint
    };

    let currentSubscription = null;
    let mapInitializedId    = null;
    let currentShipmentData = null;

    // =========================================================
    // === SYNCHRONIZED PROGRESS ===
    // =========================================================
    async function readProgressFromDB(trackingId) {
        try {
            const { data, error } = await supabase
                .from('shipments')
                .select('map_progress')
                .eq('tracking_id', trackingId)
                .single();
            if (error || data == null || data.map_progress == null) return null;
            return parseInt(data.map_progress, 10);
        } catch (e) { return null; }
    }

    async function writeProgressToDB(trackingId, index) {
        try {
            await supabase
                .from('shipments')
                .update({ map_progress: index })
                .eq('tracking_id', trackingId);
        } catch (e) {}
    }

    function scheduleSave(trackingId, index) {
        if (mapState.saveTimer) clearTimeout(mapState.saveTimer);
        mapState.saveTimer = setTimeout(() => {
            writeProgressToDB(trackingId, index);
        }, 4000);
    }

    // === SUPABASE REALTIME ===
    function subscribeToShipment(trackingId) {
        if (currentSubscription) supabase.removeChannel(currentSubscription);
        currentSubscription = supabase
            .channel('shipment-status-' + trackingId)
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'shipments', filter: `tracking_id=eq.${trackingId}` },
                payload => {
                    currentShipmentData = payload.new;
                    displayResult(payload.new, true);
                }
            )
            .subscribe();
    }

    // === STATUS CONFIG ===
    const STATUS_CONFIG = {
        'pending':          { icon: 'clock',         label: 'Pending',          desc: 'Your shipment has been created and is awaiting pickup.',       step: 0 },
        'picked-up':        { icon: 'package-plus',  label: 'Picked Up',        desc: 'Package has been picked up from the sender.',                 step: 1 },
        'in-transit':       { icon: 'plane',         label: 'In Transit',       desc: 'Your shipment is on its way to the destination.',             step: 2 },
        'out-for-delivery': { icon: 'truck',         label: 'Out for Delivery', desc: 'Package is out for delivery to the receiver.',                step: 3 },
        'delivered':        { icon: 'check-circle',  label: 'Delivered',        desc: 'Package has been delivered successfully.',                     step: 4 },
        'on-hold':          { icon: 'pause-circle',  label: 'On Hold',          desc: 'Shipment is on hold. Contact support for details.',           step: -1 },
        'returned':         { icon: 'undo',          label: 'Returned',         desc: 'Package has been returned to the sender.',                    step: -1 },
        'cancelled':        { icon: 'x-circle',      label: 'Cancelled',        desc: 'This shipment has been cancelled.',                           step: -1 }
    };

    const PROGRESS_STEPS = [
        { icon: 'box',          label: 'Created' },
        { icon: 'package-plus', label: 'Picked Up' },
        { icon: 'plane',        label: 'In Transit' },
        { icon: 'truck',        label: 'Out for Delivery' },
        { icon: 'check-circle', label: 'Delivered' }
    ];

    // === FORM SUBMIT ===
    trackForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const trackingId = document.getElementById('trackingInput').value.trim().toUpperCase();

        trackResult.style.display   = 'none';
        trackNoResult.style.display = 'none';

        const { data, error } = await supabase
            .from('shipments')
            .select('*')
            .eq('tracking_id', trackingId)
            .single();

        if (error || !data) {
            trackNoResult.style.display = 'block';
        } else {
            currentShipmentData = data;
            if (mapInitializedId !== trackingId) {
                mapInitializedId = trackingId;
                displayResult(data, false);
                subscribeToShipment(trackingId);
            } else {
                displayResult(data, true);
            }
        }
    });

    // === DISPLAY RESULT ===
    function displayResult(s, isUpdate = false) {
        const config = STATUS_CONFIG[s.status] || STATUS_CONFIG['pending'];

        document.getElementById('invTrackId').textContent  = s.tracking_id;
        document.getElementById('invType').textContent     = s.type || 'Standard Shipment';

        const banner = document.getElementById('statusBanner');
        banner.className = 'status-banner ' + s.status;
        document.getElementById('statusIcon').innerHTML    = `<i data-lucide="${config.icon}"></i>`;
        document.getElementById('statusLabel').textContent = config.label;
        document.getElementById('statusDesc').textContent  = config.desc;

        renderProgress(config.step);

        document.getElementById('invSender').textContent         = s.sender         || '—';
        document.getElementById('invSenderEmail').textContent    = s.sender_email   || '—';
        document.getElementById('invSenderNumber').textContent   = s.sender_number  || '—';
        document.getElementById('invOrigin').textContent         = s.origin         || '—';

        document.getElementById('invReceiver').textContent       = s.receiver       || '—';
        document.getElementById('invReceiverEmail').textContent  = s.receiver_email || '—';
        document.getElementById('invReceiverNumber').textContent = s.receiver_number|| '—';
        document.getElementById('invDestination').textContent    = s.destination    || '—';

        document.getElementById('packageTableBody').innerHTML = `
            <tr>
                <td data-label="Description">${s.description || 'Standard Package'}</td>
                <td data-label="Weight">${s.weight ? s.weight + ' kg' : 'N/A'}</td>
                <td data-label="Ship Date">${s.ship_date ? new Date(s.ship_date).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : 'N/A'}</td>
                <td data-label="Est. Delivery">${s.delivery_date ? new Date(s.delivery_date).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) + (s.delivery_time ? ' at ' + s.delivery_time : '') : 'N/A'}</td>
                <td data-label="Type">${s.type || 'Standard'}</td>
                <td data-label="Piece Type">${s.piece_type || '—'}</td>
            </tr>
        `;

        renderTimeline(s.timeline);
        renderWaypointRoute(s);

        if (!isUpdate) {
            mapState.trackId = s.tracking_id;
            renderMap(s);
            trackResult.style.display = 'block';
            setTimeout(() => trackResult.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
        } else {
            // Live update: re-read waypoints (pause may have changed) and update animation
            const validWp = (s.waypoints || []).filter(w => w.location && w.location.trim());
            mapState.pauseAtIndex = computePauseAtIndex(validWp, mapState.waypointIndices);
            updateMapAnimation(s.status);
        }

        if (window.lucide) lucide.createIcons();
    }

    // === WAYPOINT ROUTE DISPLAY (below invoice, above map) ===
    function renderWaypointRoute(s) {
        const waypoints = s.waypoints || [];
        const container = document.getElementById('waypointRouteDisplay');
        if (!container) return;

        const visibleWaypoints = waypoints.filter(w => !w.pause);

        if (!visibleWaypoints.length) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        const stops = [
            { label: s.origin, type: 'origin' },
            ...visibleWaypoints.map(w => ({ label: w.location, type: 'stop' })),
            { label: s.destination, type: 'destination' }
        ];

        container.innerHTML = `
            <h4 style="display:flex; align-items:center; gap:8px; color:var(--accent); font-size:0.78rem; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:14px;">
                <i data-lucide="route" style="width:14px; height:14px;"></i> Package Route
            </h4>
            <div class="route-stops-list">
                ${stops.map((stop, i) => `
                    <div class="route-stop-item ${stop.type}">
                        <div class="route-stop-dot"></div>
                        <div class="route-stop-label">
                            <span class="stop-name">${stop.label || '—'}</span>
                            ${stop.type === 'pause' ? '<span class="pause-badge"><i data-lucide="pause-circle" style="width:11px;height:11px;vertical-align:middle;"></i> Paused Here</span>' : ''}
                            ${stop.type === 'origin' ? '<span class="origin-badge">Origin</span>' : ''}
                            ${stop.type === 'destination' ? '<span class="dest-badge">Destination</span>' : ''}
                        </div>
                    </div>
                    ${i < stops.length - 1 ? '<div class="route-stop-connector"></div>' : ''}
                `).join('')}
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    }

    // === PROGRESS BAR ===
    function renderProgress(currentStep) {
        const container = document.getElementById('progressTracker');
        const step      = currentStep >= 0 ? currentStep : 2;
        const fillWidth = step >= 4 ? 100 : (step / 4) * 100;

        let html = `<div class="progress-fill" style="width:calc(${fillWidth}% - 30px);"></div>`;
        PROGRESS_STEPS.forEach((ps, i) => {
            let cls = i < step ? 'done' : i === step ? 'current' : '';
            html += `<div class="progress-step ${cls}">
                        <div class="step-dot">${i < step ? '<i data-lucide="check"></i>' : `<i data-lucide="${ps.icon}"></i>`}</div>
                        <div class="step-label">${ps.label}</div>
                     </div>`;
        });
        container.innerHTML = html;
        if (window.lucide) lucide.createIcons();
    }

    // === TIMELINE ===
    function renderTimeline(timeline) {
        const container = document.getElementById('invTimeline');
        if (!timeline || timeline.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted); font-size:0.88rem;">No timeline events yet.</p>';
            return;
        }
        container.innerHTML = timeline.map((item, i) => `
            <div class="inv-tl-item ${i === 0 ? 'latest' : ''}">
                <div class="tl-date">
                    ${item.date ? new Date(item.date).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : ''}<br>
                    <small>${item.time || ''}</small>
                </div>
                <div class="tl-info">
                    <div class="tl-event">${item.event || ''}</div>
                    <div class="tl-loc">${item.location ? '<i data-lucide="map-pin" style="width:12px; height:12px; display:inline-block; vertical-align:middle; margin-right:4px;"></i>' + item.location : ''}</div>
                </div>
            </div>
        `).join('');
        if (window.lucide) lucide.createIcons();
    }

    // =========================================================
    // === GEOCODING HELPER ===
    // =========================================================
    function geocodePlace(geocoder, address) {
        return new Promise(resolve => {
            geocoder.geocode({ address }, (results, status) => {
                if (status === 'OK' && results[0]) resolve(results[0].geometry.location);
                else resolve(null);
            });
        });
    }

    // =========================================================
    // === COMPUTE pauseAtIndex from waypoints + path indices ===
    // =========================================================
    function computePauseAtIndex(waypoints, waypointIndices) {
        if (!waypoints || !waypoints.length) return null;
        for (let i = 0; i < waypoints.length; i++) {
            if (waypoints[i] && waypoints[i].pause && waypointIndices[i] !== undefined) {
                return waypointIndices[i];
            }
        }
        return null;
    }

    // =========================================================
    // === RENDER MAP (called once per shipment load) ===
    // =========================================================
    async function renderMap(s) {
        const origin      = s.origin;
        const destination = s.destination;
        const status      = s.status;
        const waypoints   = s.waypoints || [];

        const mapContainer = document.getElementById('mapContainer');
        const mapDiv       = document.getElementById('googleMap');
        const routeInfo    = document.getElementById('routeInfo');

        if (!origin || !destination) {
            mapContainer.style.display = 'none';
            return;
        }

        mapContainer.style.display = 'block';

        // Stop previous animation
        if (mapState.interval) { clearInterval(mapState.interval); mapState.interval = null; }

        const savedIndex = await readProgressFromDB(s.tracking_id);

        const geocoder = new google.maps.Geocoder();
        const map = new google.maps.Map(mapDiv, {
            zoom: 3,
            center: { lat: 30, lng: 0 },
            mapTypeControl:    false,
            streetViewControl: false,
            fullscreenControl: true,
            zoomControl:       true
        });

        // Build ordered locations: origin → waypoints → destination
        const validWaypoints = waypoints.filter(w => w.location && w.location.trim());
        const allLocations   = [origin, ...validWaypoints.map(w => w.location), destination];

        // Geocode all locations in parallel
        const allCoords = await Promise.all(allLocations.map(loc => geocodePlace(geocoder, loc)));

        // Must have valid origin and destination
        if (!allCoords[0] || !allCoords[allCoords.length - 1]) {
            mapContainer.style.display = 'none';
            return;
        }

        // --- Origin marker (green) ---
        new google.maps.Marker({
            position: allCoords[0], map,
            title: 'Origin: ' + origin,
            icon: { url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png', scaledSize: new google.maps.Size(36, 36) }
        });

        // --- Destination marker (red) ---
        new google.maps.Marker({
            position: allCoords[allCoords.length - 1], map,
            title: 'Destination: ' + destination,
            icon: { url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png', scaledSize: new google.maps.Size(36, 36) }
        });

        // --- Waypoint markers (yellow = pass-through, pauses are hidden) ---
        for (let i = 1; i < allCoords.length - 1; i++) {
            if (!allCoords[i]) continue;
            const wp      = validWaypoints[i - 1];
            const isPause = wp && wp.pause;
            
            // Skip drawing the marker so the pause location remains secret
            if (isPause) continue; 

            new google.maps.Marker({
                position: allCoords[i], map,
                title: '📍 Stop: ' + allLocations[i],
                icon: {
                    url: 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png',
                    scaledSize: new google.maps.Size(32, 32)
                }
            });
        }

        // --- Build multi-segment curved path ---
        const TOTAL_POINTS = 1200;
        const validCoords  = allCoords.filter(Boolean);
        const segCount     = validCoords.length - 1;
        const ptsPerSeg    = Math.max(50, Math.floor(TOTAL_POINTS / segCount));

        let fullPath         = [];
        let waypointIndices  = []; // path index for each intermediate stop junction

        for (let i = 0; i < segCount; i++) {
            const segPts = buildCurvedPath(validCoords[i], validCoords[i + 1], ptsPerSeg);
            if (i === 0) {
                fullPath = [...segPts];
            } else {
                fullPath.push(...segPts.slice(1)); // avoid duplicating junction point
            }
            if (i < segCount - 1) {
                waypointIndices.push(fullPath.length - 1);
            }
        }

        // --- Draw dashed background line ---
        new google.maps.Polyline({
            path: [validCoords[0], validCoords[validCoords.length - 1]],
            geodesic: true,
            strokeColor: '#9ca3af', strokeOpacity: 0,
            icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.5, scale: 3 }, offset: '0', repeat: '18px' }],
            map
        });

        // --- Draw solid route line ---
        new google.maps.Polyline({
            path: fullPath,
            geodesic: true,
            strokeColor: '#3b82f6', strokeOpacity: 0.85, strokeWeight: 4,
            map
        });

        // --- Vehicle marker ---
        const vehicleMarker = new google.maps.Marker({
            position: validCoords[0], map,
            icon: { url: getIconForType(s.type), scaledSize: new google.maps.Size(48, 48), anchor: new google.maps.Point(24, 24) },
            zIndex: 999, title: s.type || 'Package'
        });

        // --- Store in mapState ---
        mapState.marker          = vehicleMarker;
        mapState.pathCoords      = fullPath;
        mapState.trackId         = s.tracking_id;
        mapState.waypointIndices = waypointIndices;
        mapState.pauseAtIndex    = computePauseAtIndex(validWaypoints, waypointIndices);

        // --- Restore or set start position ---
        if (savedIndex !== null && savedIndex > 0) {
            mapState.index = Math.min(savedIndex, fullPath.length - 1);
        } else {
            let startPct = 0;
            if      (status === 'pending')          startPct = 0;
            else if (status === 'picked-up')        startPct = 2;
            else if (status === 'in-transit')       startPct = 10;
            else if (status === 'out-for-delivery') startPct = 80;
            else if (status === 'delivered')        startPct = 100;
            else                                    startPct = 5;
            mapState.index = Math.floor((startPct / 100) * (fullPath.length - 1));
            writeProgressToDB(s.tracking_id, mapState.index);
        }
        vehicleMarker.setPosition(fullPath[mapState.index]);

        // --- Fit map bounds ---
        const bounds = new google.maps.LatLngBounds();
        validCoords.forEach(c => bounds.extend(c));
        map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });

        // --- Update route header (hide paused waypoints) ---
        const visibleHeaderWaypoints = validWaypoints.filter(w => !w.pause);
        const stopLabels = [origin, ...visibleHeaderWaypoints.map(w => w.location), destination];
        
        routeInfo.innerHTML = stopLabels.map((l, i) =>
            i < stopLabels.length - 1
                ? `${l} <i data-lucide="arrow-right" style="width:12px;height:12px;vertical-align:middle;margin:0 4px;"></i>`
                : l
        ).join('');
        if (window.lucide) lucide.createIcons();

        // --- Start animation ---
        updateMapAnimation(status);
    }

    // =========================================================
    // === ANIMATION ENGINE ===
    // =========================================================
    function updateMapAnimation(newStatus) {
        if (!mapState.marker || !mapState.pathCoords.length) return;

        // Stop existing interval
        if (mapState.interval) { clearInterval(mapState.interval); mapState.interval = null; }
        if (mapState.saveTimer) { clearTimeout(mapState.saveTimer); mapState.saveTimer = null; }

        writeProgressToDB(mapState.trackId, mapState.index);

        const movingStatuses = ['in-transit', 'out-for-delivery', 'picked-up', 'delivered'];
        if (!movingStatuses.includes(newStatus)) return; // Stationary statuses freeze exactly where they are

        const totalSteps = mapState.pathCoords.length - 1;
        let maxIndex;
        let msPerStep;

        if (mapState.pauseAtIndex !== null) {
            // Target is the pause waypoint
            maxIndex = mapState.pauseAtIndex;
            // Complete remaining distance in ~15 seconds
            const stepsToGo = Math.max(1, maxIndex - mapState.index);
            msPerStep = Math.max(20, Math.floor(15000 / stepsToGo));
        } else {
            // Normal targets based on status percentage
            let targetPct;
            if      (newStatus === 'picked-up')        targetPct = 5;
            else if (newStatus === 'in-transit')       targetPct = 78;
            else if (newStatus === 'out-for-delivery') targetPct = 96;
            else if (newStatus === 'delivered')        targetPct = 100;
            else                                        targetPct = 78;

            maxIndex = Math.min(Math.floor((targetPct / 100) * totalSteps), totalSteps);

            if      (newStatus === 'picked-up')        msPerStep = 80;
            else if (newStatus === 'in-transit')       msPerStep = 120;
            else if (newStatus === 'out-for-delivery') msPerStep = 50;
            else if (newStatus === 'delivered')        msPerStep = 50; // fast animation to destination
            else                                        msPerStep = 120;
        }

        // If the marker is already at or past the target, snap it and do not animate
        if (mapState.index >= maxIndex) {
            mapState.index = maxIndex;
            mapState.marker.setPosition(mapState.pathCoords[maxIndex]);
            writeProgressToDB(mapState.trackId, maxIndex);
            return;
        }

        // Animate up to the maxIndex
        mapState.interval = setInterval(() => {
            if (mapState.index < maxIndex) {
                mapState.index++;
                
                // Hard-clamp: stop exactly on the target
                if (mapState.index >= maxIndex) {
                    mapState.index = maxIndex;
                    mapState.marker.setPosition(mapState.pathCoords[maxIndex]);
                    clearInterval(mapState.interval);
                    mapState.interval = null;
                    writeProgressToDB(mapState.trackId, maxIndex);
                } else {
                    mapState.marker.setPosition(mapState.pathCoords[mapState.index]);
                    scheduleSave(mapState.trackId, mapState.index);
                }
            } else {
                // Safety net: freeze immediately
                mapState.index = maxIndex;
                mapState.marker.setPosition(mapState.pathCoords[maxIndex]);
                clearInterval(mapState.interval);
                mapState.interval = null;
                writeProgressToDB(mapState.trackId, maxIndex);
            }
        }, msPerStep);
    }

    // === CURVED PATH GENERATOR ===
    function buildCurvedPath(start, end, numPoints) {
        const points = [];
        const lat1 = start.lat(), lng1 = start.lng();
        const lat2 = end.lat(),   lng2 = end.lng();
        for (let i = 0; i <= numPoints; i++) {
            const t   = i / numPoints;
            const lat = lat1 + (lat2 - lat1) * t;
            const lng = lng1 + (lng2 - lng1) * t;
            const arc = Math.sin(Math.PI * t) * 0.15 * Math.abs(lat2 - lat1 + lng2 - lng1);
            points.push(new google.maps.LatLng(lat + arc, lng));
        }
        return points;
    }

    // === URL PARAM: auto-track if ?id=XYZ ===
    const urlParams  = new URLSearchParams(window.location.search);
    const urlTrackId = urlParams.get('id');
    if (urlTrackId) {
        document.getElementById('trackingInput').value = urlTrackId;
        trackForm.dispatchEvent(new Event('submit'));
    }
});
