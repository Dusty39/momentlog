/**
 * momentLog - Main Logic (Rescue Mission v11)
 */

// --- Global Error Monitor ---
window.onerror = function (msg, url, line) {
    alert("Kritik Hata: " + msg + "\nSatır: " + line);
    return false;
};

console.log("momentLog: Script loading...");

// --- Constants & State ---
const STORAGE_KEY = 'momentLog_data_v2'; // Changed key to avoid conflict/reset
const MAX_PHOTOS = 10;

let moments = [];
let currentMedia = [];
let currentLocation = null;
let currentSong = null; // { title: '', id: '' }
let isRecording = false;
let isDictating = false;
let mediaRecorder = null;
let audioChunks = [];

// --- Custom Modal Helper ---
function showModal(title, message, isConfirm = false) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalMsg = document.getElementById('modalMessage');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');

        if (!modal) {
            // Fallback if modal HTML is missing
            if (isConfirm) resolve(confirm(message));
            else { alert(message); resolve(true); }
            return;
        }

        modalTitle.textContent = title;
        modalMsg.textContent = message;

        modal.classList.remove('hidden');
        cancelBtn.style.display = isConfirm ? 'block' : 'none';

        const handleConfirm = () => {
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            modal.classList.add('hidden');
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
    });
}

// --- Selectors ---
let dom = {};

function initializeSelectors() {
    dom = {
        input: document.getElementById('momentInput'),
        addBtn: document.getElementById('addMomentBtn'),
        timeline: document.getElementById('timeline'),
        searchInput: document.getElementById('searchInput'),
        immersiveView: document.getElementById('immersiveView'),
        playAllBtn: document.getElementById('playAllBtn'),

        // Tools
        photoInput: document.getElementById('photoInput'),
        recordBtn: document.getElementById('recordBtn'),
        musicBtn: document.getElementById('musicBtn'),
        themeSelect: document.getElementById('themeSelect'),

        // Status/Preview
        previewArea: document.getElementById('mediaPreview'),
        locationStatus: document.getElementById('locationStatus'),
        profileBtn: document.getElementById('profileBtn'),
        visibilityToggle: document.getElementById('visibilityToggle'),
        exploreBtn: document.getElementById('exploreBtn'),
        momentDate: document.getElementById('momentDate'),
        userNameSpan: document.getElementById('userNameSpan'),
        journalBtn: document.getElementById('journalBtn'),
        themeBtn: document.getElementById('themeBtn'),
        moodBtn: document.getElementById('moodBtn'),
    };
}

let isPublicState = false;
let currentView = 'my-moments'; // 'my-moments' or 'explore'
let isRealLocationActive = false; // New state for Gold Tick
const APP_THEMES = ['default', 'light', 'vintage'];
let currentAppTheme = localStorage.getItem('appTheme') || 'default';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initializeSelectors();
    console.log("momentLog: DOM Loaded");

    // Set default date to today
    if (dom.momentDate) {
        dom.momentDate.valueAsDate = new Date();
    }

    // View Persistence
    const savedView = localStorage.getItem('momentLog_lastView');
    if (savedView) {
        currentView = savedView;
        if (currentView === 'explore') {
            document.body.classList.add('explore-active');
        }
    }

    try {
        setupEventListeners();
        applyAppTheme(currentAppTheme);

        // Initial render based on saved view
        // Initial render based on saved view
        if (window.setView && currentView) {
            // Force re-render on init even if state matches
            window.setView(currentView, true);
        } else {
            // Fallback
            renderTimeline();
        }

        console.log("momentLog: UI Initialized Successfully");
    } catch (e) {
        console.error("Initialization Error:", e);
        showModal("Başlatma Hatası", e.message);
    }

    // Auth Listener
    AuthService.onAuthStateChanged(async (user) => {
        const loginOverlay = document.getElementById('loginOverlay');

        if (user) {
            console.log("Kullanıcı giriş yaptı:", user.displayName);
            loginOverlay.classList.remove('active');

            // Profile Button Avatar
            if (user.photoURL && dom.profileBtn) {
                const img = dom.profileBtn.querySelector('img') || document.createElement('img');
                img.src = user.photoURL;
                if (!dom.profileBtn.querySelector('img')) dom.profileBtn.appendChild(img);
                dom.profileBtn.classList.add('has-avatar');
            }

            // User Name Greeting
            if (dom.userNameSpan) {
                dom.userNameSpan.textContent = `Merhaba, ${user.displayName || 'Gezgin'}`;
            }

            // Kullanıcı profilini getir/oluştur
            await DBService.getUserProfile(user.uid);

            // Verileri Yükle
            await loadMoments();
            renderTimeline();
            fetchLocation();
            setupNotifications();
            loadUserJournals();
        } else {
            console.log("Kullanıcı giriş yapmadı.");
            loginOverlay.classList.add('active');
            dom.profileBtn.classList.remove('has-avatar');
            moments = [];
            renderTimeline();
        }
    });

    // Login Button
    document.getElementById('googleLoginBtn').addEventListener('click', async () => {
        try {
            await AuthService.signInWithGoogle();
        } catch (err) {
            console.error("Giriş hatası:", err);
            alert("Giriş yapılırken bir hata oluştu: " + err.message);
        }
    });

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

// --- Helper: Safe Event Listener ---
function safeAddListener(id, event, callback) {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(event, callback);
    } else {
        console.warn(`SafeListener: Element with ID "${id}" not found.`);
    }
}

function setupEventListeners() {
    safeAddListener('addMomentBtn', 'click', handleAddMoment);

    // Auto-resize textarea
    const inputEl = document.getElementById('momentInput');
    if (inputEl) {
        inputEl.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    }

    safeAddListener('photoInput', 'change', handlePhotoUpload);
    safeAddListener('recordBtn', 'click', toggleRecording);
    safeAddListener('musicBtn', 'click', handleMusicPick);

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderTimeline(e.target.value));
    }

    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
        themeSelect.addEventListener('change', () => renderTimeline(dom.searchInput?.value || ""));
    }

    // Disable GPS verification if date is changed
    const momentDateInput = document.getElementById('momentDate');
    if (momentDateInput) {
        momentDateInput.addEventListener('change', () => {
            if (isRealLocationActive) {
                isRealLocationActive = false;
                currentLocation = null;
                const locBtn = document.getElementById('addLocationBtn');
                if (locBtn) {
                    locBtn.classList.remove('active-location');
                    locBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"></path><circle cx="12" cy="10" r="3"></circle></svg>`;
                }
                showModal('Konum Sıfırlandı', 'Tarih değiştirildiği için konum doğrulaması iptal edildi.');
            }
        });
    }

    // Optional Listeners (Optional in some views)
    const playAllBtn = document.getElementById('playAllBtn');
    if (playAllBtn) {
        playAllBtn.onclick = () => {
            if (moments.length > 0) {
                const story = new StoryMode(moments);
                story.start();
            } else {
                showModal('Bilgi', "Henüz oynatılacak bir anı yok.");
            }
        };
    }

    const profileBtn = document.getElementById('profileBtn');
    if (profileBtn) {
        profileBtn.onclick = () => {
            const user = AuthService.currentUser();
            if (user) openProfileView(user.uid);
            else showModal('Giriş Gerekli', "Lütfen önce giriş yapın.");
        };
    }

    const visToggle = document.getElementById('visibilityToggle');
    if (visToggle) {
        visToggle.onclick = () => {
            isPublicState = !isPublicState;
            const visibleIcon = document.getElementById('visibleIcon');
            const privateIcon = document.getElementById('privateIcon');
            if (isPublicState) {
                visibleIcon?.classList.remove('hidden');
                privateIcon?.classList.add('hidden');
                visToggle.title = "Görünürlük: Herkese Açık";
            } else {
                visibleIcon?.classList.add('hidden');
                privateIcon?.classList.remove('hidden');
                visToggle.title = "Görünürlük: Sadece Ben";
            }
        };
    }

    const exploreBtn = document.getElementById('exploreBtn');
    const homeBtn = document.getElementById('homeBtn'); // New Home Button
    const inputSectionBase = document.querySelector('.input-section');
    const dashboardFooter = document.getElementById('dashboardFooter');
    const searchHeaderBtn = document.getElementById('searchBtn');

    // View Switching Logic
    window.setView = async (viewName, force = false) => {
        if (!force && currentView === viewName) return;

        currentView = viewName;
        localStorage.setItem('momentLog_lastView', currentView);

        if (currentView === 'explore') {
            exploreBtn?.classList.add('active');
            homeBtn?.classList.remove('active');
            document.querySelector('h1').textContent = "Keşfet";

            inputSectionBase?.classList.add('hidden-mode');
            dashboardFooter?.classList.add('hidden-mode');
        } else {
            exploreBtn?.classList.remove('active');
            homeBtn?.classList.add('active');
            document.querySelector('h1').textContent = "momentLog";

            inputSectionBase?.classList.remove('hidden-mode');
            dashboardFooter?.classList.remove('hidden-mode');
        }

        await loadMoments();
        renderTimeline();
    };

    if (homeBtn) {
        homeBtn.onclick = () => window.setView('my-moments');
    }

    if (exploreBtn) {
        exploreBtn.onclick = () => window.setView('explore');
    }

    const appThemeBtn = document.getElementById('appThemeBtn');
    if (appThemeBtn) {
        appThemeBtn.onclick = () => {
            const nextIdx = (APP_THEMES.indexOf(currentAppTheme) + 1) % APP_THEMES.length;
            currentAppTheme = APP_THEMES[nextIdx];
            localStorage.setItem('appTheme', currentAppTheme);
            applyAppTheme(currentAppTheme);
        };
    }

    const notiBtn = document.getElementById('notiBtn');
    if (notiBtn) notiBtn.onclick = window.openNotiView;

    const closeNoti = document.getElementById('closeNoti');
    if (closeNoti) {
        closeNoti.onclick = () => {
            const notiView = document.getElementById('notiView');
            if (notiView) notiView.classList.add('hidden');
            document.body.style.overflow = '';
        };
    }

    const mapBtn = document.getElementById('mapBtn');
    if (mapBtn) {
        mapBtn.onclick = () => {
            const mapView = document.getElementById('mapView');
            if (mapView) {
                const isHidden = mapView.classList.contains('hidden');
                if (isHidden) {
                    mapView.classList.remove('hidden');
                    window.initMap();
                } else {
                    mapView.classList.add('hidden');
                }
            }
        };
    }

    // Custom Selectors
    safeAddListener('journalBtn', 'click', () => {
        const currentUser = AuthService.currentUser();
        if (!currentUser) return showModal('Giriş Gerekli', "Lütfen önce giriş yapın.");
        window.openJournalSelector();
    });

    safeAddListener('themeBtn', 'click', () => {
        window.openThemeSelector();
    });

    safeAddListener('moodBtn', 'click', () => {
        window.openMoodSelector();
    });
}

// --- App Theme System ---
function applyAppTheme(theme) {
    // Remove all theme classes
    document.body.classList.remove('app-theme-light', 'app-theme-vintage');

    // Apply selected theme
    if (theme === 'light') {
        document.body.classList.add('app-theme-light');
    } else if (theme === 'vintage') {
        document.body.classList.add('app-theme-vintage');
    }
    // 'default' has no class (uses :root variables)
}

// --- Data Operations ---

async function loadMoments() {
    try {
        let data;
        if (currentView === 'explore') {
            data = await DBService.getPublicMoments();
            console.log("Kamu akışı yüklendi:", data.length);
        } else {
            data = await DBService.getMyMoments();
            console.log("Kişisel anılar yüklendi:", data.length);
        }
        moments = data || [];
    } catch (e) {
        console.error("Veri yükleme hatası:", e);
        if (e.message.includes('index')) {
            alert("Firestore İndeks Hatası: Lütfen Firebase Console üzerinden gerekli indeksleri oluşturun. (Hata detayı konsolda)");
        }
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
            showModal('Hafıza Doldu', 'Lütfen bazı eski kayıtları silin veya daha az fotoğraf ekleyin.');
        } else {
            showModal('Hata', 'Kaydetme başarısız: ' + e.message);
        }
        console.error(e);
        return false;
    }
}

// --- Real Location Logic ---
window.handleRealLocation = () => {
    if (!navigator.geolocation) {
        showModal('Hata', "Tarayıcınız konum servisini desteklemiyor.");
        return;
    }

    const locBtn = document.getElementById('addLocationBtn');
    locBtn.innerHTML = '⏳';

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            isRealLocationActive = true;

            // Reverse Geocoding (Basic approximation or API if available)
            // For now specific coords, can use reverse geocoding API here
            currentLocation = {
                text: `${latitude.toFixed(2)}, ${longitude.toFixed(2)} (GPS)`,
                lat: latitude,
                lng: longitude
            };

            dom.locationStatus.textContent = "✅ Gerçek Konum Alındı";
            dom.locationStatus.classList.remove('hidden');
            locBtn.classList.add('active-location');
            locBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            `;
        },
        (err) => {
            console.error(err);
            showModal('Konum Hatası', "Konum alınamadı. Lütfen izinleri kontrol edin.");
            locBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            `;
            isRealLocationActive = false;
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
};

// --- Create Moment ---
async function createMoment(text) {
    const isEdit = !!window._editingId;

    if (!text.trim() && currentMedia.length === 0) {
        showModal('Uyarı', "Boş anı kaydedilemez.");
        return;
    }

    const saveBtn = dom.addBtn;
    const originalBtnText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span>${isEdit ? 'Güncelleniyor...' : 'Yükleniyor...'}</span>`;

    try {
        const finalMedia = [];
        let uploadCount = 0;

        for (const item of currentMedia) {
            if (item.data.startsWith('data:')) {
                uploadCount++;
                saveBtn.innerHTML = `<span>Yükleniyor (${uploadCount}/${currentMedia.length})...</span>`;

                try {
                    const uploadPromise = DBService.uploadFile(item.data, item.type);
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 8000));
                    const downloadURL = await Promise.race([uploadPromise, timeoutPromise]);

                    if (downloadURL) {
                        finalMedia.push({ type: item.type, data: downloadURL });
                    } else {
                        finalMedia.push(item);
                    }
                } catch (uploadError) {
                    console.warn("Upload fallback:", uploadError);
                    finalMedia.push(item);
                }
            } else {
                finalMedia.push(item);
            }
        }

        const rawDate = dom.momentDate.value;
        let finalCreatedAt = Date.now();
        if (rawDate) {
            const parsedDate = new Date(rawDate).getTime();
            if (!isNaN(parsedDate)) finalCreatedAt = parsedDate;
        }

        // Determine Location: GPS > Manual Input > Default
        const manualLocInput = document.getElementById('manualLocationInput');
        let finalLocation = currentLocation; // Start with GPS if exists

        if (manualLocInput && manualLocInput.value.trim() !== '') {
            // Overwrite or create location object with manual text
            // If GPS was active, keep coords but update text
            if (finalLocation) {
                finalLocation.text = manualLocInput.value.trim();
            } else {
                finalLocation = { text: manualLocInput.value.trim() };
            }
        }

        const momentData = {
            content: text.trim(),
            location: finalLocation,
            isRealLocation: isRealLocationActive, // Remains true only if GPS was used
            media: finalMedia,
            song: currentSong,
            theme: window._selectedTheme || 'default',
            mood: window._selectedMood || '😊',
            isPublic: isPublicState,
            journalId: window._selectedJournal || null,
            createdAt: finalCreatedAt
        };

        if (isEdit) {
            console.log("Moment silinip güncelleniyor (ID):", window._editingId);
            await DBService.updateMoment(window._editingId, momentData);
            window._editingId = null;
        } else {
            const user = AuthService.currentUser();
            if (!user) throw new Error("Oturum bulunamadı, lütfen tekrar giriş yapın (Auth Error).");

            console.log("Profil bilgileri alınıyor...");
            let userProfile = null;
            try {
                userProfile = await DBService.getUserProfile(user.uid);
            } catch (err) {
                console.warn("Profil alınamadı, anonim devam ediliyor:", err);
            }

            console.log("Firestore kaydı başlıyor...");
            await DBService.addMoment({
                ...momentData,
                userPhotoURL: userProfile?.photoURL || user.photoURL || '👤'
            });
            console.log("Anı başarıyla kaydedildi.");
        }

        // Reset flow
        currentMedia = [];
        currentSong = null;
        isRealLocationActive = false;
        currentLocation = null;
        dom.momentDate.valueAsDate = new Date();
        dom.previewArea.innerHTML = '';
        dom.input.value = '';
        dom.locationStatus.textContent = '';
        dom.locationStatus.classList.add('hidden');

        const locBtn = document.getElementById('addLocationBtn');
        if (locBtn) {
            locBtn.classList.remove('active-location');
            locBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            `;
        }

        const locInput = document.getElementById('manualLocationInput');
        if (locInput) locInput.value = '';

        window._selectedJournal = null;
        window._selectedTheme = 'default';
        window._selectedMood = '😊';

        // UI Reset
        const moodIcon = document.getElementById('moodIcon');
        if (moodIcon) moodIcon.textContent = '😊';
        const journalBtn = document.getElementById('journalBtn');
        if (journalBtn) journalBtn.querySelector('span').textContent = '📂';
        const themeBtn = document.getElementById('themeBtn');
        if (themeBtn) themeBtn.querySelector('span').textContent = '🎨';

        dom.input.style.height = 'auto';
        dom.addBtn.innerHTML = `Kaydet <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;

        await loadMoments();
        renderTimeline();
    } catch (e) {
        console.error("Anı Ekleme Hatası (Detaylı):", e);
        // Provide more context in the alert
        let errorMsg = e.message;
        if (e.code === 'permission-denied') errorMsg = "Erişim reddedildi! Lütfen Firestore kurallarını güncellediğinizden emin olun.";
        showModal('İşlem Başarısız', errorMsg);
    } finally {
        saveBtn.disabled = false;
        // Button text is reset in success, but handle error case
        if (!window._editingId) {
            dom.addBtn.innerHTML = `Kaydet <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        }
    }
}

async function deleteMoment(id) {
    const confirmed = await showModal('Silinsin mi?', 'Bu günlük sayfasını silmek istediğinize emin misiniz?', true);
    if (confirmed) {
        try {
            await DBService.deleteMoment(id);
            await loadMoments();
            renderTimeline();
        } catch (e) {
            console.error("Silme hatası:", e);
            showModal('Hata', "Anı silinemedi.");
        }
    }
}

// Global UI helper
window.requestDelete = (id) => {
    deleteMoment(id);
    window.toggleMomentMenu(id);
};

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

let selectedVoiceFilter = 'none';
let audioCtx = null;
let natureNoiseSource = null;

window.setVoiceFilter = (filter, btn) => {
    selectedVoiceFilter = filter;
    document.querySelectorAll('.filter-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
};

async function toggleRecording() {
    const tray = document.getElementById('voiceFilterTray');

    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // UI Update
            tray.classList.remove('hidden');

            // Web Audio Processing
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx.createMediaStreamSource(stream);
            const destination = audioCtx.createMediaStreamDestination();

            // Apply Processors
            applyVoiceFilters(source, destination);

            mediaRecorder = new MediaRecorder(destination.stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    const base64 = reader.result;
                    currentMedia.push({ type: 'audio', data: base64, filter: selectedVoiceFilter });
                    renderPreview();
                };

                // Cleanup
                stream.getTracks().forEach(track => track.stop());
                if (natureNoiseSource) { natureNoiseSource.stop(); natureNoiseSource = null; }
                if (audioCtx) { audioCtx.close(); audioCtx = null; }
                tray.classList.add('hidden');
            };

            mediaRecorder.start();
            isRecording = true;
            dom.recordBtn.classList.add('recording');
        } catch (err) {
            console.error(err);
            alert('Mikrofon erişimi sağlanamadı.');
            tray.classList.add('hidden');
        }
    } else {
        mediaRecorder.stop();
        isRecording = false;
        dom.recordBtn.classList.remove('recording');
    }
}

function applyVoiceFilters(source, destination) {
    if (selectedVoiceFilter === 'none') {
        source.connect(destination);
        return;
    }

    if (selectedVoiceFilter === 'echo') {
        const delay = audioCtx.createDelay(1.0);
        delay.delayTime.value = 0.3;
        const feedback = audioCtx.createGain();
        feedback.gain.value = 0.4;

        source.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);

        source.connect(destination);
        delay.connect(destination);
    } else if (selectedVoiceFilter === 'radio') {
        const bandpass = audioCtx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 2000;
        bandpass.Q.value = 1.0;

        const highpass = audioCtx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 400;

        source.connect(highpass);
        highpass.connect(bandpass);
        bandpass.connect(destination);
    } else if (selectedVoiceFilter === 'nature') {
        // Simple wind simulation using white noise + lowpass
        const bufferSize = 2 * audioCtx.sampleRate;
        const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        natureNoiseSource = audioCtx.createBufferSource();
        natureNoiseSource.buffer = noiseBuffer;
        natureNoiseSource.loop = true;

        const lp = audioCtx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 300;

        const gain = audioCtx.createGain();
        gain.gain.value = 0.05;

        natureNoiseSource.connect(lp);
        lp.connect(gain);
        gain.connect(destination);
        natureNoiseSource.start();

        source.connect(destination);
    }
}

async function fetchLocation() {
    dom.locationStatus.textContent = "📍 Konum alınıyor...";
    dom.locationStatus.classList.remove('hidden');

    if (!navigator.geolocation) {
        dom.locationStatus.textContent = "📍 Konum belirlenemedi.";
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;

            try {
                // Using a more reliable geocoding approach or better error handling
                const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
                    headers: { 'Accept-Language': 'tr-TR' }
                });

                if (!response.ok) throw new Error("Geocoding failed");

                const data = await response.json();
                const addr = data.address || {};

                // Flexible parsing
                const city = addr.city || addr.town || addr.village || addr.suburb || addr.district || "";
                const state = addr.province || addr.state || "";
                const country = addr.country || "";

                let locationText = "";
                if (city) locationText = city;
                else if (state) locationText = state;

                if (country && locationText) locationText += `, ${country}`;
                else if (country) locationText = country;

                currentLocation = {
                    lat, lng,
                    text: locationText || `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                };
            } catch (e) {
                console.error("Location error:", e);
                currentLocation = { lat, lng, text: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
            }
            dom.locationStatus.textContent = `📍 ${currentLocation.text}`;
        },
        (err) => {
            console.error("Geolocation error:", err);
            dom.locationStatus.textContent = "📍 Konum izni verilmedi.";
        },
        { timeout: 10000, enableHighAccuracy: true }
    );
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
    reader.onload = async (event) => {
        try {
            const importedMoments = JSON.parse(event.target.result);
            if (!Array.isArray(importedMoments)) throw new Error("Format geçersiz.");

            const confirmed = await showModal('İçe Aktar', `${importedMoments.length} anı içe aktarılsın mı? Mevcut anılarınızla birleştirilecek.`, true);
            if (confirmed) {
                // Merge by ID to avoid duplicates
                const existingIds = new Set(moments.map(m => m.id));
                const newOnly = importedMoments.filter(m => !existingIds.has(m.id));
                moments = [...newOnly, ...moments];
                saveMoments();
                showModal('Başarılı', "İçe aktarma başarılı!");
            }
        } catch (err) {
            showModal('Hata', "Dosya okunamadı veya format hatalı.");
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
    // Determine active filter if none provided
    const globalSearch = document.getElementById('searchInput');
    const exploreSearch = document.getElementById('exploreSearchInput');
    const activeFilter = filter || (currentView === 'explore' ? exploreSearch?.value : globalSearch?.value) || "";

    if (currentView === 'explore') {
        renderFeed(activeFilter);
        return;
    }

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
            const monthMoments = grouped[year][month];
            const monthSec = document.createElement('div');
            monthSec.className = 'archival-month';
            monthSec.innerHTML = `
                <div class="month-header-row">
                    <h4 class="month-title">${month}</h4>
                    <button class="month-story-btn" title="${month} Hikayesini Oynat">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    </button>
                </div>
            `;

            monthSec.querySelector('.month-story-btn').onclick = (e) => {
                e.stopPropagation();
                const story = new StoryMode(monthMoments);
                story.start();
            };

            const list = document.createElement('div');
            list.className = 'moment-list-compact';

            grouped[year][month].forEach(moment => {
                const item = document.createElement('div');
                item.className = 'moment-item-compact';
                item.onclick = () => openImmersiveView(moment);

                const dateObj = new Date(moment.createdAt);
                const dayStr = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
                const locText = moment.location ? moment.location.text : "Konum Yok";
                const currentUser = AuthService.currentUser();
                const isOwner = moment.userId === currentUser?.uid;

                item.innerHTML = `
                    <span class="m-date">${dayStr}</span>
                    <span class="m-divider">|</span>
                    <span class="m-location" data-moment-id="${moment.id}">${locText}</span>
                    ${isOwner ? `
                    <div class="m-action-wrapper">
                        <button class="m-action-trigger" onclick="event.stopPropagation(); window.toggleMomentMenu('${moment.id}')">⋮</button>
                        <div class="m-action-menu" id="menu-${moment.id}">
                            <button onclick="event.stopPropagation(); window.editMoment('${moment.id}')">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                Düzenle
                            </button>
                            <button onclick="event.stopPropagation(); window.toggleVisibility('${moment.id}', ${!moment.isPublic})">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                ${moment.isPublic ? 'Sadece Ben' : 'Herkese Açık'}
                            </button>
                            <button class="m-btn-delete" onclick="event.stopPropagation(); window.requestDelete('${moment.id}')">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                Sil
                            </button>
                            <button class="m-btn-cancel" onclick="event.stopPropagation(); window.toggleMomentMenu('${moment.id}')">Vazgeç</button>
                        </div>
                    </div>` : ''}
                `;
                list.appendChild(item);
            });

            monthSec.appendChild(list);
            yearSec.appendChild(monthSec);
        });

        dom.timeline.appendChild(yearSec);
    });

    // Event delegation for location clicks
    dom.timeline.querySelectorAll('.m-location').forEach(locEl => {
        locEl.onclick = (e) => {
            e.stopPropagation();
            const momentId = locEl.getAttribute('data-moment-id');
            const moment = moments.find(m => m.id == momentId);
            if (moment) {
                openImmersiveView(moment);
            }
        };
    });
}

function openImmersiveView(moment) {
    const view = dom.immersiveView;
    const dateObj = new Date(moment.createdAt);
    const dateStr = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

    // Use current app theme as base (Safety check)
    const activeTheme = (dom.themeSelect && dom.themeSelect.value) ? dom.themeSelect.value : 'default';
    view.className = `immersive-modal theme-${activeTheme}`;

    const images = moment.media.filter(m => m.type === 'image');
    const audio = moment.media.find(m => m.type === 'audio');

    // Immersive Auto-play Audio
    let backgroundAudio = null;
    if (audio) {
        backgroundAudio = new Audio(audio.data);
        backgroundAudio.play().catch(() => console.log("Auto-play blocked"));
    }

    // Spotify - compact play button + info
    let musicInfo = '';
    let spotifyPlayer = '';
    if (moment.song && moment.song.title) {
        musicInfo = moment.song.title;
        if (moment.song.id) {
            // Visible but compact player
            spotifyPlayer = `<div class="spotify-wrapper">
                <iframe src="https://open.spotify.com/embed/track/${moment.song.id}" 
                width="100%" height="80" frameborder="0" allowtransparency="true" allow="encrypted-media; autoplay" 
                class="compact-spotify-iframe"></iframe>
            </div>`;
        }
    }

    // Theme options for popup
    const themes = [
        { value: 'default', label: 'Varsayılan', color: '#6366f1' },
        { value: 'polaroid', label: 'Polaroid', color: '#f4f1ea' },
        { value: 'neon', label: 'Neon', color: '#00f2ff' },
        { value: 'cyberpunk', label: 'Cyberpunk', color: '#ff00ff' },
        { value: 'vintage', label: 'Vintage', color: '#8d6e63' },
        { value: 'ocean', label: 'Ocean', color: '#38bdf8' },
        { value: 'paper', label: 'Paper', color: '#fdfdfd' },
        { value: 'pinboard', label: 'Pinboard', color: '#5d4037' }
    ];

    const themeOptionsHtml = themes.map(theme => `
        <button class="theme-option ${theme.value === activeTheme ? 'active' : ''}" data-theme="${theme.value}">
            <div class="theme-option-icon" style="background: ${theme.color};"></div>
            ${theme.label}
        </button>
    `).join('');

    const isOwner = AuthService.currentUser()?.uid === moment.userId;
    const themeSwitcherStyle = isOwner ? '' : 'style="display:none"';

    view.innerHTML = `
        <button class="close-immersive" id="closeImmersive">×</button>
        <button class="theme-switcher-btn" id="themeSwitcherBtn" title="Tema Değiştir" ${themeSwitcherStyle}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="13.5" cy="6.5" r=".5"></circle>
                <circle cx="17.5" cy="10.5" r=".5"></circle>
                <circle cx="8.5" cy="7.5" r=".5"></circle>
                <circle cx="6.5" cy="12.5" r=".5"></circle>
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>
            </svg>
        </button>
        <div class="theme-popup" id="themePopup">
            ${themeOptionsHtml}
        </div>
        <div class="immersive-content">
            <header class="immersive-header">
                <span class="immersive-username">${moment.userDisplayName || 'Anonim'}</span>
                <h2 class="immersive-date">
                    ${dateStr} 
                    ${moment.isRealLocation ? '<span class="gold-verified-badge" title="Doğrulanmış Konum">✓</span>' : ''}
                </h2>
                ${moment.isRealLocation && moment.location ? `<p class="immersive-real-location">📍 ${moment.location.text}</p>` : ''}
                ${moment.notes ? `<div class="immersive-location-tag">${moment.notes}</div>` : ''}
                <div class="notes-music-row">
                    <div class="moment-notes">
                        <textarea class="notes-input" 
                                  id="momentNotes" 
                                  maxlength="80"
                                  placeholder="Yer İsmi...">${moment.notes || ''}</textarea>
                    </div>
                    ${musicInfo ? `
                        <div class="music-indicator">
                            <div class="music-notes">
                                <span class="note">♪</span>
                                <span class="note">♫</span>
                                <span class="note">♪</span>
                            </div>
                            <div class="music-text-wrapper">
                                <span class="music-text ${musicInfo.length > 20 ? 'scroll' : ''}">${escapeHtml(musicInfo)}</span>
                            </div>
                        </div>
                        ${spotifyPlayer}
                    ` : ''}
                </div>
            </header>
            
            <div class="collage-container">
                <!-- Elements scattered here -->
            </div>
        </div>
    `;

    const collage = view.querySelector('.collage-container');
    const items = [];
    const paragraphs = moment.content.split('\n').filter(p => p.trim() !== '');

    paragraphs.forEach(p => items.push({ type: 'text', content: p }));
    images.forEach(img => items.push({ type: 'image', content: img.data }));

    items.forEach((item, idx) => {
        const collageItem = document.createElement('div');
        collageItem.className = 'collage-item';

        const rot = (Math.random() * 4 - 2).toFixed(2);
        const xOff = (Math.random() * 10 - 5).toFixed(0);
        const yOff = (Math.random() * 6 - 3).toFixed(0);

        collageItem.style.transform = `rotate(${rot}deg) translate(${xOff}px, ${yOff}px)`;
        collageItem.style.zIndex = idx;

        if (item.type === 'text') {
            collageItem.innerHTML = `<div class="scattered-text">${escapeHtml(item.content)}</div>`;
        } else {
            const currentTheme = (dom.themeSelect && dom.themeSelect.value) ? dom.themeSelect.value : 'default';
            const hasPin = currentTheme === 'pinboard' ? '<div class="pin"></div>' : '';
            collageItem.innerHTML = `
                <div class="img-container polaroid-frame">
                    ${hasPin}
                    <img src="${item.content}" class="immersive-img">
                </div>`;
        }
        collage.appendChild(collageItem);
    });

    // Save notes on change (Only for owner AND not public)
    const notesInput = view.querySelector('#momentNotes');
    const canEditNotes = isOwner && !moment.isPublic;

    if (canEditNotes) {
        notesInput.onblur = () => {
            moment.notes = notesInput.value;
            saveMoments();
        };
    } else {
        notesInput.readOnly = true;
        notesInput.title = isOwner ? "Paylaşılan anının konumu değiştirilemez" : "Sadece anı sahibi not ekleyebilir";
        notesInput.style.opacity = "0.7";
        notesInput.style.cursor = "default";
    }

    // Theme switcher logic
    const themeSwitcherBtn = view.querySelector('#themeSwitcherBtn');
    const themePopup = view.querySelector('#themePopup');

    themeSwitcherBtn.onclick = (e) => {
        e.stopPropagation();
        themePopup.classList.toggle('active');
    };

    // Close popup when clicking outside
    document.addEventListener('click', function closePopup(e) {
        if (!themePopup.contains(e.target) && !themeSwitcherBtn.contains(e.target)) {
            themePopup.classList.remove('active');
        }
    });

    // Theme selection
    view.querySelectorAll('.theme-option').forEach(btn => {
        btn.onclick = () => {
            const newTheme = btn.getAttribute('data-theme');
            if (dom.themeSelect) {
                dom.themeSelect.value = newTheme;
                dom.themeSelect.dispatchEvent(new Event('change'));
            }
            view.className = `immersive-modal theme-${newTheme}`;

            // Update active state
            view.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update pins visibility
            const pins = view.querySelectorAll('.pin');
            if (newTheme === 'pinboard' && pins.length === 0) {
                view.querySelectorAll('.img-container').forEach(cont => {
                    const pin = document.createElement('div');
                    pin.className = 'pin';
                    cont.prepend(pin);
                });
            } else if (newTheme !== 'pinboard') {
                pins.forEach(p => p.remove());
            }

            themePopup.classList.remove('active');
        };
    });

    view.querySelector('#closeImmersive').onclick = () => {
        if (backgroundAudio) backgroundAudio.pause();
        view.classList.add('hidden');
        document.body.style.overflow = '';
        view.className = 'immersive-modal hidden';
    };

    view.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

async function openProfileView(uid) {
    const view = document.getElementById('profileView');
    const content = document.getElementById('profileContent');
    const closeBtn = document.getElementById('closeProfile');

    content.innerHTML = '<div class="loading">Yükleniyor...</div>';
    view.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    try {
        const userProfile = await DBService.getUserProfile(uid);
        const userMoments = await DBService.getMomentsByUser(uid);
        const isOwnProfile = uid === AuthService.currentUser()?.uid;

        content.innerHTML = `
            <div class="profile-header-simple">
                <div class="profile-avatar-wrapper ${isOwnProfile ? 'editable' : ''}" onclick="${isOwnProfile ? 'window.showAvatarPicker()' : ''}">
                    ${userProfile.photoURL?.startsWith('http') ?
                `<img src="${userProfile.photoURL}" class="profile-avatar-large">` :
                `<div class="profile-avatar-emoji">${userProfile.photoURL || '👤'}</div>`}
                    ${isOwnProfile ? '<div class="edit-overlay">📷</div>' : ''}
                </div>
                <div class="profile-info-minimal">
                    <h2 onclick="${isOwnProfile ? 'window.promptDisplayNameChange()' : ''}" style="${isOwnProfile ? 'cursor:pointer; border-bottom:1px dashed var(--accent);' : ''}">
                        ${userProfile.displayName || 'İsimsiz'}
                    </h2>
                    <p class="profile-username" onclick="${isOwnProfile ? 'window.promptNicknameChange()' : ''}" style="${isOwnProfile ? 'cursor:pointer; opacity:0.7;' : ''}">
                        @${userProfile.username || 'isimsiz'}
                    </p>
                    <div id="bioContainer" class="bio-container">
                        <p id="profileBioText" onclick="${isOwnProfile ? 'window.enableBioEdit()' : ''}" style="${isOwnProfile ? 'cursor:pointer;' : ''}">
                            ${userProfile.bio || 'Henüz bir biyografi eklenmedi.'}
                        </p>
                    </div>
                </div>
            </div>

            ${isOwnProfile ? `
                <div id="avatarPicker" class="avatar-picker-tray hidden">
                    <h4>Profil Fotoğrafı veya Emoji Seç</h4>
                    <div class="avatar-options">
                        <label class="avatar-option-btn photo-upload">
                            <input type="file" id="profilePhotoInput" accept="image/*" hidden onchange="window.handleProfilePhotoUpload(this)">
                            <span>📷 Yükle</span>
                        </label>
                        ${['💎', '🌠', '🌊', '🧊', '🌕'].map(emo => `
                            <button class="avatar-option-btn" onclick="window.updateAvatar('${emo}')">${emo}</button>
                        `).join('')}
                    </div>
                </div>

                <div class="profile-noti-section">
                    <div class="noti-header-mini">
                        Bildirimler 📩
                    </div>
                    <div id="profileNotiContent" class="profile-notis-list">
                        <!-- Notifications rendered here -->
                    </div>
                </div>
            ` : ''}

            <div class="profile-stats">
                <div class="stat-item">
                    <span class="stat-value">${userMoments.length}</span>
                    <span class="stat-label">Anı</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${userProfile.followers?.length || 0}</span>
                    <span class="stat-label">Takipçi</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${userProfile.following?.length || 0}</span>
                    <span class="stat-label">Takip</span>
                </div>
            </div>

            <div class="profile-actions-row">
                ${uid !== AuthService.currentUser()?.uid ? `
                    <button id="followBtn" class="follow-btn-main ${userProfile.followers?.includes(AuthService.currentUser()?.uid) ? 'following' : ''}">
                        ${userProfile.followers?.includes(AuthService.currentUser()?.uid) ? 'Takibi Bırak' :
                    (userProfile.pendingFollowers?.includes(AuthService.currentUser()?.uid) ? 'İstek Gönderildi' : 'Takip Et')}
                    </button>
                ` : `
                    <div class="own-profile-tools">
                        <label class="privacy-switch">
                            <span>Profil Gizliliği: ${userProfile.isPrivateProfile ? 'Özel 🔒' : 'Açık 🌐'}</span>
                            <button onclick="window.toggleProfilePrivacy(${userProfile.isPrivateProfile})" class="mini-toggle-btn">Değiştir</button>
                        </label>
                    </div>
                `}
            </div>

            ${isOwnProfile && userProfile.pendingFollowers?.length > 0 ? `
                <div class="pending-requests">
                    <h3>Takip İstekleri</h3>
                    <div class="requests-list">
                        ${userProfile.pendingFollowers.map(reqUid => `
                            <div class="request-item">
                                <span class="req-uid">@${reqUid.substring(0, 8)}...</span>
                                <div class="req-btns">
                                    <button class="accept-btn" onclick="window.handleFollowAction('${reqUid}', 'accept')">Kabul Et</button>
                                    <button class="decline-btn" onclick="window.handleFollowAction('${reqUid}', 'decline')">Reddet</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <div class="profile-tabs">
                <button class="tab-btn active" onclick="window.showMomentsTab('${uid}')">Anılar</button>
                <button class="tab-btn" onclick="window.showJournalTab('${uid}')">Koleksiyonlar</button>
            </div>

            <div class="profile-moments-grid" id="profileMomentsGrid">
                ${userMoments.map(m => {
                        const firstImg = m.media ? m.media.find(med => med.type === 'image') : null;
                        return `
                        <div class="grid-item" onclick="openImmersiveViewById('${m.id}')">
                            ${firstImg ? `<img src="${firstImg.data}">` : '<div class="text-placeholder">📝</div>'}
                        </div>
                    `;
                    }).join('')}
            </div>
        `;

        // Hook for notifications and other post-render logic
        if (typeof triggerProfileFinalize === 'function') {
            triggerProfileFinalize(uid, isOwnProfile);
        }

        closeBtn.onclick = () => {
            view.classList.add('hidden');
            document.body.style.overflow = '';
        };

        const followBtn = content.querySelector('#followBtn');
        if (followBtn) {
            followBtn.onclick = () => {
                const isFollowing = followBtn.classList.contains('following');
                const isPending = followBtn.innerText.includes('İstek');
                if (isFollowing || isPending) window.handleFollowAction(uid, 'unfollow');
                else window.handleFollowAction(uid, 'follow');
            };
        }

        window._currentProfileUid = uid;

    } catch (err) {
        console.error("Profil hatası:", err);
        content.innerHTML = '<div class="error">Profil yüklenemedi.</div>';
    }
}

// Helper to open immersive view by ID (since we are in grid)
window.openImmersiveViewById = (id) => {
    const moment = moments.find(m => m.id === id);
    if (moment) openImmersiveView(moment);
};

async function handleAddMoment() {
    const text = dom.input.value;

    if (!text.trim() && currentMedia.length === 0) {
        dom.input.focus();
        return;
    }
    await createMoment(text);
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
    if (dom.themeSelect) {
        dom.themeSelect.value = moment.theme || 'default';
    }

    // Set date for editing
    if (moment.createdAt) {
        dom.momentDate.valueAsDate = new Date(moment.createdAt);
    }

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

// --- Social & Feed Features ---

async function renderFeed(filter = "") {
    console.log("Rendering Social Feed, Filter:", filter);
    const feedContainer = dom.timeline;
    try {

        // We expect 'moments' to already be loaded by loadMoments()
        const searchLower = filter.toLowerCase();
        const filtered = moments.filter(m => {
            const textMatch = m.content.toLowerCase().includes(searchLower);
            const userMatch = m.userDisplayName?.toLowerCase().includes(searchLower);
            const locMatch = m.location?.text?.toLowerCase().includes(searchLower);
            return textMatch || userMatch || locMatch;
        });

        feedContainer.innerHTML = '<div class="feed-container"></div>';
        const container = feedContainer.querySelector('.feed-container');

        if (filtered.length === 0) {
            container.innerHTML = `<div class="empty-state">${filter ? 'Eşleşen anı bulunamadı.' : 'Henüz paylaşım yok.'}</div>`;
            return;
        }

        filtered.forEach(m => {
            const card = document.createElement('div');
            card.className = 'feed-card';

            const firstImg = m.media?.find(med => med.type === 'image');
            const hasAudio = m.media?.some(med => med.type === 'audio');
            const likesCount = (m.likes || []).length;
            const currentUser = AuthService.currentUser();
            const isLiked = m.likes?.includes(currentUser?.uid);

            card.innerHTML = `
            <div class="card-header">
                <div class="user-info" onclick="openProfileView('${m.userId}')">
                    <div class="avatar-sm">
                        ${m.userPhotoURL?.startsWith('http') || m.userPhotoURL?.startsWith('data:') ?
                    `<img src="${m.userPhotoURL}" class="avatar-img-sm">` :
                    `<span>${m.userPhotoURL || '👤'}</span>`}
                    </div>
                    <div class="user-meta">
                        <span class="username">
                            ${m.userDisplayName || 'Anonim'}
                            ${m.isRealLocation ? '<span class="gold-tick-sm" title="Doğrulanmış Konum">✓</span>' : ''}
                        </span>
                        <span class="location-sm">${m.location?.text || 'Bilinmeyen Konum'}</span>
                    </div>
                </div>
                <span class="date-sm">${new Date(m.createdAt).toLocaleDateString('tr-TR')}</span>
            </div>
            
            <div class="card-body" onclick="openImmersiveViewById('${m.id}')">
                ${firstImg ? `<img src="${firstImg.data}" class="feed-img">` : `<div class="text-feed">${escapeHtml(m.content).substring(0, 100)}...</div>`}
                ${hasAudio ? '<div class="audio-indicator">🎤 Sesli Anı</div>' : ''}
            </div>

            <div class="card-footer">
                <div class="action-row">
                    <button class="like-btn ${isLiked ? 'liked' : ''}" onclick="event.stopPropagation(); window.toggleLike('${m.id}')">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                        <span>${likesCount}</span>
                    </button>
                    <button class="comment-trigger-btn" onclick="event.stopPropagation(); window.toggleComments('${m.id}')">
                        💬 <span id="comment-count-${m.id}">${m.commentsCount || 0}</span>
                    </button>
                    ${m.userId === currentUser?.uid ? `
                        <button class="visibility-status-btn" onclick="event.stopPropagation(); window.toggleVisibility('${m.id}', ${!m.isPublic})">
                            ${m.isPublic ? '🌐' : '🔒'}
                        </button>
                    ` : ''}
                    <button class="share-btn-sm" onclick="event.stopPropagation(); window.shareMoment('${m.id}')" title="Paylaş">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                    </button>
                </div>
                <div class="content-preview">${escapeHtml(m.content).substring(0, 100)}${m.content.length > 100 ? '...' : ''}</div>
                
                <div id="comments-section-${m.id}" class="comments-section hidden" onclick="event.stopPropagation()">
                    <div class="comments-list" id="comments-list-${m.id}"></div>
                    <div class="comment-input-wrapper">
                        <textarea maxlength="160" placeholder="Bir yorum bırak..." id="comment-input-${m.id}" oninput="window.updateCharCount(this, '${m.id}')"></textarea>
                        <div class="comment-input-footer">
                            <span class="char-counter" id="counter-${m.id}">160</span>
                            <button onclick="window.submitComment('${m.id}')">Gönder</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
            container.appendChild(card);
        });
    } catch (err) {
        console.error("Feed loading error:", err);
        feedContainer.innerHTML = '<div class="error-state">Akış yüklenirken bir hata oluştu.</div>';
    }
}

// --- Social Interactions & Helpers ---
window.toggleProfilePrivacy = async (currentPrivacy) => {
    try {
        const currentUser = AuthService.currentUser();
        await DBService.updateUserProfile(currentUser.uid, {
            isPrivateProfile: !currentPrivacy
        });
        openProfileView(currentUser.uid);
    } catch (e) {
        alert("Hata: " + e.message);
    }
};

window.handleFollowAction = async (targetUid, action) => {
    if (!AuthService.currentUser()) {
        showModal('Giriş Gerekli', "Bu işlemi yapmak için giriş yapmalısınız.");
        return;
    }

    // Optimistic UI - update button immediately
    const followBtn = document.getElementById('followBtn');
    const originalText = followBtn?.innerText;
    const originalClass = followBtn?.className;

    if (followBtn) {
        if (action === 'follow') {
            followBtn.innerText = 'Takip Ediliyor';
            followBtn.classList.add('following');
        } else if (action === 'unfollow') {
            followBtn.innerText = 'Takip Et';
            followBtn.classList.remove('following');
        }
        followBtn.disabled = true;
    }

    try {
        if (action === 'accept') {
            await DBService.acceptFollowRequest(targetUid);
        } else if (action === 'decline') {
            await DBService.declineFollowRequest(targetUid);
        } else if (action === 'follow') {
            await DBService.followUser(targetUid);
        } else if (action === 'unfollow') {
            await DBService.unfollowUser(targetUid);
        }

        // Silent success - no alert, just re-enable button
        if (followBtn) followBtn.disabled = false;

        // For accept/decline, refresh the view to update pending list
        if (action === 'accept' || action === 'decline') {
            openProfileView(window._currentProfileUid || targetUid);
        }
    } catch (e) {
        // Revert optimistic update on error
        if (followBtn) {
            followBtn.innerText = originalText;
            followBtn.className = originalClass;
            followBtn.disabled = false;
        }
        console.error('Follow action error:', e);
        showModal('Hata', "İşlem başarısız: " + e.message);
    }
};

window.toggleLike = async (id) => {
    const currentUser = AuthService.currentUser();
    if (!currentUser) {
        showModal('Giriş Gerekli', 'Beğenmek için giriş yapmalısınız.');
        return;
    }

    // Optimistic UI update
    const likeBtn = document.querySelector(`[onclick*="toggleLike('${id}')"]`);
    const likeCountSpan = likeBtn?.querySelector('span');
    const wasLiked = likeBtn?.classList.contains('liked');

    if (likeBtn) {
        likeBtn.classList.toggle('liked');
        const svg = likeBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', wasLiked ? 'none' : 'currentColor');
        if (likeCountSpan) {
            const currentCount = parseInt(likeCountSpan.textContent) || 0;
            likeCountSpan.textContent = wasLiked ? Math.max(0, currentCount - 1) : currentCount + 1;
        }
    }

    try {
        await DBService.toggleLike(id);
        // Silent refresh - don't reload entire feed, just update local data
        const momentIndex = moments.findIndex(m => m.id === id);
        if (momentIndex !== -1) {
            const likes = moments[momentIndex].likes || [];
            if (wasLiked) {
                moments[momentIndex].likes = likes.filter(uid => uid !== currentUser.uid);
            } else {
                moments[momentIndex].likes = [...likes, currentUser.uid];
            }
        }
    } catch (e) {
        // Revert optimistic update on error
        if (likeBtn) {
            likeBtn.classList.toggle('liked');
            const svg = likeBtn.querySelector('svg');
            if (svg) svg.setAttribute('fill', wasLiked ? 'currentColor' : 'none');
            if (likeCountSpan) {
                const currentCount = parseInt(likeCountSpan.textContent) || 0;
                likeCountSpan.textContent = wasLiked ? currentCount + 1 : Math.max(0, currentCount - 1);
            }
        }
        console.error('Like error:', e);
        showModal('Hata', "Beğeni hatası: " + e.message);
    }
};

window.toggleVisibility = async (id, isPublic) => {
    try {
        console.log('toggleVisibility called:', { id, isPublic, currentView });
        await DBService.setMomentVisibility(id, isPublic);
        console.log('Visibility updated in DB, reloading moments...');
        // Refresh data
        await loadMoments();
        console.log('Moments reloaded:', moments.length, 'items');
        if (currentView === 'explore') renderFeed();
        else renderTimeline();
    } catch (e) {
        console.error('Visibility error:', e);
        showModal('Hata', "Görünürlük hatası: " + e.message);
    }
};
// --- Avatar & Profile Helpers ---
window.showAvatarPicker = () => {
    document.getElementById('avatarPicker')?.classList.toggle('hidden');
};

window.updateAvatar = async (newAvatar) => {
    try {
        const currentUser = AuthService.currentUser();
        await DBService.updateUserProfile(currentUser.uid, {
            photoURL: newAvatar
        });
        showModal('Başarılı', "Profil güncellendi!");
        openProfileView(currentUser.uid);
    } catch (e) {
        showModal('Hata', "Hata: " + e.message);
    }
};

window.handleProfilePhotoUpload = async (input) => {
    const file = input.files[0];
    if (!file) return;

    try {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result;
            const downloadURL = await DBService.uploadFile(base64, 'image');
            if (downloadURL) {
                window.updateAvatar(downloadURL);
            } else {
                window.updateAvatar(base64); // Fallback to base64 if storage fails
            }
        };
        reader.readAsDataURL(file);
    } catch (e) {
        showModal('Hata', "Yükleme hatası: " + e.message);
    }
};

// --- Biography Editing ---
window.enableBioEdit = () => {
    const bioTextNode = document.getElementById('profileBioText');
    const bioContainer = document.getElementById('bioContainer');
    const currentBio = bioTextNode.innerText;

    bioContainer.innerHTML = `
        <textarea id="bioEditArea" class="bio-edit-area" maxlength="160">${currentBio === 'Henüz bir biyografi eklenmedi.' ? '' : currentBio}</textarea>
        <div class="bio-edit-actions">
            <button class="save-bio-btn" onclick="window.saveBio()">Kaydet</button>
            <button class="cancel-bio-btn" onclick="window.refreshProfile()">Vazgeç</button>
        </div>
    `;
};

window.saveBio = async () => {
    const newBio = document.getElementById('bioEditArea').value;
    try {
        const currentUser = AuthService.currentUser();
        await DBService.updateUserProfile(currentUser.uid, { bio: newBio });
        alert("Biyografi güncellendi!");
        openProfileView(currentUser.uid);
    } catch (e) {
        alert("Hata: " + e.message);
    }
};

window.refreshProfile = () => {
    openProfileView(window._currentProfileUid);
};

// --- Commenting Logic ---
window.toggleComments = async (momentId) => {
    const commentSection = document.getElementById(`comments-section-${momentId}`);
    if (commentSection.classList.contains('hidden')) {
        commentSection.classList.remove('hidden');
        await window.loadComments(momentId);
    } else {
        commentSection.classList.add('hidden');
    }
};

window.loadComments = async (momentId) => {
    const list = document.getElementById(`comments-list-${momentId}`);
    list.innerHTML = '<div class="loading-sm">Yükleniyor...</div>';

    try {
        const comments = await DBService.getComments(momentId);
        const currentUser = AuthService.currentUser();

        if (comments.length === 0) {
            list.innerHTML = '<div class="empty-comments">Henüz yorum yok. İlk yorumu sen yap!</div>';
            return;
        }

        list.innerHTML = comments.map(c => {
            const isLiked = c.likes?.includes(currentUser?.uid);
            const canDelete = currentUser?.uid === c.userId; // Comment author can delete
            return `
                <div class="comment-item" id="comment-${c.id}">
                    <div class="comment-user-info" onclick="openProfileView('${c.userId}')">
                        ${c.userPhoto?.startsWith('http') || c.userPhoto?.startsWith('data:') ?
                    `<img src="${c.userPhoto}" class="comment-avatar">` :
                    `<span class="comment-avatar-emoji">${c.userPhoto || '👤'}</span>`}
                        <span class="comment-username">${c.userName}</span>
                    </div>
                    <div class="comment-content">
                        <p>${escapeHtml(c.text)}</p>
                        <div class="comment-meta">
                            <button class="comment-like-btn ${isLiked ? 'liked' : ''}" onclick="window.handleCommentLike('${momentId}', '${c.id}')">
                                ❤️ <span>${c.likes?.length || 0}</span>
                            </button>
                            <span class="comment-date">${new Date(c.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                            ${canDelete ? `<button class="comment-delete-btn" onclick="window.deleteComment('${momentId}', '${c.id}')" title="Yorumu Sil">🗑️</button>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('Comment load error:', e);
        list.innerHTML = '<div class="error-sm">Yorumlar yüklenemedi.</div>';
    }
};

window.handleCommentLike = async (momentId, commentId) => {
    try {
        await DBService.toggleCommentLike(momentId, commentId);
        await window.loadComments(momentId);
    } catch (e) {
        showModal('Hata', e.message);
    }
};

window.deleteComment = async (momentId, commentId) => {
    // Optimistic UI - hide comment immediately
    const commentEl = document.getElementById(`comment-${commentId}`);
    if (commentEl) commentEl.style.opacity = '0.5';

    try {
        await DBService.deleteComment(momentId, commentId);
        // Remove from DOM
        if (commentEl) commentEl.remove();
        // Update count
        const countSpan = document.getElementById(`comment-count-${momentId}`);
        if (countSpan) {
            countSpan.textContent = Math.max(0, parseInt(countSpan.textContent) - 1);
        }
    } catch (e) {
        // Revert on error
        if (commentEl) commentEl.style.opacity = '1';
        console.error('Delete comment error:', e);
        showModal('Hata', 'Yorum silinemedi: ' + e.message);
    }
};

window.submitComment = async (momentId) => {
    const input = document.getElementById(`comment-input-${momentId}`);
    const text = input.value.trim();
    if (!text) return;

    if (!AuthService.currentUser()) {
        showModal('Giriş Gerekli', "Yorum yapmak için lütfen giriş yapın.");
        return;
    }

    if (text.length > 160) {
        showModal('Uyarı', "Yorum 160 karakteri geçemez!");
        return;
    }

    try {
        await DBService.addComment(momentId, text);
        input.value = '';
        document.getElementById(`counter-${momentId}`).innerText = '160';
        await window.loadComments(momentId);
        const countSpan = document.getElementById(`comment-count-${momentId}`);
        if (countSpan) {
            countSpan.innerText = parseInt(countSpan.innerText) + 1;
        }
    } catch (e) {
        showModal('Hata', "Yorum gönderilemedi: " + e.message);
    }
};

window.updateCharCount = (textarea, momentId) => {
    const remaining = 160 - textarea.value.length;
    document.getElementById(`counter-${momentId}`).innerText = remaining;
};

// --- Notification Logic ---
function setupNotifications() {
    const currentUser = AuthService.currentUser();
    if (!currentUser) return;

    DBService.onNotifications(currentUser.uid, (notifications) => {
        const unreadCount = notifications.filter(n => !n.isRead).length;
        const profileBtn = document.getElementById('profileBtn');

        if (unreadCount > 0 && profileBtn) {
            profileBtn.classList.add('has-noti');
        } else if (profileBtn) {
            profileBtn.classList.remove('has-noti');
        }
        window._notifications = notifications;
    });
}

window.openNotiView = () => {
    const view = document.getElementById('notiView');
    const content = document.getElementById('notiContent');
    const badge = document.getElementById('notiBadge');

    view.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    renderNotifications(window._notifications || []);

    // Mark as read
    const currentUser = AuthService.currentUser();
    DBService.markNotificationsAsRead(currentUser.uid).then(() => {
        badge.classList.add('hidden');
    });
};

function renderNotifications(notis) {
    const content = document.getElementById('notiContent');
    if (notis.length === 0) {
        content.innerHTML = '<div class="empty-state">Henüz bir bildirim yok. 😊</div>';
        return;
    }

    content.innerHTML = notis.map(n => {
        let typeText = '';
        let typeIcon = '';
        if (n.type === 'follow') { typeText = 'seni takip etmeye başladı'; typeIcon = '👤'; }
        if (n.type === 'follow_request') { typeText = 'sana takip isteği gönderdi'; typeIcon = '📩'; }
        if (n.type === 'like') { typeText = 'anını beğendi'; typeIcon = '❤️'; }
        if (n.type === 'comment') { typeText = `anına yorum yaptı: "${n.text.substring(0, 20)}..."`; typeIcon = '💬'; }

        return `
            <div class="noti-item ${n.isRead ? '' : 'unread'}" onclick="window.handleNotiClick('${n.momentId}', '${n.senderUid}')">
                <div class="noti-avatar">
                    ${n.senderPhoto?.startsWith('http') || n.senderPhoto?.startsWith('data:') ?
                `<img src="${n.senderPhoto}" class="profile-avatar-large">` :
                `<span>${n.senderPhoto || '👤'}</span>`}
                </div>
                <div class="noti-info">
                    <span class="noti-text"><b>${n.senderName}</b> ${typeText}</span>
                    <span class="noti-date">${new Date(n.createdAt).toLocaleDateString('tr-TR')} ${new Date(n.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div class="noti-type-icon">${typeIcon}</div>
            </div>
        `;
    }).join('');
}

window.handleNotiClick = (momentId, userUid) => {
    document.getElementById('notiView').classList.add('hidden');
    document.body.style.overflow = '';

    if (momentId && momentId !== 'null') {
        openImmersiveViewById(momentId);
    } else {
        openProfileView(userUid);
    }
};

// --- Map View Logic ---
let map = null;
let markers = [];

window.initMap = () => {
    if (map) return;

    map = L.map('mapInstance').setView([39.9334, 32.8597], 6); // Default: Turkey center
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(map);
};

window.renderMarkers = (momentsToRender) => {
    // Clear old markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    momentsToRender.forEach(m => {
        if (m.location && m.location.coords) {
            const lat = m.location.coords.latitude || m.location.coords.lat;
            const lng = m.location.coords.longitude || m.location.coords.lng;

            if (lat && lng) {
                const firstImg = m.media?.find(med => med.type === 'image');
                const icon = L.divIcon({
                    className: 'custom-moment-marker-wrapper',
                    html: `
                        <div class="custom-moment-marker">
                            ${firstImg ? `<img src="${firstImg.data}">` : '<span>📝</span>'}
                        </div>
                    `,
                    iconSize: [40, 40],
                    iconAnchor: [0, 40]
                });

                const marker = L.marker([lat, lng], { icon: icon }).addTo(map);
                marker.on('click', () => openImmersiveView(m));
                markers.push(marker);
            }
        }
    });

    // Auto-fit bounds if markers exist
    if (markers.length > 0) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
};

window.toggleMapView = () => {
    const mapView = document.getElementById('mapView');
    const timeline = document.getElementById('timeline');
    const inputSection = document.querySelector('.input-section');
    const searchSection = document.querySelector('.search-container');

    if (mapView.classList.contains('hidden')) {
        mapView.classList.remove('hidden');
        timeline.classList.add('hidden');
        inputSection.classList.add('hidden');
        searchSection.classList.add('hidden');
        window.initMap();
        setTimeout(() => {
            map.invalidateSize();
            renderMarkers(moments);
        }, 300);
        document.getElementById('mapBtn').classList.add('active');
    } else {
        mapView.classList.add('hidden');
        timeline.classList.remove('hidden');
        inputSection.classList.remove('hidden');
        searchSection.classList.remove('hidden');
        document.getElementById('mapBtn').classList.remove('active');
    }
};

document.getElementById('mapBtn').onclick = window.toggleMapView;

// --- Nostalgia (On This Day) Logic ---
function setupNostalgia() {
    console.log("Checking for nostalgia moments...");
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();
    const currentYear = now.getFullYear();

    const nostalgicMoments = moments.filter(m => {
        const mDate = new Date(m.createdAt);
        return mDate.getMonth() === currentMonth &&
            mDate.getDate() === currentDay &&
            mDate.getFullYear() < currentYear;
    });

    const section = document.getElementById('nostalgiaSection');
    const list = document.getElementById('nostalgiaList');

    if (nostalgicMoments.length > 0) {
        section.classList.remove('hidden');
        list.innerHTML = nostalgicMoments.map(m => {
            const mDate = new Date(m.createdAt);
            const yearsAgo = currentYear - mDate.getFullYear();
            const firstImg = m.media?.find(med => med.type === 'image');

            return `
                <div class="nostalgia-card" onclick="openImmersiveView(${JSON.stringify(m).replace(/"/g, '&quot;')})">
                    ${firstImg ? `<img src="${firstImg.data}" class="nostalgia-card-img">` : '<div class="nostalgia-text-placeholder">📝</div>'}
                    <div class="nostalgia-card-overlay">
                        <span class="nostalgia-years">${yearsAgo} Yıl Önce Bugün</span>
                        <p class="nostalgia-preview">${escapeHtml(m.content)}</p>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        section.classList.add('hidden');
    }
}


// --- User Search Logic ---
window.toggleUserSearch = () => {
    const searchArea = document.getElementById('userSearchArea');
    searchArea.classList.toggle('hidden');
};

window.performUserSearch = async (query) => {
    const resultsContainer = document.getElementById('userSearchResults');
    if (!query || query.length < 2) {
        resultsContainer.innerHTML = '';
        return;
    }

    resultsContainer.innerHTML = '<div class="loading-sm">Aranıyor...</div>';
    try {
        const users = await DBService.searchUsers(query);
        if (users.length === 0) {
            resultsContainer.innerHTML = '<div class="empty-sm">Kullanıcı bulunamadı.</div>';
            return;
        }

        resultsContainer.innerHTML = users.map(u => `
            <div class="user-search-item" onclick="openProfileView('${u.uid}')">
                ${u.photoURL?.startsWith('http') ?
                `<img src="${u.photoURL}" class="avatar-xs">` :
                `<span class="avatar-xs-emoji">${u.photoURL || '👤'}</span>`}
                <div class="user-search-info">
                    <span class="user-search-name">${u.displayName}</span>
                    <span class="user-search-handle">@${u.username || 'isimsiz'}</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        resultsContainer.innerHTML = '<div class="error-sm">Arama hatası.</div>';
    }
};

// --- Journal & Collection Logic ---
async function loadUserJournals() {
    const user = AuthService.currentUser();
    if (!user) return;

    const select = document.getElementById('journalSelect');
    try {
        const journals = await DBService.getJournals(user.uid);
        window._userJournals = journals;

        if (journals.length > 0) {
            select.innerHTML = '<option value="">📂 Koleksiyon Seç (Opsiyonel)</option>' +
                journals.map(j => `<option value="${j.id}">${j.coverEmoji} ${j.title}</option>`).join('');
        } else {
            select.innerHTML = '<option value="">📂 Koleksiyon Yok</option>';
        }
    } catch (e) {
        console.error("Journal load error:", e);
    }
}

window.showJournalTab = async (uid) => {
    const grid = document.getElementById('profileMomentsGrid');
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('[onclick*="showJournalTab"]').classList.add('active');

    grid.innerHTML = '<div class="loading-sm">Yükleniyor...</div>';

    try {
        const journals = await DBService.getJournals(uid);
        const currentUser = AuthService.currentUser();

        let html = '';
        if (uid === currentUser?.uid) {
            html += `
                <div class="create-journal-btn" onclick="window.createJournalPrompt()">
                    <span>➕</span>
                    <span>Yeni Koleksiyon</span>
                </div>
            `;
        }

        if (journals.length === 0 && uid !== currentUser?.uid) {
            grid.innerHTML = '<div class="empty-state">Henüz bir koleksiyon oluşturulmamış.</div>';
            return;
        }

        html += journals.map(j => `
            <div class="journal-card" onclick="window.viewJournal('${j.id}', '${j.title}')">
                <div class="journal-cover">${j.coverEmoji}</div>
                <div class="journal-title">${j.title}</div>
            </div>
        `).join('');

        grid.innerHTML = `<div class="journal-grid">${html}</div>`;
    } catch (e) {
        grid.innerHTML = '<div class="error-sm">Hata oluştu.</div>';
    }
};

window.showMomentsTab = async (uid) => {
    const grid = document.getElementById('profileMomentsGrid');
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('[onclick*="showMomentsTab"]').classList.add('active');

    grid.innerHTML = '<div class="loading-sm">Yükleniyor...</div>';
    const moments = await DBService.getMomentsByUser(uid);
    renderGrid(moments);
};

window.createJournalPrompt = async () => {
    const title = prompt("Koleksiyon başlığı seçin:");
    if (!title) return;
    const emoji = prompt("Bir kapak emojisi seçin (Varsayılan 📂):") || '📂';

    try {
        await DBService.createJournal(title, emoji);
        alert("Koleksiyon oluşturuldu!");
        const user = AuthService.currentUser();
        if (user) window.showJournalTab(user.uid);
        loadUserJournals();
    } catch (e) {
        alert("Hata: " + e.message);
    }
};

window.viewJournal = async (jid, title) => {
    // Open a modal or repurpose immersion view to see journal moments
    // For now, let's just alert or filter the grid
    const grid = document.getElementById('profileMomentsGrid');
    grid.innerHTML = `<div class="loading-sm">${title} yükleniyor...</div>`;

    try {
        const moments = await DBService.getMomentsByJournal(jid);
        if (moments.length === 0) {
            grid.innerHTML = '<div class="empty-state">Bu koleksiyonda henüz anı yok.</div>';
        } else {
            renderGrid(moments);
        }
    } catch (e) {
        alert("Hata: " + e.message);
    }
};

function renderGrid(momentsToGrid) {
    const grid = document.getElementById('profileMomentsGrid');
    grid.innerHTML = momentsToGrid.map(m => {
        const firstImg = m.media ? m.media.find(med => med.type === 'image') : null;
        return `
            <div class="grid-item" onclick="openImmersiveViewById('${m.id}')">
                ${firstImg ? `<img src="${firstImg.data}">` : '<div class="text-placeholder">📝</div>'}
            </div>
        `;
    }).join('');
}

// --- UX Enhancement & Nickname Fix ---

window.updateMoodIcon = (val) => {
    document.getElementById('moodIcon').textContent = val;
};

// Share Feature: Copy link or Share via Web Share API
window.shareMoment = async (id) => {
    const shareData = {
        title: 'MomentLog Anısı',
        text: 'Bu anıya MomentLog üzerinden göz at!',
        url: window.location.href + '?m=' + id
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            await navigator.clipboard.writeText(shareData.url);
            alert("Anı linki kopyalandı!");
        }
    } catch (err) {
        console.error("Paylaşım hatası:", err);
    }
};

// Fixed Nickname Logic (Handle: @username)
window.promptNicknameChange = async () => {
    const profileUsername = document.querySelector('.profile-username');
    if (!profileUsername) return;
    const currentNick = profileUsername.textContent.replace('@', '').trim();
    const newNick = prompt("Yeni kullanıcı adınızı (@username) girin (3-20 karakter, harf/rakam):", currentNick);

    if (!newNick || newNick === currentNick) return;

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(newNick)) {
        alert("Geçersiz kullanıcı adı! (Sadece harf, rakam ve alt çizgi)");
        return;
    }

    try {
        const currentUser = AuthService.currentUser();
        await DBService.changeUsername(currentUser.uid, newNick);
        alert("Başarılı! Yeni kullanıcı adınız: @" + newNick);
        openProfileView(currentUser.uid);
    } catch (e) {
        alert("Hata: " + e.message);
    }
};

window.promptDisplayNameChange = async () => {
    const user = AuthService.currentUser();
    if (!user) return;

    const userProfile = await DBService.getUserProfile(user.uid);
    const newName = prompt("Görünür isminizi değiştirin:", userProfile.displayName || '');

    if (!newName || newName === userProfile.displayName) return;
    if (newName.length < 2 || newName.length > 30) {
        alert("İsim 2-30 karakter arasında olmalıdır.");
        return;
    }

    try {
        await DBService.updateUserProfile(user.uid, { displayName: newName });
        alert("İsim güncellendi!");
        openProfileView(user.uid);
    } catch (e) {
        alert("İsim güncellenirken hata oluştu: " + e.message);
    }
};

// Collaboration: Invite user to journal
window.inviteToJournal = async (journalId) => {
    const handle = prompt("Davet etmek istediğiniz kullanıcının @adını girin:");
    if (!handle) return;
    const cleanHandle = handle.replace('@', '').trim();

    try {
        // We'd need to find the user by handle first
        const users = await DBService.searchUsers(cleanHandle);
        const target = users.find(u => u.username?.toLowerCase() === cleanHandle.toLowerCase());

        if (!target) {
            alert("Kullanıcı bulunamadı.");
            return;
        }

        await DBService.inviteToJournal(journalId, target.uid);
        alert(target.displayName + " koleksiyona eklendi!");
    } catch (e) {
        alert("Davet hatası: " + e.message);
    }
};

// --- Custom Selector Logic ---

window.openSelector = (title, items, onSelect) => {
    // Remove any existing overlay first to prevent stacking
    const existing = document.querySelector('.custom-selector-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'custom-selector-overlay';

    // Use unique ID for the handler to identify this specific instance
    const selectorId = 'sel_' + Date.now();
    window[selectorId] = (value) => {
        onSelect(value);
        overlay.remove();
        document.body.style.overflow = '';
        delete window[selectorId];
    };

    overlay.innerHTML = `
        <div class="selector-sheet">
            <div class="selector-title">${title}</div>
            <div class="selector-grid">
                ${items.map(item => `
                    <div class="selector-item" onclick="window['${selectorId}']('${item.value}')">
                        <span>${item.icon}</span>
                        <label>${item.label}</label>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    overlay.onclick = (e) => {
        if (e.target === overlay) {
            overlay.remove();
            document.body.style.overflow = '';
            delete window[selectorId];
        }
    };
};

window.openJournalSelector = () => {
    const user = AuthService.currentUser();
    if (!user) return alert("Hata: Kullanıcı oturumu bulunamadı.");
    DBService.getUserJournals(user.uid).then(journals => {
        const items = journals.map(j => ({ value: j.id, label: j.name, icon: '📖' }));
        items.unshift({ value: '', label: 'Hiçbiri', icon: '❌' });

        window.openSelector('Koleksiyon Seç', items, (val) => {
            window._selectedJournal = val;
            const btn = document.getElementById('journalBtn');
            btn.querySelector('span').textContent = val ? '📖' : '📂';
        });
    });
};

window.openThemeSelector = () => {
    const items = [
        { value: 'default', label: 'Varsayılan', icon: '🎨' },
        { value: 'romantic', label: 'Romantik', icon: '💕' },
        { value: 'sad', label: 'Melankolik', icon: '🌧️' },
        { value: 'energetic', label: 'Enerjik', icon: '⚡' },
        { value: 'focus', label: 'Odaklı', icon: '🧘' },
        { value: 'vintage', label: 'Vintage', icon: '🎞️' },
        { value: 'neon', label: 'Neon Gece', icon: '🌃' },
        { value: 'oceanic', label: 'Okyanus', icon: '🌊' },
        { value: 'forest', label: 'Orman', icon: '🌲' },
        { value: 'minimal', label: 'Minimal', icon: '⚪' }
    ];
    window.openSelector('Anı Teması Seç', items, (val) => {
        window._selectedTheme = val;
        const btn = document.getElementById('themeBtn');
        if (btn) btn.querySelector('span').textContent = '🎨'; // Just a visual reset or specific icon
    });
};

window.openMoodSelector = () => {
    const items = [
        { value: '😊', label: 'Mutlu', icon: '😊' },
        { value: '😔', label: 'Üzgün', icon: '😔' },
        { value: '🔥', label: 'Heyecanlı', icon: '🔥' },
        { value: '😴', label: 'Yorgun', icon: '😴' },
        { value: '🧘', label: 'Huzurlu', icon: '🧘' }
    ];
    window.openSelector('Ruh Halini Seç', items, (val) => {
        window._selectedMood = val;
        const moodIcon = document.getElementById('moodIcon');
        if (moodIcon) moodIcon.textContent = val;
    });
};

// The original window.updateMoodIcon is now redundant if openMoodSelector handles it directly.
// Keeping it for now as the instruction didn't explicitly remove it, but its usage might change.
window.updateMoodIcon = (val) => {
    const moodIcon = document.getElementById('moodIcon');
    if (moodIcon) moodIcon.textContent = val;
    window._selectedMood = val;
};

// Final Profile Logic Cleanup
async function finalizeProfileOpen(uid, isOwnProfile) {
    if (isOwnProfile) {
        const profileNotiContent = document.getElementById('profileNotiContent');
        if (profileNotiContent) {
            renderNotificationsInto(window._notifications || [], profileNotiContent);
            // Mark as read when viewing own profile
            DBService.markNotificationsAsRead(uid).then(() => {
                const profileBtn = document.getElementById('profileBtn');
                if (profileBtn) profileBtn.classList.remove('has-noti');
            });
        }
    }
}

function renderNotificationsInto(notis, container) {
    if (notis.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:20px; text-align:center; opacity:0.6;">Henüz bir bildirim yok. 😊</div>';
        return;
    }

    container.innerHTML = notis.map(n => {
        let typeText = '';
        let typeIcon = '';
        if (n.type === 'follow') { typeText = 'seni takip etmeye başladı'; typeIcon = '👤'; }
        if (n.type === 'follow_request') { typeText = 'sana takip isteği gönderdi'; typeIcon = '📩'; }
        if (n.type === 'like') { typeText = 'anını beğendi'; typeIcon = '❤️'; }
        if (n.type === 'comment') { typeText = 'anına yorum yaptı'; typeIcon = '💬'; }

        return `
            <div class="noti-item ${n.isRead ? '' : 'unread'}" onclick="window.handleNotiClick('${n.momentId}', '${n.senderUid}')" style="display:flex; align-items:center; gap:12px; padding:12px; border-bottom:1px solid rgba(255,255,255,0.05); cursor:pointer;">
                <div class="noti-avatar" style="width:36px; height:36px; border-radius:50%; overflow:hidden; flex-shrink:0;">
                    ${n.senderPhoto?.startsWith('http') ? `<img src="${n.senderPhoto}" style="width:100%; height:100%; object-fit:cover;">` : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.1);">${n.senderPhoto || '👤'}</div>`}
                </div>
                <div class="noti-info" style="flex:1; min-width:0;">
                    <div style="font-size:0.85rem; color:var(--text-primary);"><b>${n.senderName}</b> ${typeText}</div>
                    <div style="font-size:0.7rem; color:var(--text-secondary); opacity:0.6;">${new Date(n.createdAt).toLocaleDateString('tr-TR')}</div>
                </div>
                <div class="noti-type-icon" style="font-size:1.1rem;">${typeIcon}</div>
            </div>
        `;
    }).join('');
}

// Final Hook to call logic AFTER the rest of the profile HTML is appended to innerHTML
function triggerProfileFinalize(uid, isOwnProfile) {
    if (typeof finalizeProfileOpen === 'function') {
        finalizeProfileOpen(uid, isOwnProfile);
    }
}
// --- Explore Mode Enhancements ---


function injectExploreSearch() {
    // Prevent duplicate injection
    if (document.getElementById('exploreSearchContainer')) return;

    const timeline = document.getElementById('timeline');
    if (!timeline) return;

    const container = document.createElement('div');
    container.id = 'exploreSearchContainer';
    container.className = 'explore-search-container';
    container.innerHTML = `
        <input type="text" id="exploreSearchInput" class="explore-search-box" placeholder="Dünya çapındaki anılarda ara...">
    `;

    // Insert before the timeline content
    timeline.parentNode.insertBefore(container, timeline);

    const searchInput = document.getElementById('exploreSearchInput');
    searchInput.addEventListener('input', (e) => {
        renderTimeline(e.target.value);
    });
}

// Initial placeholder or export if needed
window.injectExploreSearch = injectExploreSearch;
