/* ===== TRACK.JS - Professional Package Tracking with Supabase ===== */

document.addEventListener('DOMContentLoaded', () => {
    const trackForm = document.getElementById('trackForm');
    const trackResult = document.getElementById('trackResult');
    const trackNoResult = document.getElementById('trackNoResult');

    if (!trackForm) return;

    // === VEHICLE ICON MAP ===
    // Using reliable hosted PNG icons — no CDN issues, no emoji rendering problems
    const ICONS = {
        // Air freight → airplane icon (blue/white plane)
        air:  'https://maps.gstatic.com/mapfiles/ms2/micons/plane.png',
        // Sea freight → blue boat icon
        sea:  'https://maps.gstatic.com/mapfiles/ms2/micons/ferry.png',
        // Land/road → truck icon
        land: 'https://maps.gstatic.com/mapfiles/ms2/micons/truck.png',
        // Default → package/box icon
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

    // === LIVE MAP STATE (shared across realtime updates) ===
    let mapState = {
        marker:     null,
        pathCoords: [],
        index:      0,
        interval:   null,
        trackId:    null
    };

    let currentSubscription = null;
    let mapInitializedId    = null;

    // === SUPABASE REALTIME: listen for admin status changes ===
    function subscribeToShipment(trackingId) {
        if (currentSubscription) supabase.removeChannel(currentSubscription);
        currentSubscription = supabase
            .channel('shipment-status-' + trackingId)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'shipments', filter: `tracking_id=eq.${trackingId}` },
                payload => {
                    // Status changed in admin — update everything live without page reload
                    displayResult(payload.new, true);
                }
            )
            .subscribe();
    }

    // === STATUS CONFIG ===
    const STATUS_CONFIG = {
        'pending':          { icon: '⏳', label: 'Pending',          desc: 'Your shipment has been created and is awaiting pickup.',         step: 0 },
        'picked-up':        { icon: '📤', label: 'Picked Up',        desc: 'Package has been picked up from the sender.',                   step: 1 },
        'in-transit':       { icon: '✈️', label: 'In Transit',       desc: 'Your shipment is on its way to the destination.',               step: 2 },
        'out-for-delivery': { icon: '🚚', label: 'Out for Delivery', desc: 'Package is out for delivery to the receiver.',                  step: 3 },
        'delivered':        { icon: '✅', label: 'Delivered',        desc: 'Package has been delivered successfully.',                       step: 4 },
        'on-hold':          { icon: '⏸️', label: 'On Hold',          desc: 'Shipment is on hold. Contact support for details.',             step: -1 },
        'returned':         { icon: '↩️', label: 'Returned',         desc: 'Package has been returned to the sender.',                      step: -1 },
        'cancelled':        { icon: '❌', label: 'Cancelled',        desc: 'This shipment has been cancelled.',                             step: -1 }
    };

    const PROGRESS_STEPS = [
        { icon: '📦', label: 'Created' },
        { icon: '📤', label: 'Picked Up' },
        { icon: '✈️', label: 'In Transit' },
        { icon: '🚚', label: 'Out for Delivery' },
        { icon: '✅', label: 'Delivered' }
    ];

    // === FORM SUBMIT: Track a package ===
    trackForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const trackingId = document.getElementById('trackingInput').value.trim().toUpperCase();

        trackResult.style.display    = 'none';
        trackNoResult.style.display  = 'none';

        const { data, error } = await supabase
            .from('shipments')
            .select('*')
            .eq('tracking_id', trackingId)
            .single();

        if (error || !data) {
            trackNoResult.style.display = 'block';
        } else {
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
        document.getElementById('statusIcon').textContent  = config.icon;
        document.getElementById('statusLabel').textContent = config.label;
        document.getElementById('statusDesc').textContent  = config.desc;

        renderProgress(config.step);

        document.getElementById('invSender').textContent       = s.sender         || '—';
        document.getElementById('invSenderEmail').textContent  = s.sender_email   || '—';
        document.getElementById('invSenderNumber').textContent = s.sender_number  || '—';
        document.getElementById('invOrigin').textContent       = s.origin         || '—';
        
        document.getElementById('invReceiver').textContent     = s.receiver       || '—';
        document.getElementById('invReceiverEmail').textContent= s.receiver_email || '—';
        document.getElementById('invReceiverNumber').textContent= s.receiver_number|| '—';
        document.getElementById('invDestination').textContent  = s.destination    || '—';

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
            // First load — render the map fresh
            mapState.trackId = s.tracking_id;
            renderMap(s);
            trackResult.style.display = 'block';
            setTimeout(() => trackResult.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
        } else {
            // Live admin update — pause or resume exactly where vehicle is
            updateMapAnimation(s.status);
            // Also update the status banner text live
        }
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
                        <div class="step-dot">${i < step ? '✓' : ps.icon}</div>
                        <div class="step-label">${ps.label}</div>
                     </div>`;
        });
        container.innerHTML = html;
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
                    <div class="tl-loc">${item.location ? '📍 ' + item.location : ''}</div>
                </div>
            </div>
        `).join('');
    }

    // === RENDER MAP (called once per shipment) ===
    function renderMap(s) {
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
        routeInfo.textContent = `${origin}  →  ${destination}`;

        // Clear any previous interval
        if (mapState.interval) {
            window.clearInterval(mapState.interval);
            mapState.interval = null;
        }

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

                // Build the curved flight path
                const pathCoords = buildCurvedPath(originCoords, destCoords, 600);

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

                // ─── VEHICLE MARKER ─────────────────────────────────────────
                // Use Google Maps built-in icons — always loads, never fails
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

                // Restore saved position from localStorage (so refresh keeps the position)
                const saved = localStorage.getItem('PF_IDX_' + s.tracking_id);
                if (saved !== null) {
                    mapState.index = Math.min(parseInt(saved, 10), pathCoords.length - 1);
                } else {
                    // First time: position marker based on current status
                    let pct = 0;
                    if      (status === 'pending')          pct = 0;
                    else if (status === 'picked-up')        pct = 5;
                    else if (status === 'in-transit')       pct = 10;
                    else if (status === 'out-for-delivery') pct = 78;
                    else if (status === 'delivered')        pct = 100;
                    else                                    pct = 40;
                    mapState.index = Math.floor((pct / 100) * (pathCoords.length - 1));
                }
                vehicleMarker.setPosition(pathCoords[mapState.index]);

                // Fit map to show both pins
                const bounds = new google.maps.LatLngBounds();
                bounds.extend(originCoords);
                bounds.extend(destCoords);
                map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });

                // Start animation engine based on current status
                updateMapAnimation(status);
            });
        });
    }

    // === ANIMATION ENGINE ===
    // Called on first load AND on every live realtime status update from admin
    function updateMapAnimation(newStatus) {
        if (!mapState.marker || !mapState.pathCoords.length) return;

        // ALWAYS stop the existing animation first — freeze vehicle exactly where it is
        if (mapState.interval) {
            window.clearInterval(mapState.interval);
            mapState.interval = null;
        }

        // Save current position immediately (so page reload restores it)
        localStorage.setItem('PF_IDX_' + mapState.trackId, mapState.index);

        // Decide what to do based on the NEW status
        const movingStatuses = ['in-transit', 'out-for-delivery', 'picked-up'];
        const isMoving = movingStatuses.includes(newStatus);

        if (newStatus === 'delivered') {
            // Jump to destination
            mapState.index = mapState.pathCoords.length - 1;
            mapState.marker.setPosition(mapState.pathCoords[mapState.index]);
            localStorage.setItem('PF_IDX_' + mapState.trackId, mapState.index);
            return;
        }

        if (!isMoving) {
            // PAUSE — vehicle stays frozen exactly where it is
            // (interval is already cleared above, nothing more to do)
            return;
        }

        // MOVING — slowly crawl forward toward the target zone
        let targetPct = 80;
        if (newStatus === 'picked-up')        targetPct = 8;
        if (newStatus === 'in-transit')       targetPct = 80;
        if (newStatus === 'out-for-delivery') targetPct = 97;

        const maxIndex = Math.floor((targetPct / 100) * (mapState.pathCoords.length - 1));

        if (mapState.index >= maxIndex) return; // already at or past target, don't move

        // Move 1 step every 1000ms = very slow, fully controllable
        mapState.interval = window.setInterval(() => {
            if (mapState.index < maxIndex) {
                mapState.index++;
                mapState.marker.setPosition(mapState.pathCoords[mapState.index]);
                localStorage.setItem('PF_IDX_' + mapState.trackId, mapState.index);
            } else {
                window.clearInterval(mapState.interval);
                mapState.interval = null;
            }
        }, 1000); // 1 second per step = very slow and controllable
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
