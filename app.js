/**
 * momentLog - Main Logic (Phase 2 Refactor)
 * Features: Collage Support, Auto-Location, Max 5 Photos, Robust Error Handling.
 */

// --- Constants & State ---
const STORAGE_KEY = 'momentLog_data_v2'; // Changed key to avoid conflict/reset
const MAX_PHOTOS = 5;

let moments = [];
let currentMedia = []; // { type: 'image'|'audio', data: 'base64...' }
let currentLocation = null;
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

// --- Selectors ---
const dom = {
    input: document.getElementById('momentInput'),
    addBtn: document.getElementById('addMomentBtn'),
    timeline: document.getElementById('timeline'),

    // Tools
    photoInput: document.getElementById('photoInput'),
    recordBtn: document.getElementById('recordBtn'),
    // locationBtn removed from manual trigger, used for status display now if we want

    // Status/Preview
    previewArea: document.getElementById('mediaPreview'),
    locationStatus: document.getElementById('locationStatus'),
    // startStoryBtn removed
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadMoments();
    renderTimeline();
    setupEventListeners();

    // Auto-fetch location quietly
    fetchLocation();
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
    const newMoment = {
        id: crypto.randomUUID(),
        content: text.trim(),
        createdAt: Date.now(),
        location: currentLocation, // Auto-fetched
        media: [...currentMedia],
        // theme removed, now handled by automatic collage layout
    };

    // Optimistic UI update
    moments.unshift(newMoment);

    if (saveMoments()) {
        // Reset State only on success
        currentMedia = [];
        // Keep location for next moment
        dom.previewArea.innerHTML = '';
        dom.input.value = '';
        dom.input.style.height = 'auto';
        renderPreview(); // Clear preview UI
    } else {
        // Rollback
        moments.shift();
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

function fetchLocation() {
    dom.locationStatus.textContent = "📍 Konum alınıyor...";
    dom.locationStatus.classList.remove('hidden');

    if (!navigator.geolocation) {
        useMockLocation();
        return;
    }

    const timeout = setTimeout(() => {
        useMockLocation();
    }, 3000); // 3s timeout

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            clearTimeout(timeout);
            currentLocation = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                text: `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`
            };
            dom.locationStatus.textContent = `📍 ${currentLocation.text}`;
        },
        (err) => {
            clearTimeout(timeout);
            useMockLocation();
        }
    );
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
}

function renderTimeline() {
    dom.timeline.innerHTML = '';

    if (moments.length === 0) {
        dom.timeline.innerHTML = `
            <div class="empty-state">
                <p>Henüz anı yok. İlk sayfanı oluştur!</p>
            </div>
        `;
        return;
    }

    moments.forEach(moment => {
        const page = document.createElement('article');
        page.className = 'journal-page';

        const dateObj = new Date(moment.createdAt);
        const dateStr = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
        const timeStr = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        const locationHtml = moment.location
            ? `<button class="location-tag" onclick="window.playLocationStory('${moment.location.text}')">📍 ${moment.location.text} • Hikayeyi İzle</button>`
            : '';

        // Media Separation
        const images = moment.media.filter(m => m.type === 'image');
        const audios = moment.media.filter(m => m.type === 'audio');

        // Collage Grid Logic
        let collageHtml = '';
        if (images.length > 0) {
            const count = images.length;
            const gridClass = `collage-grid grid-${count}`;

            collageHtml = `<div class="${gridClass}">`;
            images.forEach(img => {
                collageHtml += `<div class="collage-item"><img src="${img.data}" loading="lazy"></div>`;
            });
            collageHtml += `</div>`;
        }

        let audioHtml = '';
        if (audios.length > 0) {
            audioHtml = `<div class="audio-section">`;
            audios.forEach(aud => {
                audioHtml += `<audio controls src="${aud.data}" class="page-audio"></audio>`;
            });
            audioHtml += `</div>`;
        }

        page.innerHTML = `
            <div class="page-header">
                <span class="page-date">${dateStr} <small>${timeStr}</small></span>
                <button class="menu-btn" onclick="window.requestDelete('${moment.id}')">⋮</button>
            </div>
            
            ${collageHtml}
            
            <div class="page-content">
                ${audioHtml}
                <div class="page-text">${escapeHtml(moment.content)}</div>
                ${locationHtml}
            </div>
        `;

        dom.timeline.appendChild(page);
    });
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.requestDelete = deleteMoment;
