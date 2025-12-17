/**
 * momentLog - Main Logic (Phase 2 Refactor)
 * Features: Collage Support, Auto-Location, Max 5 Photos, Robust Error Handling.
 */

// --- Constants & State ---
const STORAGE_KEY = 'momentLog_data_v2'; // Changed key to avoid conflict/reset
const MAX_PHOTOS = 5;

let moments = [];
let currentMedia = [];
let currentLocation = null;
let currentSong = null; // { title: '', id: '' }
let isRecording = false;
let isDictating = false;
let mediaRecorder = null;
let audioChunks = [];

// --- Selectors ---
const dom = {
    input: document.getElementById('momentInput'),
    addBtn: document.getElementById('addMomentBtn'),
    timeline: document.getElementById('timeline'),
    searchInput: document.getElementById('searchInput'),
    exportBtn: document.getElementById('exportBtn'),
    importInput: document.getElementById('importInput'),
    immersiveView: document.getElementById('immersiveView'),

    // Tools
    photoInput: document.getElementById('photoInput'),
    recordBtn: document.getElementById('recordBtn'),
    dictateBtn: document.getElementById('dictateBtn'),
    musicBtn: document.getElementById('musicBtn'),
    themeSelect: document.getElementById('themeSelect'),

    // Status/Preview
    previewArea: document.getElementById('mediaPreview'),
    locationStatus: document.getElementById('locationStatus'),
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadMoments();
    renderTimeline();
    setupEventListeners();

    // Auto-fetch location quietly
    fetchLocation();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('Service Worker Registered');
                reg.onupdatefound = () => {
                    const installingWorker = reg.installing;
                    installingWorker.onstatechange = () => {
                        if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New content is available, force reload
                            if (confirm("Yeni bir güncelleme mevcut! Uygulamayı yenilemek ister misiniz?")) {
                                location.reload();
                            }
                        }
                    };
                };
            })
            .catch(err => console.error('SW Registration Failed', err));
    }
});

function setupEventListeners() {
    dom.addBtn.addEventListener('click', handleAddMoment);

    // Auto-resize
    dom.input.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    // Photo handling
    dom.photoInput.addEventListener('change', handlePhotoUpload);

    // Audio handling
    dom.recordBtn.addEventListener('click', toggleRecording);

    // Dictation handling
    dom.dictateBtn.addEventListener('click', toggleDictation);

    // Music handling
    dom.musicBtn.addEventListener('click', handleMusicPick);

    // Search
    dom.searchInput.addEventListener('input', (e) => {
        renderTimeline(e.target.value);
    });

    // Export
    dom.exportBtn.addEventListener('click', exportData);

    // Import
    dom.importInput.addEventListener('change', importData);
}

// --- Data Operations ---

function loadMoments() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        moments = data ? JSON.parse(data) : [];
    } catch (e) {
        console.error("Critical: Failed to load data", e);
        moments = [];
    }
}

function saveMoments() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(moments));
        renderTimeline();
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            alert('Hafıza doldu! Lütfen bazı eski kayıtları silin veya daha az fotoğraf ekleyin.');
        } else {
            alert('Kaydetme başarısız: ' + e.message);
        }
        console.error(e);
        return false;
    }
}

function createMoment(text) {
    if (window._editingId) {
        const idx = moments.findIndex(m => m.id === window._editingId);
        if (idx !== -1) {
            moments[idx].content = text.trim();
            moments[idx].media = [...currentMedia];
            moments[idx].location = currentLocation;
            moments[idx].song = currentSong;
            moments[idx].theme = dom.themeSelect.value;
        }
        window._editingId = null;
        dom.addBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Ekle
        `;
    } else {
        const newMoment = {
            id: (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString()),
            content: text.trim(),
            createdAt: Date.now(),
            location: currentLocation,
            media: [...currentMedia],
            song: currentSong,
            theme: dom.themeSelect.value
        };
        moments.unshift(newMoment);
    }

    if (saveMoments()) {
        currentMedia = [];
        currentSong = null;
        dom.previewArea.innerHTML = '';
        dom.input.value = '';
        dom.input.style.height = 'auto';
        renderTimeline();
        renderPreview();
    }
}

function deleteMoment(id) {
    if (confirm('Bu günlük sayfası silinsin mi?')) {
        moments = moments.filter(m => m.id !== id);
        saveMoments();
    }
}

// --- Media Handlers ---

function handlePhotoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (currentMedia.filter(m => m.type === 'image').length >= MAX_PHOTOS) {
        alert(`En fazla ${MAX_PHOTOS} fotoğraf ekleyebilirsiniz.`);
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxDim = 800; // Aggressive resize
            let width = img.width;
            let height = img.height;

            if (width > height && width > maxDim) {
                height *= maxDim / width;
                width = maxDim;
            } else if (height > maxDim) {
                width *= maxDim / height;
                height = maxDim;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // High compression: 0.6 quality
            const base64 = canvas.toDataURL('image/jpeg', 0.6);

            currentMedia.push({ type: 'image', data: base64 });
            renderPreview();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

async function toggleRecording() {
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = event => audioChunks.push(event.data);

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    const base64 = reader.result;
                    currentMedia.push({ type: 'audio', data: base64 });
                    renderPreview();
                };
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            isRecording = true;
            dom.recordBtn.classList.add('recording');
        } catch (err) {
            alert('Mikrofon erişimi sağlanamadı.');
        }
    } else {
        mediaRecorder.stop();
        isRecording = false;
        dom.recordBtn.classList.remove('recording');
    }
}

async function fetchLocation() {
    dom.locationStatus.textContent = "📍 Konum alınıyor...";
    dom.locationStatus.classList.remove('hidden');

    if (!navigator.geolocation) {
        useMockLocation();
        return;
    }

    const timeout = setTimeout(() => {
        useMockLocation();
    }, 5000);

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            clearTimeout(timeout);
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;

            // Reverse Geocoding via Nominatim
            try {
                const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
                const data = await response.json();
                const address = data.address;

                // Detailed Format: Mahalle, İlçe/İl
                const neighborhood = address.neighbourhood || address.suburb || address.village || "";
                const district = address.district || address.city_district || address.town || "";
                const city = address.city || address.province || address.state || "";

                let locationText = "";
                if (neighborhood) locationText += neighborhood;
                if (district) locationText += (locationText ? ", " : "") + district;
                if (city) locationText += (locationText ? "/" : "") + city;

                currentLocation = {
                    lat, lng,
                    text: locationText || "Bilinmeyen Konum"
                };
            } catch (e) {
                currentLocation = { lat, lng, text: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
            }
            dom.locationStatus.textContent = `📍 ${currentLocation.text}`;
        },
        (err) => {
            clearTimeout(timeout);
            useMockLocation();
        }
    );
}

function toggleDictation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Tarayıcınız dikte özelliğini desteklemiyor.");
        return;
    }

    if (!isDictating) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'tr-TR';
        recognition.interimResults = true;

        recognition.onstart = () => {
            isDictating = true;
            dom.dictateBtn.classList.add('recording');
        };

        recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0].transcript)
                .join('');
            dom.input.value = transcript;
            dom.input.style.height = (dom.input.scrollHeight) + 'px';
        };

        recognition.onerror = () => { stopDictation(); };
        recognition.onend = () => { stopDictation(); };

        recognition.start();
        window._currentRecognition = recognition;
    } else {
        stopDictation();
    }
}

function stopDictation() {
    if (window._currentRecognition) window._currentRecognition.stop();
    isDictating = false;
    dom.dictateBtn.classList.remove('recording');
}

function handleMusicPick() {
    const query = prompt(" Spotify'da aramak istediğiniz şarkı ismi:");
    if (!query) return;

    // We simulate a search and use the Spotify search URL for embedding
    // In a real app we'd use Spotify API, here we allow pasting a link or just saving the query
    // Simplified: We try to detect if it's already a link, else we keep the query
    if (query.includes('spotify.com')) {
        let trackId = query.split('track/')[1]?.split('?')[0];
        if (trackId) {
            currentSong = { title: "Spotify Şarkısı", id: trackId };
        }
    } else {
        currentSong = { title: query, isSearch: true };
    }
    renderPreview();
}

function exportData() {
    const dataStr = JSON.stringify(moments, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportFileDefaultName = `momentLog_backup_${new Date().toISOString().split('T')[0]}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedMoments = JSON.parse(event.target.result);
            if (!Array.isArray(importedMoments)) throw new Error("Format geçersiz.");

            if (confirm(`${importedMoments.length} anı içe aktarılsın mı? Mevcut anılarınızla birleştirilecek.`)) {
                // Merge by ID to avoid duplicates
                const existingIds = new Set(moments.map(m => m.id));
                const newOnly = importedMoments.filter(m => !existingIds.has(m.id));
                moments = [...newOnly, ...moments];
                saveMoments();
                alert("İçe aktarma başarılı!");
            }
        } catch (err) {
            alert("Dosya okunamadı veya format hatalı.");
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

function useMockLocation() {
    currentLocation = { lat: 41.0082, lng: 28.9784, text: "İstanbul, TR (Tahmini)" };
    dom.locationStatus.textContent = `📍 ${currentLocation.text}`;
}

// --- Rendering ---

function renderPreview() {
    dom.previewArea.innerHTML = '';

    const photos = currentMedia.filter(m => m.type === 'image');

    currentMedia.forEach((media, index) => {
        const el = document.createElement('div');
        el.className = 'preview-item';

        if (media.type === 'image') {
            el.innerHTML = `<img src="${media.data}">`;
        } else if (media.type === 'audio') {
            el.innerHTML = `<div class="audio-badge">🎤 Ses</div>`;
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-media';
        removeBtn.innerHTML = '×';
        removeBtn.onclick = () => {
            currentMedia.splice(index, 1);
            renderPreview();
        };
        el.appendChild(removeBtn);

        dom.previewArea.appendChild(el);
    });

    if (currentSong) {
        const sel = document.createElement('div');
        sel.className = 'preview-item song-preview';
        sel.innerHTML = `<div class="audio-badge">🎵 ${currentSong.title.substring(0, 8)}...</div>`;
        sel.onclick = () => { currentSong = null; renderPreview(); };
        dom.previewArea.appendChild(sel);
    }
}

function renderTimeline(filter = "") {
    dom.timeline.innerHTML = '';
    const filteredMoments = filter
        ? moments.filter(m =>
            m.content.toLowerCase().includes(filter.toLowerCase()) ||
            (m.location && m.location.text.toLowerCase().includes(filter.toLowerCase()))
        )
        : moments;

    if (filteredMoments.length === 0) {
        dom.timeline.innerHTML = `
            <div class="empty-state">
                <p>${filter ? 'Aramanızla eşleşen anı bulunamadı.' : 'Henüz anı yok. İlk sayfanı oluştur!'}</p>
            </div>
        `;
        return;
    }

    // Grouping Logic: Year -> Month -> Moments
    const grouped = {};
    filteredMoments.forEach(m => {
        const d = new Date(m.createdAt);
        const year = d.getFullYear();
        const month = d.toLocaleDateString('tr-TR', { month: 'long' });

        if (!grouped[year]) grouped[year] = {};
        if (!grouped[year][month]) grouped[year][month] = [];
        grouped[year][month].push(m);
    });

    // Render years
    const years = Object.keys(grouped).sort((a, b) => b - a);
    years.forEach(year => {
        const yearSec = document.createElement('section');
        yearSec.className = 'archival-year';
        yearSec.innerHTML = `<h3 class="year-title">${year}</h3>`;

        const months = Object.keys(grouped[year]); // Months stay in order of moments usually
        months.forEach(month => {
            const monthSec = document.createElement('div');
            monthSec.className = 'archival-month';
            monthSec.innerHTML = `<h4 class="month-title">${month}</h4>`;

            const list = document.createElement('div');
            list.className = 'moment-list-compact';

            grouped[year][month].forEach(moment => {
                const item = document.createElement('div');
                item.className = 'moment-item-compact';
                item.onclick = () => openImmersiveView(moment);

                const dateObj = new Date(moment.createdAt);
                const dayStr = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
                const locText = moment.location ? moment.location.text : "Konum Yok";

                item.innerHTML = `
                    <span class="m-date">${dayStr}</span>
                    <span class="m-divider">|</span>
                    <span class="m-location">${locText}</span>
                    <div class="m-action-wrapper">
                        <button class="m-action-trigger" onclick="event.stopPropagation(); window.toggleMomentMenu('${moment.id}')">⋮</button>
                        <div class="m-action-menu" id="menu-${moment.id}">
                            <button onclick="event.stopPropagation(); window.editMoment('${moment.id}')">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                Düzenle
                            </button>
                            <button class="m-btn-delete" onclick="event.stopPropagation(); window.requestDelete('${moment.id}')">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                Sil
                            </button>
                            <button class="m-btn-cancel" onclick="event.stopPropagation(); window.toggleMomentMenu('${moment.id}')">Vazgeç</button>
                        </div>
                    </div>
                `;
                list.appendChild(item);
            });

            monthSec.appendChild(list);
            yearSec.appendChild(monthSec);
        });

        dom.timeline.appendChild(yearSec);
    });
}

function openImmersiveView(moment) {
    const view = dom.immersiveView;
    const dateObj = new Date(moment.createdAt);
    const dateStr = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

    // Apply Theme
    view.className = `immersive-modal theme-${moment.theme || 'default'}`;

    const images = moment.media.filter(m => m.type === 'image');
    const audio = moment.media.find(m => m.type === 'audio');

    // Immersive Auto-play Audio
    let backgroundAudio = null;
    if (audio) {
        backgroundAudio = new Audio(audio.data);
        backgroundAudio.play().catch(() => console.log("Auto-play blocked"));
    }

    // Spotify Embed
    let spotifyHtml = '';
    if (moment.song) {
        if (moment.song.id) {
            spotifyHtml = `<div class="spotify-embed">
                <iframe src="https://open.spotify.com/embed/track/${moment.song.id}" width="100%" height="80" frameBorder="0" allowtransparency="true" allow="encrypted-media"></iframe>
            </div>`;
        } else {
            spotifyHtml = `<div class="song-tag">🎵 ${moment.song.title}</div>`;
        }
    }

    // Interspersed Layout Logic
    const paragraphs = moment.content.split('\n').filter(p => p.trim() !== '');
    let bodyHtml = '';
    let imgIdx = 0;

    paragraphs.forEach((p, idx) => {
        bodyHtml += `<p class="interspersed-text">${escapeHtml(p)}</p>`;
        if (imgIdx < images.length) {
            bodyHtml += `<div class="img-container"><img src="${images[imgIdx].data}" class="immersive-img"></div>`;
            imgIdx++;
        }
    });

    while (imgIdx < images.length) {
        bodyHtml += `<div class="img-container"><img src="${images[imgIdx].data}" class="immersive-img"></div>`;
        imgIdx++;
    }

    view.innerHTML = `
        <button class="close-immersive">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <div class="immersive-content">
            <header class="immersive-header">
                <h2 class="immersive-date">${dateStr}</h2>
                ${moment.location ? `<span class="immersive-location">📍 ${moment.location.text}</span>` : ''}
                ${spotifyHtml}
            </header>
            <div class="immersive-body">
                ${bodyHtml}
            </div>
        </div>
    `;

    view.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    view.querySelector('.close-immersive').onclick = () => {
        if (backgroundAudio) backgroundAudio.pause();
        view.classList.add('hidden');
        document.body.style.overflow = '';
        view.className = 'immersive-modal hidden';
    };
}

function handleAddMoment() {
    const text = dom.input.value;

    if (!text.trim() && currentMedia.length === 0) {
        dom.input.focus();
        return;
    }
    createMoment(text);
}

// Start location story
window.playLocationStory = (locText) => {
    // Filter moments by rough location match
    const storyList = moments.filter(m => m.location && m.location.text === locText);
    if (storyList.length > 0) {
        const story = new StoryMode(storyList);
        story.start();
    }
};

window.toggleMomentMenu = (id) => {
    const allMenus = document.querySelectorAll('.m-action-menu');
    allMenus.forEach(m => {
        if (m.id !== `menu-${id}`) m.classList.remove('active');
    });
    const menu = document.getElementById(`menu-${id}`);
    menu.classList.toggle('active');
};

window.editMoment = (id) => {
    const moment = moments.find(m => m.id === id);
    if (!moment) return;

    // Put into edit mode
    dom.input.value = moment.content;
    dom.input.style.height = 'auto';
    dom.input.style.height = (dom.input.scrollHeight) + 'px';

    // Set state for editing
    window._editingId = id;
    currentMedia = [...moment.media];
    currentLocation = moment.location;
    currentSong = moment.song;
    dom.themeSelect.value = moment.theme || 'default';

    renderPreview();
    dom.input.focus();

    // Close menu
    window.toggleMomentMenu(id);

    // Change Add button text or mode if needed (Optional: but simple is better for now)
    dom.addBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg> Güncelle
    `;
};

// Close menus on click outside
document.addEventListener('click', () => {
    const allMenus = document.querySelectorAll('.m-action-menu');
    allMenus.forEach(m => m.classList.remove('active'));
});

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.requestDelete = deleteMoment;
