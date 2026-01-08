/**
 * momentLog - Complete Application Logic v19
 * Gold Theme Edition - Phase 29 Restore
 */

// --- Global Error Monitor ---
window.onerror = function (msg, url, line) {
    console.error("Error: " + msg + " at line " + line);
    return false;
};

console.log("momentLog: Script loading v19...");

// --- Constants & State ---
const STORAGE_KEY = 'momentLog_data_v2';
const MAX_PHOTOS = 4;

let moments = [];
let currentMedia = [];
let currentLocation = null;
let backgroundAudio = null;
let currentMomentTheme = 'minimal';
let currentMood = '😊';
let isDictating = false;
let mediaRecorder = null;
let audioChunks = [];
const MAX_AUDIO_SECONDS = 30;
let myPrivateMoments = []; // Separate cache for own moments to ensure individual visibility
let currentLastDoc = null; // Pagination: track last visible document
let hasMore = true; // Pagination: flag if more data exists
let isLoadingNextPage = false; // Pagination: prevent multiple simultaneous loads

// --- Image Compression for Fallback ---
async function compressImage(dataUrl, quality = 0.3, maxWidth = 500) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.warn("Compression timed out");
            resolve(null);
        }, 15000);

        const img = new Image();
        img.onload = () => {
            clearTimeout(timeout);
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const compressedData = canvas.toDataURL('image/jpeg', quality);
            resolve(compressedData);
        };
        img.onerror = () => {
            clearTimeout(timeout);
            resolve(null);
        };
        img.src = dataUrl;
    });
}

// --- Theme Selector Functions ---
window.openThemeSelector = () => {
    const picker = document.getElementById('themePicker');
    if (picker) picker.classList.remove('hidden');
};

window.selectTheme = (theme) => {
    currentMomentTheme = theme;
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
    document.getElementById('themePicker')?.classList.add('hidden');

    // Preview theme in input area
    const inputSection = document.querySelector('.input-section');
    if (inputSection) {
        // Remove old theme classes
        inputSection.className = 'input-section';
        if (theme !== 'minimal') {
            inputSection.classList.add(`theme-${theme}`);
        }
    }

    // Update theme button to show selected
    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) themeBtn.title = `Tema: ${theme}`;
};

// --- Mini Collage Generator (for Feed Carousel) ---
function generateMiniCollage(media) {
    const images = media.filter(m => m.type === 'image').slice(0, 4);
    if (images.length === 0) return '';

    let html = `<div class="mini-collage count-${images.length}">`;
    images.forEach((img, idx) => {
        const rotation = (idx % 2 === 0 ? 1 : -1) * (Math.random() * 8 + 4);

        let top = 0, left = 0;
        if (images.length === 1) {
            top = 20; left = 25; // Centered
        } else if (images.length === 2) {
            top = idx === 0 ? 15 : 45;
            left = idx === 0 ? 10 : 40;
        } else if (images.length === 3) {
            const positions = [
                { t: 10, l: 25 },
                { t: 40, l: 10 },
                { t: 55, l: 40 }
            ];
            top = positions[idx].t;
            left = positions[idx].l;
        } else { // 4 photos
            const positions = [
                { t: 10, l: 10 },
                { t: 10, l: 40 },
                { t: 50, l: 10 },
                { t: 50, l: 40 }
            ];
            top = positions[idx].t;
            left = positions[idx].l;
        }

        html += `
            <div class="mini-img-wrapper" 
                 style="transform: rotate(${rotation}deg); top: ${top}%; left: ${left}%; z-index: ${idx + 1};"
                 onclick="window.bringPhotoToFront(event)">
                <img src="${img.url || img.data}">
            </div>
        `;
    });
    html += `</div>`;
    return html;
}

window.bringPhotoToFront = (event) => {
    const wrapper = event.currentTarget;
    const collage = wrapper.parentElement;
    const allWrappers = collage.querySelectorAll('.mini-img-wrapper');
    allWrappers.forEach(w => w.style.zIndex = '1');
    wrapper.style.zIndex = '10';
};

// --- Profile Edit Functions ---
let editPhotoData = null;
let originalUsername = '';

window.openEditProfileModal = async () => {
    const currentUser = AuthService.currentUser();
    if (!currentUser) return;

    const modal = document.getElementById('editProfileModal');
    if (!modal) return;

    // Load current profile data
    const profile = await DBService.getUserProfile(currentUser.uid);

    document.getElementById('editDisplayName').value = profile.displayName || '';
    document.getElementById('editUsername').value = profile.username || '';
    document.getElementById('editBio').value = profile.bio || '';

    originalUsername = profile.username || '';

    // Show current photo
    const preview = document.getElementById('editAvatarPreview');
    if (profile.photoURL?.startsWith('http') || profile.photoURL?.startsWith('data:')) {
        preview.innerHTML = `<img src="${profile.photoURL}">`;
    } else {
        preview.innerHTML = profile.photoURL || '👤';
    }
    editPhotoData = null;

    modal.classList.remove('hidden');

    // Setup photo input handler
    document.getElementById('editPhotoInput').onchange = handleEditPhotoInput;

    // Setup username check on input
    document.getElementById('editUsername').oninput = debounce(checkUsernameAvailability, 500);
};

window.closeEditProfileModal = () => {
    const modal = document.getElementById('editProfileModal');
    if (modal) modal.classList.add('hidden');
    editPhotoData = null;
};

function handleEditPhotoInput(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        editPhotoData = event.target.result;
        const preview = document.getElementById('editAvatarPreview');
        preview.innerHTML = `<img src="${editPhotoData}">`;
    };
    reader.readAsDataURL(file);
}

let usernameCheckSeq = 0;
async function checkUsernameAvailability() {
    const input = document.getElementById('editUsername');
    const status = document.getElementById('usernameStatus');
    const username = input.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

    // Auto-clean input
    if (input.value.toLowerCase() !== username) {
        input.value = username;
    }

    if (!username) {
        status.textContent = '';
        return;
    }

    if (originalUsername && username === originalUsername.toLowerCase()) {
        status.textContent = '✓ Mevcut kullanıcı adınız';
        status.className = 'username-status available';
        return;
    }

    status.textContent = 'Kontrol ediliyor...';
    status.className = 'username-status';

    const currentSeq = ++usernameCheckSeq;

    try {
        const available = await DBService.checkUsernameAvailability(username);

        // Only update if this is still the latest request
        if (currentSeq === usernameCheckSeq) {
            if (available) {
                status.textContent = '✓ Bu kullanıcı adı müsait';
                status.className = 'username-status available';
            } else {
                status.textContent = '✗ Bu kullanıcı adı alınmış';
                status.className = 'username-status taken';
            }
        }
    } catch (e) {
        if (currentSeq === usernameCheckSeq) {
            console.error("Username check error:", e);
            // If it's a permission error, it might be due to Firestore propagation delay
            status.textContent = '⚠ Bağlantı hatası, tekrar deneyin';
            status.className = 'username-status taken';
        }
    }
}

window.saveProfileChanges = async () => {
    const currentUser = AuthService.currentUser();
    if (!currentUser) return;

    const displayName = document.getElementById('editDisplayName').value.trim();
    const username = document.getElementById('editUsername').value.trim().toLowerCase();
    const bio = document.getElementById('editBio').value.trim();

    // Validate username
    if (username && username !== originalUsername.toLowerCase()) {
        if (!/^[a-z0-9_]+$/.test(username)) {
            showModal('Hata', 'Kullanıcı adı sadece harf, rakam ve alt çizgi içerebilir.');
            return;
        }
        const available = await DBService.checkUsernameAvailability(username);
        if (!available) {
            showModal('Hata', 'Bu kullanıcı adı zaten alınmış.');
            return;
        }
    }

    try {
        let photoURL = null;

        // Upload new photo if selected (returns base64 directly)
        if (editPhotoData) {
            photoURL = await DBService.uploadProfilePhoto(currentUser.uid, editPhotoData);
        }

        // Prepare update data
        const updateData = {
            displayName: displayName || 'İsimsiz',
            bio: bio
        };

        if (username && username !== originalUsername.toLowerCase()) {
            await DBService.changeUsername(currentUser.uid, username);
            // After changing username, avoid updating it again in updateUserProfile
        } else {
            // Only update display name and bio if username didn't change
            // or if it changed, we update those too in the next step
        }

        if (photoURL) {
            updateData.photoURL = photoURL;
        }

        await DBService.updateUserProfile(currentUser.uid, updateData);

        // Update Firebase Auth profile - ONLY displayName to avoid "Photo url too long" error
        // Current Firebase Auth photoURL has a 2048 char limit, our Base64 is much longer.
        try {
            await AuthService.updateProfile({
                displayName: updateData.displayName
            });
        } catch (authError) {
            console.warn("Auth profile update (displayName) failed, continuing:", authError);
        }

        // Sync older moments with new profile data
        await DBService.syncUserMoments(currentUser.uid, updateData);

        // Update header profile photo if changed
        if (photoURL && dom.profileBtn) {
            const img = dom.profileBtn.querySelector('img') || document.createElement('img');
            img.src = photoURL;
            if (!dom.profileBtn.querySelector('img')) {
                dom.profileBtn.innerHTML = '';
                dom.profileBtn.appendChild(img);
            }
            dom.profileBtn.classList.add('has-avatar');
        }

        window.closeEditProfileModal();
        showModal('Başarılı', 'Profiliniz güncellendi!');
        openProfileView(currentUser.uid);

    } catch (e) {
        console.error('Profile update error:', e);
        showModal('Hata', 'Profil güncellenemedi: ' + e.message);
    }
};

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}


// --- Custom Modal Helper ---
function showModal(title, message, isConfirm = false, duration = 0) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalMsg = document.getElementById('modalMessage');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');

        if (!modal) {
            if (isConfirm) resolve(confirm(message));
            else { alert(message); resolve(true); }
            return;
        }

        modalTitle.textContent = title;
        modalMsg.textContent = message;
        modal.classList.remove('hidden');
        cancelBtn.style.display = isConfirm ? 'block' : 'none';

        let autoCloseTimer = null;

        const handleConfirm = () => { cleanup(); resolve(true); };
        const handleCancel = () => { cleanup(); resolve(false); };
        const cleanup = () => {
            if (autoCloseTimer) clearTimeout(autoCloseTimer);
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            modal.classList.add('hidden');
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);

        if (duration > 0 && !isConfirm) {
            autoCloseTimer = setTimeout(handleConfirm, duration);
        }
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
        photoInput: document.getElementById('photoInput'),
        recordBtn: document.getElementById('recordBtn'),
        musicBtn: document.getElementById('musicBtn'),
        themeSelect: document.getElementById('themeSelect'),
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
        venueInput: document.getElementById('venueInput'),
        stickerInput: document.getElementById('stickerInput'),
        musicInput: document.getElementById('musicInput'),
        musicUrlInput: document.getElementById('musicUrlInput'),
    };
}

let isPublicState = false;
let currentView = 'my-moments';
let isRealLocationActive = false;
const APP_THEMES = ['default', 'light', 'vintage'];
let currentAppTheme = localStorage.getItem('appTheme') || 'light';

// --- Music Manager ---
const MusicManager = {
    audio: new Audio(),
    currentMomentId: null,
    isPlaying: false,
    originalVolume: 1.0,

    async play(url, momentId) {
        if (!url) return;

        // If same song, toggle
        if (this.currentMomentId === momentId) {
            if (this.isPlaying) {
                this.pause();
            } else {
                try {
                    console.log(`[MusicManager] Resuming for ${momentId}`);
                    await this.audio.play();
                    this.isPlaying = true;
                } catch (e) { console.warn("[MusicManager] Resume failed:", e); }
            }
            this.updateUI();
            return;
        }

        // Different song
        console.log(`[MusicManager] Playing new track for ${momentId}: ${url}`);
        this.pause();
        this.audio.src = url;
        this.audio.load(); // Explicit load
        this.audio.loop = true;
        this.audio.volume = this.originalVolume;
        try {
            await this.audio.play();
            this.currentMomentId = momentId;
            this.isPlaying = true;
        } catch (e) {
            console.warn("[MusicManager] Autoplay blocked or failed:", e);
            // Browser might need interaction, but we have unlocker now
        }
        this.updateUI();
    },

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.updateUI();
    },

    setVolume(val) {
        this.audio.volume = val;
    },

    updateUI() {
        document.querySelectorAll('.music-toggle-btn').forEach(btn => {
            const mid = btn.dataset.momentId;
            if (mid === this.currentMomentId && this.isPlaying) {
                btn.innerHTML = '⏸️';
                btn.classList.add('playing');
            } else {
                btn.innerHTML = '▶️';
                btn.classList.remove('playing');
            }
        });
    }
};

// --- Music Metadata & Preview Fetcher ---
async function fetchMusicMetadata(url) {
    if (!url || (!url.includes('spotify.com') && !url.includes('open.spotify.com'))) return null;

    try {
        // 1. Spotify oEmbed to get title/artist
        const spotifyOembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
        const response = await fetch(spotifyOembedUrl);
        if (!response.ok) return null;
        const data = await response.json();

        if (data && data.title) {
            let title = data.title;
            // Clean title
            title = title.replace(' | Spotify', '').replace(' - song by ', ' - ');

            // 2. Search Deezer for the 30s preview (JSONP to bypass CORS)
            const searchTerms = title.split(' - ');
            const query = searchTerms.length > 1 ? `${searchTerms[0]} ${searchTerms[1]}` : title;

            return new Promise((resolve) => {
                const callbackName = 'deezerCallback_' + Math.floor(Math.random() * 1000000);
                window[callbackName] = (res) => {
                    delete window[callbackName];
                    const s = document.getElementById(callbackName);
                    if (s) s.remove();
                    if (res.data && res.data.length > 0) {
                        resolve({
                            title: title,
                            previewUrl: res.data[0].preview
                        });
                    } else {
                        resolve({ title: title, previewUrl: null });
                    }
                };
                const script = document.createElement('script');
                script.id = callbackName;
                script.src = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1&output=jsonp&callback=${callbackName}`;
                document.body.appendChild(script);
                // Timeout after 5s
                setTimeout(() => { if (window[callbackName]) resolve({ title: title, previewUrl: null }); }, 5000);
            });
        }
    } catch (err) {
        console.error("Music metadata fetch failed:", err);
    }
    return null;
}

// --- Voice Recorder Manager ---
const VoiceRecorder = {
    mediaRecorder: null,
    audioChunks: [],
    isRecording: false,
    recordingTimeout: null,
    recordedBlob: null,

    async start() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.onstop = () => {
                this.recordedBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                this.isRecording = false;
                MusicManager.setVolume(MusicManager.originalVolume);
                this.updateUI();
                console.log("Kayıt tamamlandı, blob boyutu:", this.recordedBlob.size);
            };

            // Start recording
            this.mediaRecorder.start();
            this.isRecording = true;
            MusicManager.setVolume(0.25); // Duck the music
            this.updateUI();

            // Auto-stop after 20 seconds
            this.recordingTimeout = setTimeout(() => {
                if (this.isRecording) this.stop();
            }, 20000);

        } catch (err) {
            console.error("Mikrofon erişim hatası:", err);
            showModal("Hata", "Mikrofona erişilemedi. Lütfen izinleri kontrol edin.");
        }
    },

    stop() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            clearTimeout(this.recordingTimeout);
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    },

    toggle() {
        if (this.isRecording) this.stop();
        else this.start();
    },

    updateUI() {
        const btn = document.getElementById('recordBtn');
        if (btn) {
            if (this.isRecording) {
                btn.classList.add('recording');
                btn.innerHTML = '⏹️';
            } else {
                btn.classList.remove('recording');
                btn.innerHTML = '🎤';
            }
        }
    }
};

window.toggleMusic = (url, momentId) => {
    MusicManager.play(url, momentId);
};

window.handleCardClick = (e, momentId, musicUrl) => {
    // Prevent triggering if clicking on buttons, interactive elements, or collage photos
    const interactiveTags = ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'LABEL'];
    if (interactiveTags.includes(e.target.tagName) || e.target.closest('.user-info') || e.target.closest('.card-actions') || e.target.closest('.mini-img-wrapper')) {
        return;
    }

    if (musicUrl) {
        console.log(`[CardClick] Triggering music for ${momentId}`);
        window.toggleMusic(musicUrl, momentId);
    }
};

// --- Voice Memo Playback ---
const VoicePlayer = {
    audio: new Audio(),
    currentMomentId: null,
    isPlaying: false,

    async play(url, momentId) {
        if (!url) return;

        if (this.currentMomentId === momentId && this.isPlaying) {
            this.pause();
            return;
        }

        this.pause();
        this.audio.src = url;

        // Duck music during voice playback
        MusicManager.setVolume(0.25);

        try {
            await this.audio.play();
            this.currentMomentId = momentId;
            this.isPlaying = true;
            this.updateUI();

            this.audio.onended = () => {
                this.isPlaying = false;
                MusicManager.setVolume(MusicManager.originalVolume);
                this.updateUI();
            };
        } catch (e) { console.warn("Voice playback failed:", e); }
    },

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        MusicManager.setVolume(MusicManager.originalVolume);
        this.updateUI();
    },

    updateUI() {
        document.querySelectorAll('.voice-play-btn').forEach(btn => {
            const mid = btn.dataset.momentId;
            if (mid === this.currentMomentId && this.isPlaying) {
                btn.innerHTML = '⏸️ Dinleniyor...';
                btn.classList.add('playing');
            } else {
                btn.innerHTML = '🎤 Sesli Not';
                btn.classList.remove('playing');
            }
        });
    }
};

window.toggleVoiceMemo = (url, momentId) => {
    VoicePlayer.play(url, momentId);
};
// --------------------

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize selectors and events
    initializeSelectors();

    // Setup Infinite Scroll
    setupInfiniteScroll();

    // Check last view
    console.log("momentLog: DOM Loaded v19");

    if (dom.momentDate) {
        const today = new Date().toISOString().split('T')[0];
        dom.momentDate.max = today;
        dom.momentDate.value = today;
    }

    // Always start with akış (my-moments) view - no persistence
    currentView = 'my-moments';

    try {
        setupEventListeners();
        applyAppTheme(currentAppTheme);
        setupAutoplayObserver();
        console.log("momentLog: UI Initialized Successfully v19");
    } catch (e) {
        console.error("Initialization Error:", e);
    }

    // Auth Listener
    AuthService.onAuthStateChanged(async (user) => {
        const loginOverlay = document.getElementById('loginOverlay');
        const loadingSplash = document.getElementById('loadingSplash');
        const appDiv = document.getElementById('app');

        try {
            if (user) {
                console.log("Kullanıcı giriş yaptı:", user.displayName);
                if (loginOverlay) loginOverlay.classList.remove('active');

                // Get full profile from Firestore
                const userProfile = await DBService.getUserProfile(user.uid);
                const displayPhoto = userProfile?.photoURL || user.photoURL;

                if (displayPhoto && dom.profileBtn) {
                    dom.profileBtn.innerHTML = `<img src="${displayPhoto}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
                    dom.profileBtn.classList.add('has-avatar');
                }

                if (dom.userNameSpan) {
                    dom.userNameSpan.textContent = userProfile?.username || user.displayName || 'Kullanıcı';
                }

                // Load initial sidebar data
                const res = await DBService.getMyMoments();
                myPrivateMoments = res.moments || [];
                renderMyRecentMoments();

                // Set initial view and load data
                let lastView = localStorage.getItem('momentLog_lastView');

                // Safety: On init, if last view was profile or notifications, 
                // go back home because we don't store UID/context for these.
                if (lastView === 'profile' || lastView === 'notifications') {
                    lastView = 'my-following';
                }

                console.log("Setting initial view:", lastView || 'my-following');
                await window.setView(lastView || 'my-following', true);

                setupNotifications();
            } else {
                console.log("Kullanıcı giriş yapmadı.");
                if (loginOverlay) loginOverlay.classList.add('active');
                moments = [];
                myPrivateMoments = [];
                renderTimeline();
            }
        } catch (error) {
            console.error("Auth state processing error:", error);
        } finally {
            if (loadingSplash) loadingSplash.classList.add('hidden');
        }

        // Show app with a slight delay
        setTimeout(() => {
            if (appDiv) {
                appDiv.classList.remove('hidden');
                appDiv.classList.add('fade-in');
            }
        }, 100);
    });

    // Login Button
    document.getElementById('googleLoginBtn')?.addEventListener('click', async () => {
        try {
            await AuthService.signInWithGoogle();
        } catch (err) {
            console.error("Giriş hatası:", err);
            showModal("Hata", "Giriş yapılırken bir hata oluştu: " + err.message);
        }
    });

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('SW Registered'))
            .catch(err => console.log('SW Registration Failed', err));

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });
    }
});

// --- Event Listeners Setup ---
function setupEventListeners() {
    // Photo input
    if (dom.photoInput) {
        dom.photoInput.addEventListener('change', handlePhotoInput);
    }

    // Profile button
    if (dom.profileBtn) {
        dom.profileBtn.onclick = () => {
            const user = AuthService.currentUser();
            if (user) openProfileView(user.uid);
            else showModal('Giriş Gerekli', "Lütfen önce giriş yapın.");
        };
    }

    // Visibility toggle
    if (dom.visibilityToggle) {
        dom.visibilityToggle.onclick = () => {
            isPublicState = !isPublicState;
            const visibleIcon = document.getElementById('visibleIcon');
            const privateIcon = document.getElementById('privateIcon');
            if (isPublicState) {
                visibleIcon?.classList.remove('hidden');
                privateIcon?.classList.add('hidden');
                dom.visibilityToggle.title = "Görünürlük: Herkese Açık";
            } else {
                visibleIcon?.classList.add('hidden');
                privateIcon?.classList.remove('hidden');
                dom.visibilityToggle.title = "Görünürlük: Sadece Ben";
            }
        };
    }

    // View buttons
    const exploreBtn = document.getElementById('exploreBtn');
    const homeBtn = document.getElementById('homeBtn');
    const headerAddBtn = document.getElementById('headerAddBtn');
    const notificationsBtn = document.getElementById('notificationsBtn');
    const inputSectionBase = document.querySelector('.input-section');
    const dashboardFooter = document.getElementById('dashboardFooter');
    const myRecentMoments = document.getElementById('myRecentMoments');

    window.setView = async (viewName, force = false) => {
        if (!force && currentView === viewName) return;

        currentView = viewName;
        localStorage.setItem('momentLog_lastView', currentView);

        // Reset pagination state on view change
        currentLastDoc = null;
        hasMore = true;
        moments = [];
        if (dom.timeline) dom.timeline.innerHTML = ''; // Clear feed for fresh load

        const titleEl = document.querySelector('.main-title');
        if (titleEl) titleEl.textContent = "momentLog";

        if (currentView === 'explore') {
            exploreBtn?.classList.add('active');
            homeBtn?.classList.remove('active');
            headerAddBtn?.classList.remove('active');
            notificationsBtn?.classList.remove('active');
            profileBtn?.classList.remove('active');

            inputSectionBase?.classList.add('hidden-mode');
            dashboardFooter?.classList.add('hidden-mode');
            myRecentMoments?.classList.add('hidden-mode');
            document.getElementById('profileView')?.classList.add('hidden-mode');
            document.getElementById('notiView')?.classList.add('hidden-mode');
            dom.timeline?.classList.remove('hidden-mode');
        } else if (currentView === 'write') {
            exploreBtn?.classList.remove('active');
            homeBtn?.classList.remove('active');
            headerAddBtn?.classList.add('active');
            notificationsBtn?.classList.remove('active');
            profileBtn?.classList.remove('active');

            inputSectionBase?.classList.remove('hidden-mode');
            dashboardFooter?.classList.remove('hidden-mode');
            myRecentMoments?.classList.remove('hidden-mode');
            document.getElementById('profileView')?.classList.add('hidden-mode');
            document.getElementById('notiView')?.classList.add('hidden-mode');
            dom.timeline?.classList.add('hidden-mode');
        } else if (currentView === 'notifications') {
            exploreBtn?.classList.remove('active');
            homeBtn?.classList.remove('active');
            headerAddBtn?.classList.remove('active');
            notificationsBtn?.classList.add('active');
            profileBtn?.classList.remove('active');

            inputSectionBase?.classList.add('hidden-mode');
            dashboardFooter?.classList.add('hidden-mode');
            myRecentMoments?.classList.add('hidden-mode');
            dom.timeline?.classList.add('hidden-mode');
            document.getElementById('profileView')?.classList.add('hidden-mode');
            document.getElementById('notiView')?.classList.remove('hidden-mode');

            // Mark as read naturally
            renderNotificationsInView(window._notifications || []);
            const currentUser = AuthService.currentUser();
            if (currentUser) {
                DBService.markNotificationsAsRead(currentUser.uid);
                const badge = document.getElementById('notifBadge');
                if (badge) badge.classList.add('hidden');
            }
        } else if (currentView === 'profile') {
            exploreBtn?.classList.remove('active');
            homeBtn?.classList.remove('active');
            headerAddBtn?.classList.remove('active');
            notificationsBtn?.classList.remove('active');
            profileBtn?.classList.add('active');

            inputSectionBase?.classList.add('hidden-mode');
            dashboardFooter?.classList.add('hidden-mode');
            myRecentMoments?.classList.add('hidden-mode');
            dom.timeline?.classList.add('hidden-mode');
            document.getElementById('notiView')?.classList.add('hidden-mode');
            document.getElementById('profileView')?.classList.remove('hidden-mode');
        } else {
            // Home / Following View
            exploreBtn?.classList.remove('active');
            homeBtn?.classList.add('active');
            headerAddBtn?.classList.remove('active');
            notificationsBtn?.classList.remove('active');
            profileBtn?.classList.remove('active');

            inputSectionBase?.classList.add('hidden-mode');
            dashboardFooter?.classList.add('hidden-mode');
            myRecentMoments?.classList.add('hidden-mode');
            document.getElementById('profileView')?.classList.add('hidden-mode');
            document.getElementById('notiView')?.classList.add('hidden-mode');
            dom.timeline?.classList.remove('hidden-mode');
        }

        await loadMoments();
        renderTimeline();
        if (currentView === 'write') renderMyRecentMoments();
    };

    if (homeBtn) homeBtn.onclick = () => window.setView('my-following');
    if (exploreBtn) exploreBtn.onclick = () => window.setView('explore');
    if (headerAddBtn) headerAddBtn.onclick = () => window.setView('write');
    if (notificationsBtn) notificationsBtn.onclick = () => window.setView('notifications');
    if (profileBtn) profileBtn.onclick = () => {
        const currentUser = AuthService.currentUser();
        if (currentUser) window.openProfileView(currentUser.uid);
    };

    // Add Location Button
    const addLocBtn = document.getElementById('addLocationBtn');
    if (addLocBtn) {
        addLocBtn.onclick = () => window.handleRealLocation();
    }

    // Music Button (Simplified: Only Link Input)
    if (dom.musicBtn) {
        dom.musicBtn.onclick = () => {
            // Keep musicInput hidden, only show/hide UrlInput
            dom.musicUrlInput.classList.toggle('hidden');
            if (!dom.musicUrlInput.classList.contains('hidden')) {
                dom.musicUrlInput.focus();
            }
        };
    }

    // Record Button
    if (dom.recordBtn) {
        dom.recordBtn.onclick = () => VoiceRecorder.toggle();
    }

    // Save button
    if (dom.addBtn) {
        dom.addBtn.onclick = saveMoment;
    }

    // Search
    if (dom.searchInput) {
        dom.searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            renderTimeline(query);
        });
    }

    // Music URL Input Listener
    if (dom.musicUrlInput) {
        dom.musicUrlInput.oninput = debounce(async (e) => {
            const url = e.target.value.trim();
            if (url.includes('spotify.com')) {
                const status = document.createElement('div');
                status.id = 'music-loading-status';
                status.style.cssText = 'font-size: 10px; color: var(--accent); margin-top: 5px;';
                status.textContent = '🎵 Spotify bilgileri çekiliyor...';
                dom.musicUrlInput.after(status);

                const data = await fetchMusicMetadata(url);
                status.remove();

                if (data) {
                    if (dom.musicInput) {
                        dom.musicInput.classList.remove('hidden');
                        dom.musicInput.value = data.title;
                    }
                    if (data.previewUrl) {
                        dom.musicUrlInput.dataset.previewUrl = data.previewUrl;
                    }
                }
            }
        }, 800);
    }
}

// --- Infinite Scroll ---
function setupInfiniteScroll() {
    const sentinel = document.createElement('div');
    sentinel.id = 'infinite-scroll-sentinel';
    sentinel.style.height = '10px';
    sentinel.style.margin = '20px 0';
    dom.timeline?.after(sentinel);

    const observer = new IntersectionObserver(async (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingNextPage) {
            console.log("Loading more moments...");
            await loadMoments();
            renderTimeline();
        }
    }, { rootMargin: '400px' });

    observer.observe(sentinel);
}

// --- Autoplay Music on Scroll ---
function setupAutoplayObserver() {
    const options = {
        root: null,
        rootMargin: '0px',
        threshold: 0.4 // Lower threshold for faster trigger
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const card = entry.target;
                const momentId = card.dataset.id;
                // Find moment data to get musicUrl
                const moment = moments.find(m => m.id === momentId);
                if (moment && moment.musicUrl) {
                    console.log("Autoplay music for card:", momentId);
                    window.toggleMusic(moment.musicUrl, momentId);
                }
            }
        });
    }, options);

    // Initial observation of cards
    document.querySelectorAll('.moment-card').forEach(card => observer.observe(card));

    // Also observe new cards when they are rendered
    window._autoplayObserver = observer;

    // Audio Unlocker: Browser policy bypass
    const unlockAudio = () => {
        console.log("[Audio] System unlocked by user interaction");
        MusicManager.audio.play().then(() => {
            MusicManager.audio.pause();
            MusicManager.isUnlocked = true;
        }).catch((err) => {
            console.warn("[Audio] Unlock failed:", err);
        });
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
}

// --- App Theme System ---
function applyAppTheme(theme) {
    document.body.classList.remove('app-theme-light', 'app-theme-vintage');
    if (theme === 'light') {
        document.body.classList.add('app-theme-light');
    } else if (theme === 'vintage') {
        document.body.classList.add('app-theme-vintage');
    }
    currentAppTheme = theme;
    localStorage.setItem('appTheme', theme);
}

// --- Data Operations ---
async function loadMoments() {
    if (isLoadingNextPage || !hasMore) return;
    isLoadingNextPage = true;

    try {
        const currentUser = AuthService.currentUser();
        let result;

        // Fetch own moments once for sidebar
        if (currentUser && myPrivateMoments.length === 0) {
            const res = await DBService.getMyMoments();
            myPrivateMoments = res.moments || [];
        }

        if (currentView === 'explore') {
            result = await DBService.getPublicMoments(currentLastDoc);
        } else if (currentView === 'write') {
            result = { moments: myPrivateMoments, lastVisible: null };
            hasMore = false;
        } else if (currentView === 'my-moments') {
            result = await DBService.getMyMoments(currentLastDoc);
        } else {
            result = await DBService.getFollowingMoments(currentLastDoc);
        }

        if (result) {
            const newMoments = result.moments || [];
            moments = [...moments, ...newMoments];
            currentLastDoc = result.lastVisible;

            if (newMoments.length < 5) {
                hasMore = false;
            }
        } else {
            hasMore = false;
        }
    } catch (e) {
        console.error("Veri yükleme hatası:", e);
        hasMore = false;
    } finally {
        isLoadingNextPage = false;
    }
}

async function saveMoment() {
    const text = dom.input?.value?.trim();
    const dateInput = dom.momentDate?.value;

    if (!text && currentMedia.length === 0) {
        showModal('Boş Anı', 'Lütfen bir metin girin veya medya ekleyin.');
        return;
    }

    const currentUser = AuthService.currentUser();
    if (!currentUser) {
        showModal('Giriş Gerekli', 'Lütfen önce giriş yapın.');
        return;
    }

    const saveBtn = dom.addBtn;
    const originalBtnText = saveBtn?.innerHTML;
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span>Kaydediliyor...</span>';
    }

    try {
        const userProfile = await DBService.getUserProfile(currentUser.uid);

        // Upload media to Firebase Storage and get URLs
        const uploadedMedia = [];
        const mediaToUpload = currentMedia.filter(m => m && typeof m.data === 'string');

        console.log('Media to upload:', mediaToUpload.length);

        if (mediaToUpload.length > 0) {
            showUploadProgress(0, mediaToUpload.length);

            for (let i = 0; i < mediaToUpload.length; i++) {
                const m = mediaToUpload[i];
                console.log('Uploading media', i + 1, 'type:', m.type);
                try {
                    const url = await DBService.uploadMedia(m.data, m.type || 'image');
                    console.log('Upload result:', url ? 'success' : 'failed');
                    if (url) {
                        uploadedMedia.push({ type: m.type || 'image', url: url });
                    } else {
                        // Fallback: if Storage fails, try to save compressed base64
                        console.log('Storage failed, using compressed data URL');
                        const compressedData = await compressImage(m.data, 0.3, 500);
                        if (compressedData) {
                            uploadedMedia.push({ type: m.type || 'image', url: compressedData });
                        }
                    }
                } catch (uploadErr) {
                    console.error('Media upload error:', uploadErr);
                    // Fallback on error too
                    try {
                        const compressedData = await compressImage(m.data, 0.3, 500);
                        if (compressedData) {
                            uploadedMedia.push({ type: m.type || 'image', url: compressedData });
                        }
                    } catch (compressErr) {
                        console.error('Compression error:', compressErr);
                    }
                }
                showUploadProgress(i + 1, mediaToUpload.length);
            }
            hideUploadProgress();
        }

        // Upload Voice Memo if exists
        let voiceUrl = null;
        if (VoiceRecorder.recordedBlob) {
            console.log('Uploading voice memo...');
            try {
                // Convert blob to base64 for uploadMedia
                const reader = new FileReader();
                const base64Promise = new Promise(resolve => {
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(VoiceRecorder.recordedBlob);
                });
                const base64Data = await base64Promise;
                voiceUrl = await DBService.uploadMedia(base64Data, 'audio');
                console.log('Voice memo uploaded:', voiceUrl);
            } catch (err) {
                console.error('Voice upload error:', err);
            }
        }

        console.log('Uploaded media count:', uploadedMedia.length);

        // Ensure location is a simple string
        const locationString = typeof currentLocation === 'string' ? currentLocation :
            (currentLocation?.text || currentLocation?.name || null);

        const venue = dom.venueInput?.value?.trim() || null;
        const stickerText = dom.stickerInput?.value?.trim() || null;

        const momentData = {
            text: String(text || ''),
            media: uploadedMedia,
            location: locationString,
            venue: venue,
            stickerText: stickerText,
            musicText: dom.musicInput?.value?.trim() || null,
            musicUrl: dom.musicUrlInput?.dataset?.previewUrl || dom.musicUrlInput?.value?.trim() || null,
            voiceUrl: voiceUrl,
            theme: String(currentMomentTheme || 'minimal'),
            mood: String(currentMood || '😊'),
            userId: String(currentUser.uid),
            userDisplayName: String(userProfile?.username || userProfile?.displayName || currentUser.displayName || 'Anonim'),
            userPhotoURL: String(userProfile?.photoURL || currentUser.photoURL || '👤'),
            isPublic: Boolean(isPublicState),
            isPrivateProfile: Boolean(userProfile?.isPrivateProfile), // Store privacy during save
            likes: [],
            commentsCount: 0,
            createdAt: (() => {
                const now = new Date();
                if (dateInput) {
                    const selected = new Date(dateInput);
                    // Set current hours/mins/secs to the selected date
                    selected.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
                    return selected.toISOString();
                }
                return now.toISOString();
            })()
        };

        if (isRealLocationActive && locationString) {
            momentData.verifiedLocation = true;
        }

        try {
            await DBService.createMoment(momentData);
        } catch (saveErr) {
            console.error("Kritik Kaydetme Hatası:", saveErr);
            throw new Error("Anı veritabanına yazılamadı: " + saveErr.message);
        }

        // --- SUCCESS PATH: Reset and Refresh UI ---
        try {
            // Reset inputs
            if (dom.input) dom.input.value = '';
            if (dom.venueInput) {
                dom.venueInput.value = '';
                dom.venueInput.classList.add('hidden');
            }
            if (dom.stickerInput) dom.stickerInput.value = '';
            if (dom.musicInput) {
                dom.musicInput.value = '';
                dom.musicInput.classList.add('hidden');
            }
            if (dom.musicUrlInput) {
                dom.musicUrlInput.value = '';
                dom.musicUrlInput.classList.add('hidden');
                delete dom.musicUrlInput.dataset.previewUrl;
            }

            // Reset media and voice
            currentMedia = [];
            VoiceRecorder.recordedBlob = null;
            VoiceRecorder.updateUI();
            renderPreview();
            if (dom.previewArea) dom.previewArea.innerHTML = '';
            isRealLocationActive = false;

            // IMPORTANT: Reset global moments state and FORCE refresh
            moments = [];
            myPrivateMoments = [];
            currentLastDoc = null;
            hasMore = true;
            isLoadingNextPage = false; // Force unlock guard

            if (dom.timeline) dom.timeline.innerHTML = '';

            await loadMoments();
            renderTimeline();
            renderMyRecentMoments();

            // Re-setup autoplay for the new card
            setupAutoplayObserver();

            // SUCCESS UX: Show auto-closing modal then reload to be 100% sure
            await showModal('Başarılı', 'Anınız kaydedildi! ✨', false, 2000);
            location.reload();
        } catch (refreshErr) {
            console.warn("Kayıt başarılı ancak arayüz yenilenirken hata oluştu:", refreshErr);
            // Even if silent error, reload is better
            location.reload();
        }
    } catch (e) {
        console.error("Genel Kaydetme Hatası:", e);
        showModal('Hata', 'Anı kaydedilemedi: ' + e.message);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalBtnText;
        }
    }
}

// --- Timeline Rendering ---
function renderTimeline(searchQuery = '') {
    if (!dom.timeline) return;

    let filteredMoments = moments;
    if (searchQuery) {
        filteredMoments = moments.filter(m =>
            m.text?.toLowerCase().includes(searchQuery) ||
            m.location?.toLowerCase().includes(searchQuery)
        );
    }

    if (filteredMoments.length === 0) {
        dom.timeline.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📝</div>
                <p>${currentView === 'explore' ? 'Henüz keşfedilecek anı yok' : 'Henüz anı yok. İlk anını oluştur!'}</p>
            </div>
        `;
        return;
    }

    // Full card view for all tabs
    dom.timeline.innerHTML = filteredMoments.map(m => {
        const date = new Date(m.createdAt);
        const formattedDate = date.toLocaleDateString('tr-TR', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
        const formattedTime = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const locationText = m.location ? ` • ${m.location}` : '';
        const currentUser = AuthService.currentUser();
        const isLiked = m.likes?.includes(currentUser?.uid);
        const isOwner = currentUser?.uid === m.userId;

        // Stickers Generator (Always Split: Time Left, Headline Right)
        const stickersHtml = `
            <div class="collage-stickers-overlay">
                <div class="mini-time-sticker collage-sticker">${formattedTime}</div>
                ${m.stickerText ? `<div class="mini-brush-sticker collage-sticker">${m.stickerText}</div>` : ''}
            </div>
        `;

        // Media Carousel Logic
        const images = m.media?.filter(med => med.type === 'image') || [];
        let mediaHtml = '';

        if (images.length > 0) {
            const totalSlides = images.length + 1;
            mediaHtml = `
                <div class="carousel-wrapper">
                    <div class="carousel-indicator hidden-fade"></div>
                    <div class="card-media-carousel" onscroll="window._handleCarouselScroll(this)">
                        <!-- Slide 1: Mini Collage (Interactive & Stickered & Music) -->
                        <div class="carousel-slide collage-slide">
                            ${generateMiniCollage(m.media)}
                            
                            <!-- Music Marquee inside Collage (Top) -->
                            ${m.musicText ? `
                                <div class="collage-music-wrapper">
                                    <div class="collage-music-marquee ${m.musicText.length > 25 ? 'has-scroll' : ''}">
                                        🎵 ${m.musicText} ${m.musicText.length > 25 ? `&nbsp;&nbsp;&nbsp;&nbsp; 🎵 ${m.musicText}` : ''}
                                    </div>
                                </div>
                            ` : ''}

                            ${stickersHtml}
                        </div>
            `;

            // Sequential Slides: Individual Photos
            images.forEach(img => {
                mediaHtml += `
                    <div class="carousel-slide">
                        <img src="${img.url || img.data}" alt="">
                    </div>
                `;
            });

            mediaHtml += `
                    </div>
                </div>`;
        }

        return `
            <div class="moment-card theme-${m.theme || 'default'}" data-id="${m.id}" onclick="window.handleCardClick(event, '${m.id}', '${m.musicUrl || ''}')">
                <!-- 1. Header (Kullanıcı Bilgisi) -->
                <div class="card-header">
                    <div class="user-info" onclick="openProfileView('${m.userId}')">
                        <div class="user-avatar">
                            ${(m.userPhotoURL?.startsWith('http') || m.userPhotoURL?.startsWith('data:')) ? `<img src="${m.userPhotoURL}">` : (m.userPhotoURL || '👤')}
                        </div>
                        <div class="user-details">
                            <span class="username">
                                ${m.userDisplayName || 'Anonim'}
                                ${m.isEarlyUser ? '<span class="early-user-badge">✓</span>' : ''}
                            </span>
                            <div class="meta-info">
                                <span class="date">${formattedDate}${locationText}</span>
                                ${m.verifiedLocation ? '<span class="verified-location-badge" title="Doğrulanmış Konum">📍✓</span>' : ''}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 2. Müzik Grubu (Artık Kolaj İçinde) -->

                <!-- 2 & 3 & 4. Stickers & Labels -->
                ${images.length === 0 ? `
                    <div class="text-moment-stickers-wrapper">
                        ${stickersHtml}
                    </div>
                ` : ''}

                ${m.voiceUrl && images.length === 0 ? `
                    <div class="card-labels-stack" style="margin-top: 10px;">
                        <button class="voice-play-btn" onclick="event.stopPropagation(); window.toggleVoiceMemo('${m.voiceUrl}', '${m.id}')" data-moment-id="${m.id}">
                            🎤 Sesli Not
                        </button>
                    </div>
                ` : ''}
                
                <!-- 5. Medya -->
                ${mediaHtml}
                
                ${m.text ? `<div class="card-content">${m.text}</div>` : ''}
                
                <div class="card-actions">
                    <button class="action-btn ${isLiked ? 'liked' : ''}" onclick="window.toggleLike('${m.id}')">
                        <span class="like-icon">${isLiked ? '❤️' : '🤍'}</span>
                        <span class="like-count">${m.likes?.length || 0}</span>
                    </button>
                    <button class="action-btn" onclick="window.toggleComments('${m.id}')">
                        💬 ${m.commentsCount || 0}
                    </button>
                    <div class="action-spacer"></div>
                    ${isOwner ? `
                        <button class="action-btn visibility-btn" onclick="window.toggleMomentVisibility('${m.id}', ${!m.isPublic})" title="${m.isPublic ? 'Gizle' : 'Herkese Aç'}">
                            ${m.isPublic ? '🌐' : '🔒'}
                        </button>
                        <button class="action-btn delete-btn" onclick="window.deleteMomentConfirm('${m.id}')" title="Sil">🗑️</button>
                    ` : ''}
                </div>
                
                <!-- Inline Comments Section -->
                <div class="inline-comments hidden" id="comments-${m.id}">
                    <div class="comments-list" id="commentsList-${m.id}"></div>
                    <div class="comment-input-row">
                        <input type="text" placeholder="Yorum yaz..." id="commentInput-${m.id}" onkeypress="if(event.key==='Enter') window.addComment('${m.id}')">
                        <button onclick="window.addComment('${m.id}')">Gönder</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// --- Render My Recent Moments (Compact List under input area) ---
function renderMyRecentMoments() {
    const list = document.getElementById('myMomentsList');
    if (!list) return;

    const currentUser = AuthService.currentUser();
    if (!currentUser) return;

    // Use the dedicated private moments cache
    const myMoments = myPrivateMoments.slice(0, 5);

    if (myMoments.length === 0) {
        list.innerHTML = '<div class="empty-compact">Henüz anı yok</div>';
        return;
    }

    list.innerHTML = myMoments.map(m => {
        const date = new Date(m.createdAt);
        const formattedDate = date.toLocaleDateString('tr-TR', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
        const formattedTime = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const firstImg = m.media?.find(med => med.type === 'image');
        const imgSrc = firstImg?.url || firstImg?.data || '';

        return `
            <div class="swipe-item-wrapper">
                <div class="swipe-action-delete" onclick="window.handleSwipeDelete('${m.id}')">
                    <span>Sil</span>
                </div>
                <div class="compact-moment-item">
                    <div class="compact-img-wrapper"
                         ontouchstart="window.handleSwipeStart(event)"
                         ontouchmove="window.handleSwipeMove(event)"
                         ontouchend="window.handleSwipeEnd(event)">
                        <div class="compact-thumb">
                            ${imgSrc ? `<img src="${imgSrc}">` : '<div class="no-thumb">📝</div>'}
                        </div>
                    </div>
                    <div class="compact-info">
                        <div class="compact-date">${formattedDate} • ${formattedTime}</div>
                        ${m.location ? `<div class="compact-location">📍 ${m.location}</div>` : ''}
                        ${m.text ? `<div class="compact-text">${m.text.substring(0, 60)}${m.text.length > 60 ? '...' : ''}</div>` : ''}
                    </div>
                    <div class="compact-stats">
                        <span>❤️ ${m.likes?.length || 0}</span>
                        <span>💬 ${m.commentsCount || 0}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// --- Swipe to Delete Handlers ---
let swipeStartX = 0;
let swipingElement = null;

window.handleSwipeStart = (e) => {
    swipeStartX = e.touches[0].clientX;
    swipingElement = e.currentTarget;
    swipingElement.style.transition = 'none';
};

window.handleSwipeMove = (e) => {
    if (!swipingElement) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - swipeStartX;
    if (diff < 0) { // Only swipe left
        const pull = Math.max(diff, -100);
        swipingElement.style.transform = `translateX(${pull}px)`;

        // Dynamic opacity for delete button
        const btn = swipingElement.parentElement.querySelector('.swipe-action-delete');
        if (btn) {
            btn.style.opacity = Math.min(Math.abs(diff) / 50, 1);
        }
    }
};

window.handleSwipeEnd = (e) => {
    if (!swipingElement) return;
    swipingElement.style.transition = '';
    const currentX = e.changedTouches[0].clientX;
    const diff = currentX - swipeStartX;
    const btn = swipingElement.parentElement.querySelector('.swipe-action-delete');

    if (diff < -50) {
        swipingElement.style.transform = 'translateX(-80px)';
        if (btn) btn.style.opacity = '1';
    } else {
        swipingElement.style.transform = 'translateX(0)';
        if (btn) btn.style.opacity = '0';
    }
    swipingElement = null;
};

window.handleSwipeDelete = async (id) => {
    if (confirm('Bu anıyı silmek istediğinizden emin misiniz?')) {
        try {
            await DBService.deleteMoment(id);
            // Update local state and re-render
            myPrivateMoments = myPrivateMoments.filter(m => m.id !== id);
            moments = moments.filter(m => m.id !== id);
            renderMyRecentMoments();
            // Also refresh main timeline if needed
            if (typeof loadMoments === 'function') {
                loadMoments().then(() => renderTimeline());
            }
        } catch (e) {
            console.error("Delete error:", e);
            alert("Silme işlemi sırasında hata oluştu.");
        }
    } else {
        // Reset all swipe positions
        document.querySelectorAll('.compact-moment-item').forEach(el => {
            el.style.transform = 'translateX(0)';
        });
    }
};

// --- Photo Input ---
function handlePhotoInput(e) {
    const files = Array.from(e.target.files);

    if (currentMedia.length + files.length > MAX_PHOTOS) {
        showModal('Limit Aşıldı', `En fazla ${MAX_PHOTOS} fotoğraf ekleyebilirsiniz.`);
        return;
    }

    // Show progress indicator
    let loaded = 0;
    const total = files.length;
    showUploadProgress(loaded, total);

    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => {
            currentMedia.push({ type: 'image', data: event.target.result });
            loaded++;
            showUploadProgress(loaded, total);

            if (loaded === total) {
                hideUploadProgress();
                renderMediaPreview();
            }
        };
        reader.readAsDataURL(file);
    });
}

function showUploadProgress(current, total) {
    let overlay = document.getElementById('uploadProgressOverlay');
    let popup = document.getElementById('uploadProgress');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'uploadProgressOverlay';
        overlay.className = 'upload-progress-backdrop';
        document.body.appendChild(overlay);
    }

    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'uploadProgress';
        popup.className = 'upload-progress';
        popup.innerHTML = '<h4>Fotoğraflar Yükleniyor...</h4><div class="progress-text"></div>';
        document.body.appendChild(popup);
    }

    overlay.classList.remove('hidden');
    popup.classList.remove('hidden');
    popup.querySelector('.progress-text').textContent = `${current}/${total}`;
}

function hideUploadProgress() {
    document.getElementById('uploadProgressOverlay')?.classList.add('hidden');
    document.getElementById('uploadProgress')?.classList.add('hidden');
}

function renderMediaPreview() {
    if (!dom.previewArea) return;

    dom.previewArea.innerHTML = currentMedia.map((m, i) => `
        <div class="preview-item">
            ${m.type === 'image' ? `<img src="${m.data}">` : `<audio src="${m.data}" controls></audio>`}
            <button class="remove-btn" onclick="removeMedia(${i})">×</button>
        </div>
    `).join('');
}

window.removeMedia = (index) => {
    currentMedia.splice(index, 1);
    renderMediaPreview();
};

// Delete moment confirmation
window.deleteMomentConfirm = async (momentId) => {
    const confirmed = await showModal('Silmek istediğinize emin misiniz?', 'Bu anı kalıcı olarak silinecek ve geri alınamaz.', true);
    if (confirmed) {
        try {
            await DBService.deleteMoment(momentId);
            // SUCCESS UX: Show auto-closing modal then reload
            await showModal('Silindi', 'Anı başarıyla silindi.', false, 2000);
            location.reload();
        } catch (e) {
            console.error('Delete error:', e);
            showModal('Hata', 'Anı silinemedi: ' + e.message);
        }
    }
};

// Toggle moment visibility (public/private)
window.toggleMomentVisibility = async (momentId, makePublic) => {
    try {
        await DBService.setMomentVisibility(momentId, makePublic);
        await loadMoments();
        renderTimeline();
        showModal('Güncellendi', makePublic ? 'Anı artık herkese açık.' : 'Anı gizlendi.');
    } catch (e) {
        console.error('Visibility error:', e);
        showModal('Hata', 'Görünürlük değiştirilemedi: ' + e.message);
    }
};

// --- Inline Comments ---
window.toggleComments = async (momentId) => {
    const section = document.getElementById(`comments-${momentId}`);
    if (!section) return;

    const isHidden = section.classList.contains('hidden');
    section.classList.toggle('hidden');

    if (isHidden) {
        await loadInlineComments(momentId);
    }
};

async function loadInlineComments(momentId) {
    const list = document.getElementById(`commentsList-${momentId}`);
    if (!list) return;

    list.innerHTML = '<div class="loading">Yükleniyor...</div>';

    try {
        const comments = await DBService.getComments(momentId);
        const currentUser = AuthService.currentUser();

        if (comments.length === 0) {
            list.innerHTML = '<div class="no-comments">Henüz yorum yok</div>';
            return;
        }

        list.innerHTML = comments.map(c => {
            const isOwner = currentUser?.uid === c.userId;
            const isLiked = c.likes?.includes(currentUser?.uid);
            const likeCount = c.likes?.length || 0;
            const date = new Date(c.createdAt).toLocaleDateString('tr-TR');
            return `
                <div class="comment-item">
                    <div class="comment-header">
                        <span class="comment-author">@${c.username || c.userDisplayName || c.userName || 'anonim'}</span>
                        <span class="comment-date">${date}</span>
                        ${isOwner ? `<button class="comment-delete" onclick="window.deleteComment('${momentId}', '${c.id}')">×</button>` : ''}
                    </div>
                    <div class="comment-text">${c.text}</div>
                    <div class="comment-actions">
                        <button class="comment-like ${isLiked ? 'liked' : ''}" onclick="window.toggleCommentLike('${momentId}', '${c.id}')">
                            ${isLiked ? '❤️' : '🤍'} ${likeCount > 0 ? likeCount : ''}
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        list.innerHTML = '<div class="error">Yorumlar yüklenemedi</div>';
    }
}

window.toggleCommentLike = async (momentId, commentId) => {
    try {
        await DBService.toggleCommentLike(momentId, commentId);
        await loadInlineComments(momentId);
    } catch (e) {
        console.error('Comment like error:', e);
    }
};

window.addComment = async (momentId) => {
    const input = document.getElementById(`commentInput-${momentId}`);
    if (!input || !input.value.trim()) return;

    const text = input.value.trim();
    input.value = '';

    try {
        await DBService.addComment(momentId, { text });
        // Update local state to show +1 comment immediately
        const m = moments.find(mom => mom.id === momentId);
        if (m) m.commentsCount = (m.commentsCount || 0) + 1;

        await loadInlineComments(momentId);
        // We don't necessarily need to reload everything, just render the counts
        renderTimeline();
    } catch (e) {
        showModal('Hata', 'Yorum eklenemedi: ' + e.message);
    }
};

window.deleteComment = async (momentId, commentId) => {
    try {
        await DBService.deleteComment(momentId, commentId);
        await loadInlineComments(momentId);
        await loadMoments();
        renderTimeline();
    } catch (e) {
        showModal('Hata', 'Yorum silinemedi: ' + e.message);
    }
};

// --- Location ---
function fetchLocation() {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            try {
                const { latitude, longitude } = pos.coords;
                const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=tr`);
                const data = await response.json();

                const address = data.address;
                // Format: İlçe, İl, Ülke
                const parts = [];
                if (address.town || address.village || address.suburb || address.district) {
                    parts.push(address.town || address.village || address.suburb || address.district);
                }
                if (address.province || address.city || address.state) {
                    parts.push(address.province || address.city || address.state);
                }
                if (address.country) {
                    parts.push(address.country);
                }
                currentLocation = parts.length > 0 ? parts.join(', ') : 'Bilinmeyen Konum';

                if (dom.locationStatus) {
                    dom.locationStatus.textContent = `📍 ${currentLocation}`;
                    dom.locationStatus.classList.remove('hidden');
                }

                // Keep the button active if we successfully got a location
                const btn = document.getElementById('addLocationBtn');
                btn?.classList.add('active');
            } catch (e) {
                console.error("Konum alınamadı:", e);
                isRealLocationActive = false;
                const btn = document.getElementById('addLocationBtn');
                btn?.classList.remove('active');
            }
        },
        (err) => {
            console.log("Konum izni verilmedi");
            isRealLocationActive = false;
            const btn = document.getElementById('addLocationBtn');
            btn?.classList.remove('active');
        }
    );
}

window.handleRealLocation = () => {
    // Check if the selected date is in the past
    const selectedDate = dom.momentDate?.value;
    const today = new Date().toISOString().split('T')[0];

    if (!isRealLocationActive && selectedDate && selectedDate < today) {
        if (dom.locationStatus) {
            dom.locationStatus.textContent = "📍 Önce tarihi bugüne getirin";
            dom.locationStatus.classList.remove('hidden');
            // Auto-hide error after 3 seconds
            setTimeout(() => {
                if (dom.locationStatus.textContent === "📍 Önce tarihi bugüne getirin") {
                    dom.locationStatus.classList.add('hidden');
                }
            }, 3000);
        }
        return;
    }

    isRealLocationActive = !isRealLocationActive;
    const btn = document.getElementById('addLocationBtn');

    if (isRealLocationActive) {
        btn?.classList.add('active');
        fetchLocation();
    } else {
        btn?.classList.remove('active');
        if (dom.locationStatus) dom.locationStatus.classList.add('hidden');
        currentLocation = '';
        if (dom.venueInput) dom.venueInput.value = '';
    }
};

// --- Profile View ---
async function openProfileView(uid) {
    const view = document.getElementById('profileView');
    const content = document.getElementById('profileContent');

    if (!view || !content) return;

    // Switch view first to show the container
    await window.setView('profile');

    content.innerHTML = '<div class="loading" style="padding: 40px; text-align: center;">Yükleniyor...</div>';
    document.body.style.overflow = '';
    window._currentProfileUid = uid;

    try {
        let userProfile = await DBService.getUserProfile(uid);

        // If profile doesn't exist, create a temporary object to avoid crashing
        if (!userProfile) {
            userProfile = {
                displayName: 'momentLog Gezgini',
                username: 'isimsiz',
                photoURL: '👤',
                bio: 'Profil bilgileri henüz oluşturulmamış.',
                followers: [],
                following: []
            };
        }

        const momentsRes = await DBService.getMomentsByUser(uid).catch(err => {
            console.warn("Moments fetch failed (likely missing index):", err);
            return { moments: [], lastVisible: null };
        });
        const momentsList = momentsRes.moments || [];
        const isOwnProfile = uid === AuthService.currentUser()?.uid;
        const isFollowing = userProfile.followers?.includes(AuthService.currentUser()?.uid);

        content.innerHTML = `
            <div class="profile-header-simple">
                <div class="profile-avatar-wrapper" onclick="window.viewFullSizePhoto('${userProfile.photoURL}')" style="cursor: pointer;">
                    ${(userProfile.photoURL?.startsWith('http') || userProfile.photoURL?.startsWith('data:')) ?
                `<img src="${userProfile.photoURL}" class="profile-avatar-large">` :
                `<div class="profile-avatar-emoji">${userProfile.photoURL || '👤'}</div>`}
                </div>
                <div class="profile-info-minimal">
                    <h2>${userProfile.displayName || 'İsimsiz'}</h2>
                    <p class="profile-username">@${userProfile.username || 'kullanici'}</p>
                    <p class="profile-bio">${userProfile.bio || ''}</p>
                </div>
            </div>

            <div class="profile-stats">
                <div class="stat-item">
                    <span class="stat-value">${momentsList.length}</span>
                    <span class="stat-label">Anı</span>
                </div>
                <div class="stat-item clickable" onclick="window.showFollowersList('${uid}', 'followers')">
                    <span class="stat-value">${userProfile.followers?.length || 0}</span>
                    <span class="stat-label">Takipçi</span>
                </div>
                <div class="stat-item clickable" onclick="window.showFollowersList('${uid}', 'following')">
                    <span class="stat-value">${userProfile.following?.length || 0}</span>
                    <span class="stat-label">Takip</span>
                </div>
            </div>

            <div class="profile-actions-row">
                ${!isOwnProfile ? `
                    <button id="followBtn" class="follow-btn-main ${isFollowing ? 'following' : ''} ${userProfile.pendingFollowers?.includes(AuthService.currentUser()?.uid) ? 'pending' : ''}">
                        ${isFollowing ? 'Takibi Bırak' : (userProfile.pendingFollowers?.includes(AuthService.currentUser()?.uid) ? 'İstek Gönderildi' : 'Takip Et')}
                    </button>
                ` : `
                    <div class="own-profile-tools">
                        <button onclick="window.openEditProfileModal()" class="profile-tool-btn" title="Profili Düzenle">✏️</button>
                        <button onclick="window.toggleProfilePrivacy(${userProfile.isPrivateProfile})" class="profile-tool-btn" title="${userProfile.isPrivateProfile ? 'Gizli' : 'Herkese Açık'}">
                            ${userProfile.isPrivateProfile ? '🔒' : '🌐'}
                        </button>
                        <div class="theme-icons-inline">
                            <button onclick="applyAppTheme('default'); openProfileView('${uid}');" class="theme-icon-btn ${currentAppTheme === 'default' ? 'active' : ''}" title="Koyu">🌙</button>
                            <button onclick="applyAppTheme('light'); openProfileView('${uid}');" class="theme-icon-btn ${currentAppTheme === 'light' ? 'active' : ''}" title="Açık">☀️</button>
                            <button onclick="applyAppTheme('vintage'); openProfileView('${uid}');" class="theme-icon-btn ${currentAppTheme === 'vintage' ? 'active' : ''}" title="Vintage">📜</button>
                        </div>
                        <button onclick="window.handleLogout()" class="profile-tool-btn danger" title="Çıkış Yap">📤</button>
                    </div>
                `}
            </div>

            <div class="profile-scroll-content">
                <div class="profile-tabs">
                    <button class="tab-btn active">Anılar</button>
                    <button class="tab-btn">Koleksiyonlar</button>
                </div>

                ${(isOwnProfile || !userProfile.isPrivateProfile || isFollowing) ? `
                    <div class="profile-moments-grid">
                        ${momentsList.length > 0 ? momentsList.map(m => {
                    const firstImg = m.media ? m.media.find(med => med.type === 'image') : null;
                    const imgSrc = firstImg?.url || firstImg?.data || '';
                    return '<div class="grid-item">' +
                        (imgSrc ? '<img src="' + imgSrc + '">' : '<div class="text-placeholder">📝</div>') +
                        '</div>';
                }).join('') : '<div class="no-moments-msg">Henüz anı yok</div>'}
                    </div>
                ` : `
                    <div class="private-profile-notice">
                        <div class="lock-icon-large">🔒</div>
                        <h3>Bu Hesap Gizli</h3>
                        <p>Fotoğrafları ve anıları görmek için bu hesabı takip etmelisin.</p>
                    </div>
                `}
            </div>
        `;

        // Follow button handler
        const followBtn = document.getElementById('followBtn');
        if (followBtn) {
            followBtn.onclick = () => window.handleFollowAction(uid);
        }

    } catch (e) {
        console.error("Profil yükleme hatası:", e);
        content.innerHTML = '<div class="error" style="padding: 40px; text-align: center;">Profil yüklenemedi</div>';
    }

    if (closeBtn) {
        closeBtn.onclick = () => {
            view.classList.add('hidden');
            document.body.style.overflow = '';
        };
    }
}

window.openProfileView = openProfileView;

// Profil fotoğrafını tam ekran gör
window.viewFullSizePhoto = (url) => {
    if (!url || (!url.startsWith('http') && !url.startsWith('data:'))) return;

    const viewer = document.createElement('div');
    viewer.className = 'full-size-photo-viewer';
    viewer.innerHTML = `
        <div class="photo-viewer-overlay">
            <button class="close-viewer">✕</button>
            <div class="photo-container">
                <img src="${url}">
            </div>
        </div>
    `;

    document.body.appendChild(viewer);
    document.body.style.overflow = 'hidden';

    const close = () => {
        viewer.classList.add('fade-out');
        setTimeout(() => {
            viewer.remove();
            document.body.style.overflow = '';
        }, 300);
    };

    viewer.querySelector('.photo-viewer-overlay').onclick = (e) => {
        if (e.target.tagName !== 'IMG') close();
    };
    viewer.querySelector('.close-viewer').onclick = close;
};

// --- Logout Handler ---
window.handleLogout = async () => {
    const confirmed = await showModal('Çıkış', 'Çıkış yapmak istediğinize emin misiniz?', true);
    if (confirmed) {
        try {
            await AuthService.signOut();
            const view = document.getElementById('profileView');
            if (view) {
                view.classList.add('hidden');
                document.body.style.overflow = '';
            }
            // Auth listener will handle showing login overlay
        } catch (e) {
            console.error('Logout error:', e);
            showModal('Hata', 'Çıkış yapılırken bir hata oluştu.');
        }
    }
};

// --- Follow System ---
window.handleFollowAction = async (targetUid) => {
    const currentUser = AuthService.currentUser();
    if (!currentUser) {
        showModal('Giriş Gerekli', 'Takip etmek için giriş yapmalısınız.');
        return;
    }

    const followBtn = document.getElementById('followBtn');
    if (!followBtn) return;

    followBtn.disabled = true;
    followBtn.innerText = 'İşleniyor...';

    try {
        await DBService.toggleFollow(targetUid);
    } catch (e) {
        console.error('Follow action error:', e);
        // Don't show error modal - action may have partially succeeded
    }
    // Always refresh profile to show current state
    await openProfileView(targetUid);
};

window.toggleProfilePrivacy = async (currentPrivacy) => {
    try {
        const currentUser = AuthService.currentUser();
        if (!currentUser) return;

        await DBService.updateUserProfile(currentUser.uid, {
            isPrivateProfile: !currentPrivacy
        });

        openProfileView(currentUser.uid);
    } catch (e) {
        showModal('Hata', 'Gizlilik ayarı güncellenemedi');
    }
};

// --- Followers List ---
window.showFollowersList = async (uid, type) => {
    try {
        const userProfile = await DBService.getUserProfile(uid);
        const userIds = type === 'followers' ? (userProfile.followers || []) : (userProfile.following || []);
        const title = type === 'followers' ? 'Takipçiler' : 'Takip Edilenler';

        if (userIds.length === 0) {
            showModal(title, type === 'followers' ? 'Henüz takipçi yok' : 'Henüz kimse takip edilmiyor');
            return;
        }

        const users = [];
        for (const userId of userIds) {
            try {
                const profile = await DBService.getUserProfile(userId);
                users.push({ uid: userId, ...profile });
            } catch (e) {
                users.push({ uid: userId, displayName: 'Bilinmiyor' });
            }
        }

        const modal = document.createElement('div');
        modal.className = 'follow-list-modal';
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

        modal.innerHTML = `
            <div class="follow-list-content">
                <div class="follow-list-header">
                    <h3>${title}</h3>
                    <button onclick="this.closest('.follow-list-modal').remove()" style="background:none; border:none; color:white; font-size:1.5rem; cursor:pointer;">×</button>
                </div>
                <div class="follow-list-body">
                    ${users.map(u => `
                        <div class="follow-user-item" onclick="this.closest('.follow-list-modal').remove(); openProfileView('${u.uid}')">
                            <div class="follow-user-avatar">
                                ${u.photoURL?.startsWith('http') ? `<img src="${u.photoURL}">` : '👤'}
                            </div>
                            <div class="follow-user-info">
                                <div class="follow-user-name">${u.displayName || 'Kullanıcı'}</div>
                                <div class="follow-user-username" style="font-size:0.8rem; color:var(--text-secondary);">@${u.username || u.uid.slice(0, 8)}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    } catch (e) {
        console.error('Error loading followers list:', e);
        showModal('Hata', 'Liste yüklenemedi');
    }
};

// --- Like System ---
window.toggleLike = async (id) => {
    const currentUser = AuthService.currentUser();
    if (!currentUser) {
        showModal('Giriş Gerekli', 'Beğenmek için giriş yapmalısınız.');
        return;
    }

    const card = document.querySelector(`.moment-card[data-id="${id}"]`);
    const likeBtn = card?.querySelector('.action-btn');
    const likeIcon = likeBtn?.querySelector('.like-icon');
    const likeCount = likeBtn?.querySelector('.like-count');

    if (!card) return;

    // Optimistic update
    const isCurrentlyLiked = likeBtn?.classList.contains('liked');
    const currentCount = parseInt(likeCount?.textContent || '0');

    if (isCurrentlyLiked) {
        likeBtn?.classList.remove('liked');
        if (likeIcon) likeIcon.textContent = '🤍';
        if (likeCount) likeCount.textContent = Math.max(0, currentCount - 1);
    } else {
        likeBtn?.classList.add('liked');
        if (likeIcon) likeIcon.textContent = '❤️';
        if (likeCount) likeCount.textContent = currentCount + 1;
    }

    try {
        await DBService.toggleLike(id);
    } catch (e) {
        // Revert on error - silently for permission errors
        if (isCurrentlyLiked) {
            likeBtn?.classList.add('liked');
            if (likeIcon) likeIcon.textContent = '❤️';
            if (likeCount) likeCount.textContent = currentCount;
        } else {
            likeBtn?.classList.remove('liked');
            if (likeIcon) likeIcon.textContent = '🤍';
            if (likeCount) likeCount.textContent = currentCount;
        }
        console.error('Like error:', e);
    }
};

// --- Comments ---
async function loadComments(momentId, expanded = false) {
    const commentsList = document.getElementById('commentsList');
    if (!commentsList) return;

    try {
        const comments = await DBService.getComments(momentId);
        const isImmersive = commentsList.classList.contains('comments-list-immersive');

        if (comments.length === 0) {
            commentsList.innerHTML = `<p class="no-comments" style="text-align:center; color:var(--text-secondary); padding:10px; font-size:0.8rem; margin:0;">Henüz yorum yok</p>`;
            return;
        }

        let displayComments = comments;
        let showMoreBtn = '';

        if (!expanded && comments.length > 3) {
            displayComments = comments.slice(0, 3);
            showMoreBtn = `<button class="show-more-comments" onclick="loadComments('${momentId}', true)">${comments.length - 3} yorum daha gör...</button>`;
        }

        commentsList.innerHTML = displayComments.map(c => `
            <div class="${isImmersive ? 'comment-item-immersive' : 'comment-item'}" ${!isImmersive ? 'style="padding: 10px; border-bottom: 1px solid var(--border-subtle);"' : ''}>
                <div class="${isImmersive ? 'comment-user-immersive' : 'comment-user-info'}" onclick="openProfileView('${c.userId}')" style="cursor:pointer;">
                    <span class="comment-username" style="font-weight:600;">${c.userDisplayName || 'Anonim'}</span>
                </div>
                <p class="${isImmersive ? 'comment-text-immersive' : 'comment-text'}" style="margin-top:2px;">${c.text}</p>
            </div>
        `).join('') + showMoreBtn;
    } catch (e) {
        console.error("Yorumlar yüklenemedi:", e);
    }
}

window.loadComments = loadComments;

window.submitComment = async (momentId) => {
    const input = document.getElementById('commentInput');
    const text = input?.value?.trim();

    if (!text) return;

    const currentUser = AuthService.currentUser();
    if (!currentUser) {
        showModal('Giriş Gerekli', 'Yorum yapmak için giriş yapmalısınız.');
        return;
    }

    try {
        await DBService.addComment(momentId, text);
        input.value = '';
        loadComments(momentId);
    } catch (e) {
        console.error('Yorum gönderilemedi:', e);
    }
};

// --- Notification System ---
function setupNotifications() {
    const currentUser = AuthService.currentUser();
    console.log('setupNotifications called, user:', currentUser?.uid);
    if (!currentUser) return;

    DBService.onNotifications(currentUser.uid, (notifications) => {

        const unreadCount = notifications.filter(n => !n.isRead).length;

        const badge = document.getElementById('notifBadge');
        const btn = document.getElementById('notificationsBtn');


        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        // Add/remove has-unread class for button color
        if (btn) {
            if (unreadCount > 0) {
                btn.classList.add('has-unread');

            } else {
                btn.classList.remove('has-unread');
            }
        }

        window._notifications = notifications;
    });
}

// Notification logic is now handled in setView('notifications')

function renderNotificationsInView(notifications) {
    const list = document.getElementById('notiContent');
    if (!list) return;

    if (!notifications || notifications.length === 0) {
        list.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-secondary);">Henüz bildirim yok</div>';
        return;
    }

    const clearAllBtn = `
        <div class="notif-clear-all">
            <button onclick="window.clearAllNotifications()" class="clear-all-btn">🗑️ Tümünü Temizle</button>
        </div>
    `;

    const notifItems = notifications.map(n => {
        const typeText = {
            'like': 'gönderini beğendi',
            'comment': 'yorum yaptı',
            'follow': 'seni takip etti',
            'follow_request': 'takip isteği gönderdi'
        };
        const avatar = n.senderPhoto?.startsWith('http') ? `<img src="${n.senderPhoto}">` : '👤';
        const unreadClass = n.isRead ? '' : 'unread';
        const timeAgo = getTimeAgo(n.createdAt);

        const actionButtons = n.type === 'follow_request' ? `
            <div class="notif-actions">
                <button class="notif-action-btn accept" onclick="window._approveFollowRequest('${n.id}', '${n.senderUid}')">Onayla</button>
                <button class="notif-action-btn decline" onclick="window._rejectFollowRequest('${n.id}', '${n.senderUid}')">Reddet</button>
            </div>
        ` : '';

        return `
            <div class="notification-item ${unreadClass} ${n.type}">
                <div class="notif-main" onclick="handleNotificationClick('${n.id}', '${n.momentId || ''}', '${n.senderUid}')">
                    <div class="notif-avatar">${avatar}</div>
                    <div class="notif-content">
                        <div class="notif-text"><strong>${n.senderName || 'Biri'}</strong> ${typeText[n.type] || 'etkileşimde bulundu'}</div>
                        <div class="notif-time">${timeAgo}</div>
                        ${actionButtons}
                    </div>
                </div>
                <button class="notif-delete-btn" onclick="window.deleteNotification('${n.id}')">×</button>
            </div>
        `;
    }).join('');

    list.innerHTML = clearAllBtn + notifItems;
}

window.deleteNotification = async (notifId) => {
    // Immediate UI update - remove from list
    window._notifications = (window._notifications || []).filter(n => n.id !== notifId);
    renderNotificationsInView(window._notifications);

    try {
        await DBService.deleteNotification(notifId);
    } catch (e) {
        console.error('Delete notification error:', e);
    }
};

window.clearAllNotifications = async () => {
    const currentUser = AuthService.currentUser();
    if (!currentUser) return;

    // Immediate UI update - empty list
    window._notifications = [];
    renderNotificationsInView([]);

    try {
        await DBService.clearAllNotifications(currentUser.uid);
    } catch (e) {
        console.error('Clear all notifications error:', e);
    }
};

function getTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return 'az önce';
    if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} saat önce`;
    return `${Math.floor(diff / 86400)} gün önce`;
}

window.handleNotificationClick = async (notifId, momentId, senderUid) => {
    // 1. Mark as read immediately for UX
    const notif = (window._notifications || []).find(n => n.id === notifId);
    if (notif) notif.isRead = true;
    renderNotificationsInView(window._notifications || []);
    DBService.markNotificationsAsRead(AuthService.currentUser()?.uid);

    if (momentId) {
        // Go to feed
        await setView('home');

        // Wait for rendering and scroll
        const scrollToId = () => {
            const el = document.querySelector(`.moment-card[data-id="${momentId}"]`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('moment-highlight');
                setTimeout(() => el.classList.remove('moment-highlight'), 3000);
                return true;
            }
            return false;
        };

        // Try immediate, then retry as loading happens
        if (!scrollToId()) {
            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                if (scrollToId() || attempts > 20) clearInterval(interval);
            }, 500);
        }
    } else if (senderUid) {
        openProfileView(senderUid);
    }
};

window.markAllNotificationsRead = async () => {
    const currentUser = AuthService.currentUser();
    if (!currentUser) return;
    try {
        await DBService.markNotificationsAsRead(currentUser.uid);
    } catch (e) {
        console.error('Mark read error:', e);
    }
};

window._approveFollowRequest = async (notifId, senderUid) => {
    try {
        await DBService.acceptFollowRequest(senderUid);
        await DBService.deleteNotification(notifId);
        // Refresh notifications list if open
        const currentUser = AuthService.currentUser();
        if (currentUser) {
            const listSnapshot = await db.collection('notifications')
                .where('targetUid', '==', currentUser.uid)
                .limit(50)
                .get();
            const notifications = listSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            notifications.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
            renderNotificationsInView(notifications);
        }
    } catch (e) {
        console.error('Approve follow request error:', e);
        showModal('Hata', 'İstek onaylanamadı');
    }
};

window._rejectFollowRequest = async (notifId, senderUid) => {
    try {
        await DBService.declineFollowRequest(senderUid);
        await DBService.deleteNotification(notifId);
        // Refresh notifications list if open
        const currentUser = AuthService.currentUser();
        if (currentUser) {
            const listSnapshot = await db.collection('notifications')
                .where('targetUid', '==', currentUser.uid)
                .limit(50)
                .get();
            const notifications = listSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            notifications.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
            renderNotificationsInView(notifications);
        }
    } catch (e) {
        console.error('Reject follow request error:', e);
        showModal('Hata', 'İstek reddedilemedi');
    }
};
window._handleCarouselScroll = (el) => {
    const scrollLeft = el.scrollLeft;
    const width = el.offsetWidth;
    const index = Math.round(scrollLeft / width);
    const container = el.parentElement;
    const indicator = container.querySelector('.carousel-indicator');
    if (indicator) {
        const slides = el.querySelectorAll('.carousel-slide');
        const totalPhotos = slides.length - 1; // Slide 1 is collage

        if (index === 0) {
            indicator.classList.add('hidden-fade');
        } else {
            indicator.textContent = `${index}/${totalPhotos}`;
            indicator.classList.remove('hidden-fade');

            // Reset hide timer
            if (el._indicatorTimer) clearTimeout(el._indicatorTimer);
            el._indicatorTimer = setTimeout(() => {
                indicator.classList.add('hidden-fade');
            }, 2000);
        }
    }
};

console.log("momentLog: Script loaded successfully v19");
