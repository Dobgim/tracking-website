/* ===== TRACK.JS - Professional Package Tracking with Supabase ===== */
/* v5 — Synchronized map progress (all viewers see same position)    */

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
        marker:       null,
        pathCoords:   [],
        index:        0,
        interval:     null,
        trackId:      null,
        savePending:  false,
        saveTimer:    null
    };

    let currentSubscription = null;
    let mapInitializedId    = null;
    let currentShipmentData = null;

    // =========================================================
    // === SYNCHRONIZED PROGRESS: read / write via Supabase ===
    // =========================================================
    // The map_progress column stores the current step index (integer).
    // If the column does not exist yet in your DB, run this SQL once:
    //   ALTER TABLE shipments ADD COLUMN IF NOT EXISTS map_progress INTEGER DEFAULT 0;

    async function readProgressFromDB(trackingId) {
        try {
            const { data, error } = await supabase
                .from('shipments')
                .select('map_progress')
                .eq('tracking_id', trackingId)
                .single();
            if (error || data == null || data.map_progress == null) return null;
            return parseInt(data.map_progress, 10);
        } catch (e) {
            return null;
        }
    }

    async function writeProgressToDB(trackingId, index) {
        try {
            await supabase
                .from('shipments')
                .update({ map_progress: index })
                .eq('tracking_id', trackingId);
        } catch (e) { /* silently ignore if column doesn't exist */ }
    }

    // Debounced DB write — fires 4 seconds after the last call
    // so we don't hammer the database every second
    function scheduleSave(trackingId, index) {
        if (mapState.saveTimer) clearTimeout(mapState.saveTimer);
        mapState.saveTimer = setTimeout(() => {
            writeProgressToDB(trackingId, index);
        }, 4000);
    }

    // === SUPABASE REALTIME: listen for admin status changes ===
    function subscribeToShipment(trackingId) {
        if (currentSubscription) supabase.removeChannel(currentSubscription);
        currentSubscription = supabase
            .channel('shipment-status-' + trackingId)
            .on(
                'postgres_changes',
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
        'pending':          { icon: 'clock',         label: 'Pending',          desc: 'Your shipment has been created and is awaiting pickup.',         step: 0 },
        'picked-up':        { icon: 'package-plus',  label: 'Picked Up',        desc: 'Package has been picked up from the sender.',                   step: 1 },
        'in-transit':       { icon: 'plane',         label: 'In Transit',       desc: 'Your shipment is on its way to the destination.',               step: 2 },
        'out-for-delivery': { icon: 'truck',         label: 'Out for Delivery', desc: 'Package is out for delivery to the receiver.',                  step: 3 },
        'delivered':        { icon: 'check-circle',  label: 'Delivered',        desc: 'Package has been delivered successfully.',                       step: 4 },
        'on-hold':          { icon: 'pause-circle',  label: 'On Hold',          desc: 'Shipment is on hold. Contact support for details.',             step: -1 },
        'returned':         { icon: 'undo',          label: 'Returned',         desc: 'Package has been returned to the sender.',                      step: -1 },
        'cancelled':        { icon: 'x-circle',      label: 'Cancelled',        desc: 'This shipment has been cancelled.',                             step: -1 }
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
        document.getElementById('statusIcon').innerHTML   = `<i data-lucide="${config.icon}"></i>`;
        document.getElementById('statusLabel').textContent = config.label;
        document.getElementById('statusDesc').textContent  = config.desc;

        renderProgress(config.step);

        document.getElementById('invSender').textContent        = s.sender         || '—';
        document.getElementById('invSenderEmail').textContent   = s.sender_email   || '—';
        document.getElementById('invSenderNumber').textContent  = s.sender_number  || '—';
        document.getElementById('invOrigin').textContent        = s.origin         || '—';

        document.getElementById('invReceiver').textContent      = s.receiver       || '—';
        document.getElementById('invReceiverEmail').textContent = s.receiver_email || '—';
        document.getElementById('invReceiverNumber').textContent= s.receiver_number|| '—';
        document.getElementById('invDestination').textContent   = s.destination    || '—';

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

        if (!isUpdate) {
            // First load — render the map fresh (with DB-synced position)
            mapState.trackId = s.tracking_id;
            renderMap(s);
            trackResult.style.display = 'block';
            setTimeout(() => trackResult.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
        } else {
            // Live admin update — pause or resume based on new status
            updateMapAnimation(s.status);
        }

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

    // === RENDER MAP (called once per shipment load) ===
    async function renderMap(s) {
        const origin      = s.origin;
        const destination = s.destination;
        const status      = s.status;

        const mapContainer = document.getElementById('mapContainer');
        const mapDiv       = document.getElementById('googleMap');
        const routeInfo    = document.getElementById('routeInfo');

        if (!origin || !destination) {
            mapContainer.style.display = 'none';
            return;
        }

        mapContainer.style.display = 'block';
        routeInfo.innerHTML = `${origin} <i data-lucide="arrow-right" style="width:14px; height:14px; vertical-align:middle; margin:0 8px;"></i> ${destination}`;
        if (window.lucide) lucide.createIcons();

        // Stop any previous animation
        if (mapState.interval) {
            window.clearInterval(mapState.interval);
            mapState.interval = null;
        }

        // ─── Read saved progress from DB (synchronized for all viewers) ───
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

        geocoder.geocode({ address: origin }, (r1, s1) => {
            if (s1 !== 'OK' || !r1[0]) return;
            const originCoords = r1[0].geometry.location;

            // Green dot = origin
            new google.maps.Marker({
                position: originCoords,
                map,
                title: 'Origin: ' + origin,
                icon: { url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png', scaledSize: new google.maps.Size(36, 36) }
            });

            geocoder.geocode({ address: destination }, (r2, s2) => {
                if (s2 !== 'OK' || !r2[0]) return;
                const destCoords = r2[0].geometry.location;

                // Red pin = destination
                new google.maps.Marker({
                    position: destCoords,
                    map,
                    title: 'Destination: ' + destination,
                    icon: { url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png', scaledSize: new google.maps.Size(36, 36) }
                });

                // Build curved flight path with more points for smoother animation
                const pathCoords = buildCurvedPath(originCoords, destCoords, 1200);

                // Dashed background line
                new google.maps.Polyline({
                    path: [originCoords, destCoords],
                    geodesic: true,
                    strokeColor: '#9ca3af',
                    strokeOpacity: 0,
                    icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.5, scale: 3 }, offset: '0', repeat: '18px' }],
                    map
                });

                // Solid blue curved route
                new google.maps.Polyline({
                    path: pathCoords,
                    geodesic: true,
                    strokeColor: '#3b82f6',
                    strokeOpacity: 0.85,
                    strokeWeight: 4,
                    map
                });

                // Vehicle marker
                const vehicleIconUrl = getIconForType(s.type);
                const vehicleMarker = new google.maps.Marker({
                    position: originCoords,
                    map,
                    icon: {
                        url:        vehicleIconUrl,
                        scaledSize: new google.maps.Size(48, 48),
                        anchor:     new google.maps.Point(24, 24)
                    },
                    zIndex: 999,
                    title: s.type || 'Package'
                });

                // Store in shared state
                mapState.marker     = vehicleMarker;
                mapState.pathCoords = pathCoords;
                mapState.trackId    = s.tracking_id;

                // === RESTORE POSITION (from DB — same for ALL viewers) ===
                if (savedIndex !== null && savedIndex > 0) {
                    // Resume from saved DB position — same position everyone sees
                    mapState.index = Math.min(savedIndex, pathCoords.length - 1);
                } else {
                    // First time shipment is ever tracked — set starting position by status
                    let startPct = 0;
                    if      (status === 'pending')          startPct = 0;
                    else if (status === 'picked-up')        startPct = 2;
                    else if (status === 'in-transit')       startPct = 10;
                    else if (status === 'out-for-delivery') startPct = 80;
                    else if (status === 'delivered')        startPct = 100;
                    else                                    startPct = 5;
                    mapState.index = Math.floor((startPct / 100) * (pathCoords.length - 1));
                    // Save this initial position to DB immediately
                    writeProgressToDB(s.tracking_id, mapState.index);
                }
                vehicleMarker.setPosition(pathCoords[mapState.index]);

                // Fit map bounds
                const bounds = new google.maps.LatLngBounds();
                bounds.extend(originCoords);
                bounds.extend(destCoords);
                map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });

                // Start animation based on current status
                updateMapAnimation(status);
            });
        });
    }

    // ================================================================
    // === ANIMATION ENGINE ===
    // Called on first load AND on every live realtime status update
    // ================================================================
    function updateMapAnimation(newStatus) {
        if (!mapState.marker || !mapState.pathCoords.length) return;

        // ALWAYS stop the existing animation first — freeze vehicle exactly where it is
        if (mapState.interval) {
            window.clearInterval(mapState.interval);
            mapState.interval = null;
        }
        if (mapState.saveTimer) {
            clearTimeout(mapState.saveTimer);
            mapState.saveTimer = null;
        }

        // Save current position to DB immediately when status changes
        writeProgressToDB(mapState.trackId, mapState.index);

        // ── DELIVERED: snap to final destination ──
        if (newStatus === 'delivered') {
            mapState.index = mapState.pathCoords.length - 1;
            mapState.marker.setPosition(mapState.pathCoords[mapState.index]);
            writeProgressToDB(mapState.trackId, mapState.index);
            return;
        }

        // ── STATIONARY statuses: freeze vehicle exactly where it is ──
        const movingStatuses = ['in-transit', 'out-for-delivery', 'picked-up'];
        if (!movingStatuses.includes(newStatus)) {
            // PAUSED — do nothing, vehicle stays frozen
            return;
        }

        // ── MOVING: crawl forward toward the target zone ──
        // Target percentage of the path (NEVER reaches 100% until delivered)
        let targetPct;
        if      (newStatus === 'picked-up')        targetPct = 5;   // only slightly past origin
        else if (newStatus === 'in-transit')       targetPct = 78;  // mid-route
        else if (newStatus === 'out-for-delivery') targetPct = 96;  // close but not at destination
        else                                        targetPct = 78;

        const maxIndex = Math.floor((targetPct / 100) * (mapState.pathCoords.length - 1));

        if (mapState.index >= maxIndex) {
            // Already at or beyond the ceiling for this status — hold position
            return;
        }

        // ── Speed settings ──
        // Step interval in milliseconds — higher = slower movement
        // 1200 path points total:
        //   picked-up    → 60 steps   @  8000ms/step = about 8 mins per visible move (very slow)
        //   in-transit   → ~936 steps @ 12000ms/step = very slow crawl
        //   out-delivery → ~192 steps @  5000ms/step = slightly faster near end
        let msPerStep;
        if      (newStatus === 'picked-up')        msPerStep = 8000;   // very slow
        else if (newStatus === 'in-transit')       msPerStep = 12000;  // slowest — long haul
        else if (newStatus === 'out-for-delivery') msPerStep = 5000;   // last mile, bit faster
        else                                        msPerStep = 12000;

        mapState.interval = window.setInterval(() => {
            if (mapState.index < maxIndex) {
                mapState.index++;
                mapState.marker.setPosition(mapState.pathCoords[mapState.index]);
                // Sync to DB every step (debounced — actual write fires 4s after last call)
                scheduleSave(mapState.trackId, mapState.index);
            } else {
                // Reached ceiling for this status — stop
                window.clearInterval(mapState.interval);
                mapState.interval = null;
                // Final save for this stop
                writeProgressToDB(mapState.trackId, mapState.index);
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

    // === URL PARAM: auto-track if ?id=XYZ is in the URL ===
    const urlParams  = new URLSearchParams(window.location.search);
    const urlTrackId = urlParams.get('id');
    if (urlTrackId) {
        document.getElementById('trackingInput').value = urlTrackId;
        trackForm.dispatchEvent(new Event('submit'));
    }
});
