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
const MAX_PHOTOS = 5;

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

// --- Image Compression for Fallback ---
async function compressImage(dataUrl, quality = 0.5, maxWidth = 800) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
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
        img.onerror = () => resolve(null);
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
    // Update theme button to show selected
    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) themeBtn.title = `Tema: ${theme}`;
};


// --- Custom Modal Helper ---
function showModal(title, message, isConfirm = false) {
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

        const handleConfirm = () => { cleanup(); resolve(true); };
        const handleCancel = () => { cleanup(); resolve(false); };
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
    };
}

let isPublicState = false;
let currentView = 'my-moments';
let isRealLocationActive = false;
const APP_THEMES = ['default', 'light', 'vintage'];
let currentAppTheme = localStorage.getItem('appTheme') || 'light';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initializeSelectors();
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

        if (window.setView && currentView) {
            window.setView(currentView, true);
        } else {
            renderTimeline();
        }

        console.log("momentLog: UI Initialized Successfully v19");
    } catch (e) {
        console.error("Initialization Error:", e);
    }

    // Auth Listener
    AuthService.onAuthStateChanged(async (user) => {
        const loginOverlay = document.getElementById('loginOverlay');

        if (user) {
            console.log("Kullanıcı giriş yaptı:", user.displayName);
            if (loginOverlay) loginOverlay.classList.remove('active');

            if (user.photoURL && dom.profileBtn) {
                const img = dom.profileBtn.querySelector('img') || document.createElement('img');
                img.src = user.photoURL;
                if (!dom.profileBtn.querySelector('img')) {
                    dom.profileBtn.innerHTML = '';
                    dom.profileBtn.appendChild(img);
                }
                dom.profileBtn.classList.add('has-avatar');
            }

            if (dom.userNameSpan) {
                dom.userNameSpan.textContent = `Merhaba, ${user.displayName || 'Gezgin'}`;
            }

            await DBService.getUserProfile(user.uid);
            await loadMoments();
            renderTimeline();
            fetchLocation();
            setupNotifications();
        } else {
            console.log("Kullanıcı giriş yapmadı.");
            if (loginOverlay) loginOverlay.classList.add('active');
            moments = [];
            renderTimeline();
        }
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
            .then(reg => console.log('Service Worker Registered'))
            .catch(err => console.log('Service Worker Error:', err));
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

    window.setView = async (viewName, force = false) => {
        if (!force && currentView === viewName) return;

        currentView = viewName;
        localStorage.setItem('momentLog_lastView', currentView);

        const titleEl = document.querySelector('h1');

        if (currentView === 'explore') {
            exploreBtn?.classList.add('active');
            homeBtn?.classList.remove('active');
            headerAddBtn?.classList.remove('active');
            if (titleEl) titleEl.textContent = "Keşfet";
            inputSectionBase?.classList.add('hidden-mode');
            dashboardFooter?.classList.add('hidden-mode');
        } else if (currentView === 'write') {
            exploreBtn?.classList.remove('active');
            homeBtn?.classList.remove('active');
            headerAddBtn?.classList.add('active');
            if (titleEl) titleEl.textContent = "Anı Yaz";
            inputSectionBase?.classList.remove('hidden-mode');
            dashboardFooter?.classList.remove('hidden-mode');
        } else {
            exploreBtn?.classList.remove('active');
            homeBtn?.classList.add('active');
            headerAddBtn?.classList.remove('active');
            if (titleEl) titleEl.textContent = "Akış";
            inputSectionBase?.classList.add('hidden-mode');
            dashboardFooter?.classList.add('hidden-mode');
        }

        await loadMoments();
        renderTimeline();
    };

    if (homeBtn) homeBtn.onclick = () => window.setView('my-moments');
    if (exploreBtn) exploreBtn.onclick = () => window.setView('explore');
    if (headerAddBtn) headerAddBtn.onclick = () => window.setView('write');
    if (notificationsBtn) notificationsBtn.onclick = () => toggleNotificationPanel();

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
    try {
        let data;
        if (currentView === 'explore') {
            data = await DBService.getPublicMoments();
            console.log("Dünya akışı yüklendi:", data.length);
        } else if (currentView === 'write') {
            data = await DBService.getMyMoments();
            console.log("Kişisel anılar yüklendi:", data.length);
        } else {
            data = await DBService.getFollowingMoments();
            console.log("Takip akışı yüklendi:", data.length);
        }
        moments = data || [];
    } catch (e) {
        console.error("Veri yükleme hatası:", e);
        moments = [];
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
                        const compressedData = await compressImage(m.data, 0.5, 800);
                        if (compressedData) {
                            uploadedMedia.push({ type: m.type || 'image', url: compressedData });
                        }
                    }
                } catch (uploadErr) {
                    console.error('Media upload error:', uploadErr);
                    // Fallback on error too
                    try {
                        const compressedData = await compressImage(m.data, 0.5, 800);
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

        console.log('Uploaded media count:', uploadedMedia.length);

        // Ensure location is a simple string
        const locationString = typeof currentLocation === 'string' ? currentLocation :
            (currentLocation?.text || currentLocation?.name || null);

        const momentData = {
            text: String(text || ''),
            media: uploadedMedia, // Use URLs from Firebase Storage
            location: locationString,
            theme: String(currentMomentTheme || 'minimal'),
            mood: String(currentMood || '😊'),
            userId: String(currentUser.uid),
            userDisplayName: String(userProfile?.username || userProfile?.displayName || currentUser.displayName || 'Anonim'),
            userPhotoURL: String(userProfile?.photoURL || currentUser.photoURL || '👤'),
            isPublic: Boolean(isPublicState),
            likes: [],
            commentsCount: 0,
            createdAt: dateInput ? new Date(dateInput).toISOString() : new Date().toISOString()
        };

        if (isRealLocationActive && locationString) {
            momentData.verifiedLocation = true;
        }

        await DBService.createMoment(momentData);

        // Reset form
        if (dom.input) dom.input.value = '';
        currentMedia = [];
        if (dom.previewArea) dom.previewArea.innerHTML = '';
        isRealLocationActive = false;

        await loadMoments();
        renderTimeline();

        showModal('Başarılı', 'Anınız kaydedildi! ✨');
    } catch (e) {
        console.error("Kaydetme hatası:", e);
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

    dom.timeline.innerHTML = filteredMoments.map(m => {
        const date = new Date(m.createdAt);
        const formattedDate = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
        const firstImg = m.media?.find(med => med.type === 'image');
        const imgSrc = firstImg?.url || firstImg?.data || '';
        const currentUser = AuthService.currentUser();
        const isLiked = m.likes?.includes(currentUser?.uid);
        const isOwner = currentUser?.uid === m.userId;

        return `
            <div class="moment-card" data-id="${m.id}">
                <div class="card-header">
                    <div class="user-info" onclick="openProfileView('${m.userId}')">
                        <div class="user-avatar">
                            ${m.userPhotoURL?.startsWith('http') ? `<img src="${m.userPhotoURL}">` : (m.userPhotoURL || '👤')}
                        </div>
                        <div class="user-details">
                            <span class="username">${m.userDisplayName || 'Anonim'}</span>
                            ${m.verifiedLocation ? '<span class="verified-badge">✓</span>' : ''}
                            <span class="date">${formattedDate}</span>
                        </div>
                    </div>
                </div>
                
                ${imgSrc ? `<div class="card-media" onclick="openImmersiveViewById('${m.id}')"><img src="${imgSrc}" alt=""></div>` : ''}
                
                ${m.text ? `<div class="card-content" onclick="openImmersiveViewById('${m.id}')">${m.text.substring(0, 150)}${m.text.length > 150 ? '...' : ''}</div>` : ''}
                
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
            await loadMoments();
            renderTimeline();
            showModal('Silindi', 'Anı başarıyla silindi.');
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
                        <span class="comment-author">${c.userDisplayName || c.userName || 'Anonim'}</span>
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
        await loadInlineComments(momentId);
        await loadMoments();
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
                const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
                const data = await response.json();

                const address = data.address;
                currentLocation = address.neighbourhood || address.suburb || address.city || 'Bilinmeyen Konum';

                if (dom.locationStatus) {
                    dom.locationStatus.textContent = `📍 ${currentLocation}`;
                    dom.locationStatus.classList.remove('hidden');
                }
            } catch (e) {
                console.error("Konum alınamadı:", e);
            }
        },
        (err) => console.log("Konum izni verilmedi")
    );
}

window.handleRealLocation = () => {
    isRealLocationActive = !isRealLocationActive;
    const btn = document.getElementById('addLocationBtn');
    if (btn) {
        btn.classList.toggle('active', isRealLocationActive);
    }
    if (isRealLocationActive) {
        fetchLocation();
    }
};

// --- Profile View ---
async function openProfileView(uid) {
    const view = document.getElementById('profileView');
    const content = document.getElementById('profileContent');
    const closeBtn = document.getElementById('closeProfile');

    if (!view || !content) return;

    content.innerHTML = '<div class="loading" style="padding: 40px; text-align: center;">Yükleniyor...</div>';
    view.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    window._currentProfileUid = uid;

    try {
        const userProfile = await DBService.getUserProfile(uid);
        const userMoments = await DBService.getMomentsByUser(uid);
        const isOwnProfile = uid === AuthService.currentUser()?.uid;
        const isFollowing = userProfile.followers?.includes(AuthService.currentUser()?.uid);

        content.innerHTML = `
            <div class="profile-header-simple">
                <div class="profile-avatar-wrapper">
                    ${userProfile.photoURL?.startsWith('http') ?
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
                    <span class="stat-value">${userMoments.length}</span>
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
                    <button id="followBtn" class="follow-btn-main ${isFollowing ? 'following' : ''}">
                        ${isFollowing ? 'Takibi Bırak' : 'Takip Et'}
                    </button>
                ` : `
                    <div class="own-profile-tools">
                        <button onclick="window.toggleProfilePrivacy(${userProfile.isPrivateProfile})" class="profile-tool-btn">
                            ${userProfile.isPrivateProfile ? '🔒' : '🌐'}
                        </button>
                        <div class="theme-icons-inline">
                            <button onclick="applyAppTheme('default'); openProfileView('${uid}');" class="theme-icon-btn ${currentAppTheme === 'default' ? 'active' : ''}" title="Koyu">🌙</button>
                            <button onclick="applyAppTheme('light'); openProfileView('${uid}');" class="theme-icon-btn ${currentAppTheme === 'light' ? 'active' : ''}" title="Açık">☀️</button>
                            <button onclick="applyAppTheme('vintage'); openProfileView('${uid}');" class="theme-icon-btn ${currentAppTheme === 'vintage' ? 'active' : ''}" title="Vintage">📜</button>
                        </div>
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
                        ${userMoments.map(m => {
                    const firstImg = m.media ? m.media.find(med => med.type === 'image') : null;
                    const imgSrc = firstImg?.url || firstImg?.data || '';
                    return '<div class="grid-item" onclick="openImmersiveViewById(\'' + m.id + '\')">' +
                        (imgSrc ? '<img src="' + imgSrc + '">' : '<div class="text-placeholder">📝</div>') +
                        '</div>';
                }).join('')}
                    </div>
                ` : `
                    <div class="private-profile-message">
                        <div class="private-icon">🔒</div>
                        <h3>Gizli Profil</h3>
                        <p>Bu kullanıcının paylaşımlarını görmek için takip edin.</p>
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

// --- Immersive View ---
window.openImmersiveViewById = async (momentId) => {
    const moment = moments.find(m => m.id === momentId);
    if (!moment) {
        try {
            const fetchedMoment = await DBService.getMomentById(momentId);
            if (fetchedMoment) {
                openImmersiveView(fetchedMoment);
            }
        } catch (e) {
            console.error("Moment bulunamadı:", e);
        }
        return;
    }
    openImmersiveView(moment);
};

function openImmersiveView(moment) {
    const view = dom.immersiveView;
    if (!view) return;

    const date = new Date(moment.createdAt);
    const formattedDate = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

    view.innerHTML = `
        <div class="immersive-header">
            <button id="closeImmersive" class="close-btn">×</button>
            <div class="moment-meta">
                <span class="username">${moment.userDisplayName || 'Anonim'}</span>
                <span class="date">${formattedDate}</span>
            </div>
        </div>
        <div class="immersive-content">
            ${moment.media?.filter(m => m.type === 'image').map(m => `<img src="${m.data}" class="immersive-img">`).join('') || ''}
            <div class="immersive-text">${moment.text || ''}</div>
            ${moment.location ? `<div class="immersive-location">📍 ${moment.location}</div>` : ''}
        </div>
        <div class="immersive-actions">
            <div class="comments-section">
                <div id="commentsList" class="comments-list"></div>
                <div class="comment-input-row">
                    <input type="text" id="commentInput" placeholder="Yorum yaz...">
                    <button onclick="window.submitComment('${moment.id}')">Gönder</button>
                </div>
            </div>
        </div>
    `;

    view.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    document.getElementById('closeImmersive').onclick = () => {
        view.classList.add('hidden');
        document.body.style.overflow = '';
    };

    loadComments(moment.id);
}

// --- Comments ---
async function loadComments(momentId) {
    const commentsList = document.getElementById('commentsList');
    if (!commentsList) return;

    try {
        const comments = await DBService.getComments(momentId);

        if (comments.length === 0) {
            commentsList.innerHTML = '<p class="no-comments" style="text-align:center; color:var(--text-secondary); padding:20px;">Henüz yorum yok</p>';
            return;
        }

        commentsList.innerHTML = comments.map(c => `
            <div class="comment-item" style="padding: 10px; border-bottom: 1px solid var(--border-subtle);">
                <div class="comment-user-info" onclick="openProfileView('${c.userId}')" style="cursor:pointer;">
                    <span class="comment-username" style="font-weight:600;">${c.userDisplayName || 'Anonim'}</span>
                </div>
                <p class="comment-text" style="margin-top:4px;">${c.text}</p>
            </div>
        `).join('');
    } catch (e) {
        console.error("Yorumlar yüklenemedi:", e);
    }
}

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

function toggleNotificationPanel() {
    const view = document.getElementById('notiView');
    const closeBtn = document.getElementById('closeNoti');

    if (view) {
        view.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        renderNotificationsInView(window._notifications || []);

        // Mark all as read when panel opens
        const currentUser = AuthService.currentUser();
        if (currentUser) {
            DBService.markNotificationsAsRead(currentUser.uid);
        }

        if (closeBtn) {
            closeBtn.onclick = () => {
                view.classList.add('hidden');
                document.body.style.overflow = '';
            };
        }
    }
}

function renderNotificationsInView(notifications) {
    const list = document.getElementById('notiContent');
    if (!list) return;

    if (!notifications || notifications.length === 0) {
        list.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-secondary);">Henüz bildirim yok</div>';
        return;
    }

    list.innerHTML = notifications.map(n => {
        const typeText = {
            'like': 'gönderini beğendi',
            'comment': 'yorum yaptı',
            'follow': 'seni takip etti',
            'follow_request': 'takip isteği gönderdi'
        };
        const avatar = n.senderPhoto?.startsWith('http') ? `<img src="${n.senderPhoto}">` : '👤';
        const unreadClass = n.isRead ? '' : 'unread';
        const timeAgo = getTimeAgo(n.createdAt);

        return `
            <div class="notification-item ${unreadClass}" onclick="handleNotificationClick('${n.id}', '${n.momentId || ''}', '${n.senderUid}')">
                <div class="notif-avatar">${avatar}</div>
                <div class="notif-content">
                    <div class="notif-text"><strong>${n.senderName || 'Biri'}</strong> ${typeText[n.type] || 'etkileşimde bulundu'}</div>
                    <div class="notif-time">${timeAgo}</div>
                </div>
            </div>
        `;
    }).join('');
}

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
    const view = document.getElementById('notiView');
    if (view) view.classList.add('hidden');
    document.body.style.overflow = '';

    if (momentId) {
        window.openImmersiveViewById(momentId);
    } else if (senderUid) {
        openProfileView(senderUid);
    }
};

window.markAllNotificationsRead = async () => {
    const currentUser = AuthService.currentUser();
    if (currentUser) {
        await DBService.markNotificationsAsRead(currentUser.uid);
    }
};

console.log("momentLog: Script loaded successfully v19");
