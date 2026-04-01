/* ===== ADMIN.JS - Admin Dashboard with Supabase ===== */

document.addEventListener('DOMContentLoaded', () => {
    // Auth check
    if (localStorage.getItem('pf_admin_auth') !== 'true') {
        window.location.href = 'admin-login.html';
        return;
    }

    // === STATE ===
    let editingId = null;

    // === DOM REFERENCES ===
    const sidebarLinks = document.querySelectorAll('.sidebar-link[data-section]');
    const sections = document.querySelectorAll('.admin-section');
    const pageTitle = document.getElementById('pageTitle');

    // === NAVIGATION ===
    sidebarLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.dataset.section;
            switchSection(section);
        });
    });

    function switchSection(sectionName) {
        sections.forEach(s => s.classList.remove('active'));
        sidebarLinks.forEach(l => l.classList.remove('active'));

        const target = document.getElementById('section-' + sectionName);
        if (target) target.classList.add('active');

        sidebarLinks.forEach(l => {
            if (l.dataset.section === sectionName) l.classList.add('active');
        });

        const titles = {
            'dashboard': 'Dashboard',
            'shipments': 'All Shipments',
            'add-shipment': editingId ? 'Edit Shipment' : 'Add New Shipment',
            'messages': 'Messages'
        };
        pageTitle.textContent = titles[sectionName] || 'Dashboard';

        if (sectionName === 'dashboard') refreshDashboard();
        if (sectionName === 'shipments') renderShipments();
        if (sectionName === 'messages') renderMessages();

        // Close mobile sidebar
        if (sidebar) sidebar.classList.remove('open');
    }

    // === MOBILE SIDEBAR TOGGLE ===
    const menuToggle = document.getElementById('adminMenuToggle');
    const sidebar = document.getElementById('adminSidebar');
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    }

    // === LOGOUT ===
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('pf_admin_auth');
        window.location.href = 'admin-login.html';
    });

    // === HELPERS ===
    async function getShipments() {
        const { data, error } = await supabase
            .from('shipments')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            console.error('Error fetching shipments:', error);
            return [];
        }
        return data || [];
    }

    async function generateId() {
        const shipments = await getShipments();
        let max = 0;
        shipments.forEach(s => {
            const match = s.tracking_id.match(/PF-\d{4}-(\d+)/);
            if (match) max = Math.max(max, parseInt(match[1]));
        });
        return `PF-2026-${String(max + 1).padStart(3, '0')}`;
    }

    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = message;
        toast.className = 'toast ' + type;
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => toast.classList.remove('show'), 3500);
    }

    const STATUS_OPTIONS = {
        'pending': 'Pending',
        'picked-up': 'Picked Up',
        'in-transit': 'In Transit',
        'out-for-delivery': 'Out for Delivery',
        'delivered': 'Delivered',
        'on-hold': 'On Hold',
        'returned': 'Returned',
        'cancelled': 'Cancelled'
    };

    function formatStatus(status) {
        return STATUS_OPTIONS[status] || status;
    }

    // === DASHBOARD ===
    async function refreshDashboard() {
        const shipments = await getShipments();
        const { data: messages } = await supabase.from('messages').select('id');

        document.getElementById('totalShipments').textContent = shipments.length;
        document.getElementById('inTransitCount').textContent = shipments.filter(s => s.status === 'in-transit').length;
        document.getElementById('deliveredCount').textContent = shipments.filter(s => s.status === 'delivered').length;
        document.getElementById('onHoldCount').textContent = shipments.filter(s => s.status === 'on-hold' || s.status === 'pending').length;

        const tbody = document.querySelector('#recentShipmentsTable tbody');
        const recent = shipments.slice(0, 5);
        tbody.innerHTML = recent.map(s => `
            <tr>
                <td data-label="Tracking ID"><strong>${s.tracking_id}</strong></td>
                <td data-label="Sender">${s.sender}</td>
                <td data-label="Receiver">${s.receiver}</td>
                <td data-label="Status"><span class="status-badge ${s.status}">${formatStatus(s.status)}</span></td>
                <td data-label="Date">${s.ship_date ? new Date(s.ship_date).toLocaleDateString() : 'N/A'}</td>
            </tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:40px;"><div style="font-size:2.5rem; margin-bottom:12px;">📦</div>No shipments yet. Create your first shipment to get started!</td></tr>';
    }

    // === SHIPMENTS LIST ===
    async function renderShipments(filter = 'all', search = '') {
        let shipments = await getShipments();

        if (filter !== 'all') {
            shipments = shipments.filter(s => s.status === filter);
        }
        if (search) {
            const q = search.toLowerCase();
            shipments = shipments.filter(s =>
                s.tracking_id.toLowerCase().includes(q) ||
                (s.sender && s.sender.toLowerCase().includes(q)) ||
                (s.receiver && s.receiver.toLowerCase().includes(q)) ||
                (s.origin && s.origin.toLowerCase().includes(q)) ||
                (s.destination && s.destination.toLowerCase().includes(q))
            );
        }

        const tbody = document.querySelector('#allShipmentsTable tbody');
        tbody.innerHTML = shipments.map(s => `
            <tr>
                <td data-label="Tracking ID"><strong>${s.tracking_id}</strong></td>
                <td data-label="Sender">${s.sender || ''}</td>
                <td data-label="Receiver">${s.receiver || ''}</td>
                <td data-label="Origin">${s.origin || 'N/A'}</td>
                <td data-label="Destination">${s.destination || 'N/A'}</td>
                <td data-label="Status"><span class="status-badge ${s.status}">${formatStatus(s.status)}</span></td>
                <td data-label="Actions">
                    <div class="action-btns-group">
                        <button class="action-btn" title="Update Status" onclick="openStatusModal('${s.tracking_id}')">📝</button>
                        <button class="action-btn" title="Edit" onclick="editShipment('${s.tracking_id}')">✏️</button>
                        <button class="action-btn delete" title="Delete" onclick="deleteShipment('${s.tracking_id}')">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:40px;"><div style="font-size:2.5rem; margin-bottom:12px;">📦</div>No shipments found. Create your first one!</td></tr>';
    }

    // Filter & search listeners
    document.getElementById('filterStatus').addEventListener('change', (e) => {
        renderShipments(e.target.value, document.getElementById('searchShipments').value);
    });
    document.getElementById('searchShipments').addEventListener('input', (e) => {
        renderShipments(document.getElementById('filterStatus').value, e.target.value);
    });

    // === ADD / EDIT SHIPMENT ===
    const shipmentForm = document.getElementById('shipmentForm');
    const cancelEditBtn = document.getElementById('cancelEdit');

    document.getElementById('addTimelineBtn').addEventListener('click', addTimelineRow);

    function addTimelineRow(data = {}) {
        const container = document.getElementById('timelineEvents');
        const row = document.createElement('div');
        row.className = 'timeline-event-row';
        row.innerHTML = `
            <input type="text" placeholder="Date (YYYY-MM-DD)" value="${data.date || ''}" class="tl-date">
            <input type="text" placeholder="Time (HH:MM)" value="${data.time || ''}" class="tl-time">
            <input type="text" placeholder="Event description" value="${data.event || ''}" class="tl-event">
            <input type="text" placeholder="Location" value="${data.location || ''}" class="tl-location">
            <button type="button" class="remove-event-btn" onclick="this.parentElement.remove()">✕</button>
        `;
        container.appendChild(row);
    }

    shipmentForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        // Gather timeline events
        const timelineRows = document.querySelectorAll('.timeline-event-row');
        const timeline = [];
        timelineRows.forEach(row => {
            const date = row.querySelector('.tl-date').value.trim();
            const time = row.querySelector('.tl-time') ? row.querySelector('.tl-time').value.trim() : '';
            const event = row.querySelector('.tl-event').value.trim();
            const location = row.querySelector('.tl-location').value.trim();
            if (event) {
                timeline.push({ date, time, event, location });
            }
        });

        const trackingId = editingId || await generateId();

        const shipmentData = {
            tracking_id: trackingId,
            type: document.getElementById('shipType').value,
            sender: document.getElementById('shipSender').value.trim(),
            sender_email: document.getElementById('shipSenderEmail').value.trim(),
            sender_number: document.getElementById('shipSenderNumber').value.trim(),
            receiver: document.getElementById('shipReceiver').value.trim(),
            receiver_email: document.getElementById('shipReceiverEmail').value.trim(),
            receiver_number: document.getElementById('shipReceiverNumber').value.trim(),
            origin: document.getElementById('shipOrigin').value.trim(),
            destination: document.getElementById('shipDest').value.trim(),
            weight: parseFloat(document.getElementById('shipWeight').value) || 0,
            status: document.getElementById('shipStatus').value,
            ship_date: document.getElementById('shipDate').value || null,
            delivery_date: document.getElementById('shipDeliveryDate').value || null,
            delivery_time: document.getElementById('shipDeliveryTime').value || null,
            piece_type: document.getElementById('shipPieceType').value.trim(),
            description: document.getElementById('shipDescription').value.trim(),
            timeline: timeline
        };

        // Auto-add "Shipment Created" timeline if new and no timeline
        if (!editingId && timeline.length === 0) {
            const now = new Date();
            shipmentData.timeline = [{
                date: now.toISOString().split('T')[0],
                time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                event: 'Shipment created',
                location: shipmentData.origin || ''
            }];
        }

        if (editingId) {
            // Update existing in Supabase
            const { error } = await supabase
                .from('shipments')
                .update(shipmentData)
                .eq('tracking_id', editingId);

            if (error) {
                showToast('Error updating shipment: ' + error.message, 'error');
                return;
            }
            showToast('Shipment updated successfully!');
            editingId = null;
            cancelEditBtn.style.display = 'none';
            document.getElementById('formTitle').textContent = 'Add New Shipment';
        } else {
            // Insert new into Supabase
            const { error } = await supabase
                .from('shipments')
                .insert([shipmentData]);

            if (error) {
                showToast('Error creating shipment: ' + error.message, 'error');
                return;
            }
            showToast('Shipment created! Tracking ID: ' + shipmentData.tracking_id);
        }

        shipmentForm.reset();
        document.getElementById('timelineEvents').innerHTML = '';
        document.getElementById('shipTrackingId').value = '';
        switchSection('shipments');
    });

    // Cancel edit
    cancelEditBtn.addEventListener('click', () => {
        editingId = null;
        cancelEditBtn.style.display = 'none';
        document.getElementById('formTitle').textContent = 'Add New Shipment';
        shipmentForm.reset();
        document.getElementById('timelineEvents').innerHTML = '';
        document.getElementById('shipTrackingId').value = '';
    });

    // Edit Shipment (global)
    window.editShipment = async function(trackingId) {
        const { data, error } = await supabase
            .from('shipments')
            .select('*')
            .eq('tracking_id', trackingId)
            .single();

        if (error || !data) return;
        const s = data;

        editingId = trackingId;
        document.getElementById('formTitle').textContent = 'Edit Shipment: ' + trackingId;
        cancelEditBtn.style.display = 'inline-flex';

        document.getElementById('shipTrackingId').value = s.tracking_id;
        document.getElementById('shipType').value = s.type || '';
        document.getElementById('shipSender').value = s.sender || '';
        document.getElementById('shipSenderEmail').value = s.sender_email || '';
        document.getElementById('shipSenderNumber').value = s.sender_number || '';
        document.getElementById('shipReceiver').value = s.receiver || '';
        document.getElementById('shipReceiverEmail').value = s.receiver_email || '';
        document.getElementById('shipReceiverNumber').value = s.receiver_number || '';
        document.getElementById('shipOrigin').value = s.origin || '';
        document.getElementById('shipDest').value = s.destination || '';
        document.getElementById('shipWeight').value = s.weight || '';
        document.getElementById('shipStatus').value = s.status || 'pending';
        document.getElementById('shipDate').value = s.ship_date || '';
        document.getElementById('shipDeliveryDate').value = s.delivery_date || '';
        document.getElementById('shipDeliveryTime').value = s.delivery_time || '';
        document.getElementById('shipPieceType').value = s.piece_type || '';
        document.getElementById('shipDescription').value = s.description || '';

        const container = document.getElementById('timelineEvents');
        container.innerHTML = '';
        if (s.timeline && s.timeline.length > 0) {
            s.timeline.forEach(t => addTimelineRow(t));
        }

        switchSection('add-shipment');
        pageTitle.textContent = 'Edit Shipment';
    };

    // Delete Shipment (global)
    window.deleteShipment = async function(trackingId) {
        if (!confirm('Delete shipment ' + trackingId + '? This cannot be undone.')) return;

        const { error } = await supabase
            .from('shipments')
            .delete()
            .eq('tracking_id', trackingId);

        if (error) {
            showToast('Error deleting: ' + error.message, 'error');
            return;
        }
        showToast('Shipment deleted.', 'error');
        renderShipments();
        refreshDashboard();
    };

    // === STATUS MODAL (Enhanced) ===
    const modal = document.getElementById('editModal');
    const closeModal = document.getElementById('closeModal');

    window.openStatusModal = async function(trackingId) {
        const { data, error } = await supabase
            .from('shipments')
            .select('*')
            .eq('tracking_id', trackingId)
            .single();

        if (error || !data) return;
        const s = data;

        document.getElementById('modalTrackId').value = s.tracking_id;
        document.getElementById('modalStatus').value = s.status;
        document.getElementById('modalEvent').value = '';
        document.getElementById('modalLocation').value = '';

        // Show current timeline in modal
        const previewEl = document.getElementById('modalTimelinePreview');
        if (previewEl && s.timeline && s.timeline.length > 0) {
            previewEl.innerHTML = '<h4 style="margin-bottom:8px; font-size:0.85rem; color:var(--accent);">Current Timeline:</h4>' +
                s.timeline.slice(0, 3).map(t => `
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:4px; padding-left:12px; border-left:2px solid var(--accent);">
                        <strong>${t.date} ${t.time || ''}</strong> — ${t.event} <em>(${t.location})</em>
                    </div>
                `).join('');
        }

        // Auto-suggest event
        const statusSelect = document.getElementById('modalStatus');
        const eventInput = document.getElementById('modalEvent');
        statusSelect.onchange = function() {
            const suggestions = {
                'pending': 'Shipment created - Awaiting pickup',
                'picked-up': 'Package picked up from sender',
                'in-transit': 'Shipment in transit',
                'out-for-delivery': 'Package out for delivery',
                'delivered': 'Package delivered successfully',
                'on-hold': 'Shipment placed on hold',
                'returned': 'Package returned to sender',
                'cancelled': 'Shipment cancelled'
            };
            if (!eventInput.value) {
                eventInput.value = suggestions[this.value] || '';
            }
        };

        modal.classList.add('show');
    };

    closeModal.addEventListener('click', () => modal.classList.remove('show'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });

    document.getElementById('saveStatusBtn').addEventListener('click', async () => {
        const trackingId = document.getElementById('modalTrackId').value;
        const newStatus = document.getElementById('modalStatus').value;
        const newEvent = document.getElementById('modalEvent').value.trim();
        const newLocation = document.getElementById('modalLocation').value.trim();

        // Get current shipment
        const { data: s, error: fetchErr } = await supabase
            .from('shipments')
            .select('*')
            .eq('tracking_id', trackingId)
            .single();

        if (fetchErr || !s) return;

        const timeline = s.timeline || [];
        const now = new Date();
        timeline.unshift({
            date: now.toISOString().split('T')[0],
            time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            event: newEvent || `Status changed to ${formatStatus(newStatus)}`,
            location: newLocation || ''
        });

        const { error } = await supabase
            .from('shipments')
            .update({ status: newStatus, timeline: timeline })
            .eq('tracking_id', trackingId);

        if (error) {
            showToast('Error: ' + error.message, 'error');
            return;
        }

        // --- NEW CODE: Send Email Notification via EmailJS ---
        // Only send if the email exists and the status actually changed
        if (s.receiver_email && s.status !== newStatus) {
            const templateParams = {
                tracking_number: trackingId,
                to_name: s.receiver || 'Customer',
                to_email: s.receiver_email,
                new_status: formatStatus(newStatus)
            };

            // Using the new Shipment Update Template ID
            emailjs.send('service_vlwtmqa', 'template_g1eys3j', templateParams)
                .then(() => {
                    console.log('Shipment update email sent successfully to', s.receiver_email);
                    showToast('Email sent to customer!');
                })
                .catch((err) => {
                    console.error('Failed to send email:', err);
                });
        }
        // --- END NEW CODE ---

        modal.classList.remove('show');
        showToast('Status updated to: ' + formatStatus(newStatus));
        renderShipments();
        refreshDashboard();
    });

    // === MESSAGES (from Supabase) ===
    async function renderMessages() {
        const { data: messages, error } = await supabase
            .from('messages')
            .select('*')
            .order('created_at', { ascending: false });

        const container = document.getElementById('messagesList');

        if (error || !messages || messages.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:40px; color:var(--text-muted);">
                    <div style="font-size:2.5rem; margin-bottom:12px;">💬</div>
                    <p>No messages yet. Messages from the contact form will appear here.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = messages.map(m => `
            <div class="message-card">
                <div class="message-card-header">
                    <h4>${m.name}</h4>
                    <span>${new Date(m.created_at).toLocaleDateString()}</span>
                </div>
                <p>${m.message}</p>
                <div class="message-meta" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <span>📧 ${m.email} ${m.phone ? '· 📞 ' + m.phone : ''} · Subject: ${m.subject || 'N/A'}</span>
                    <button class="action-btn delete" onclick="deleteMessage(${m.id})" title="Delete">🗑️</button>
                </div>
            </div>
        `).join('');
    }

    window.deleteMessage = async function(id) {
        if (!confirm('Delete this message?')) return;
        const { error } = await supabase.from('messages').delete().eq('id', id);
        if (error) { showToast('Error: ' + error.message, 'error'); return; }
        showToast('Message deleted.', 'error');
        renderMessages();
    };

    // === INIT ===
    refreshDashboard();
});
