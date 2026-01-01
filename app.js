/**
 * momentLog - Complete Application Logic
 * Gold Theme Edition - Rebuilt
 */

// --- Global Error Monitor ---
window.onerror = function (msg, url, line) {
    console.error("Error: " + msg + " at line " + line);
    return false;
};

console.log("momentLog: Script loading...");

// --- Constants & State ---
const STORAGE_KEY = 'momentLog_data_v2';
const MAX_PHOTOS = 10;

let moments = [];
let currentMedia = [];
let currentLocation = null;
let backgroundAudio = null;
let currentMomentTheme = 'minimal';
let currentMood = '😊';
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
    console.log("momentLog: DOM Loaded");

    if (dom.momentDate) {
        dom.momentDate.valueAsDate = new Date();
    }

    const savedView = localStorage.getItem('momentLog_lastView');
    if (savedView) {
        currentView = savedView;
    }

    try {
        setupEventListeners();
        applyAppTheme(currentAppTheme);

        if (window.setView && currentView) {
            window.setView(currentView, true);
        } else {
            renderTimeline();
        }

        console.log("momentLog: UI Initialized Successfully");
    } catch (e) {
        console.error("Initialization Error:", e);
    }

    // Auth Listener
    AuthService.onAuthStateChanged(async (user) => {
        const loginOverlay = document.getElementById('loginOverlay');

        if (user) {
            console.log("Kullanıcı giriş yaptı:", user.displayName);
            loginOverlay.classList.remove('active');

            if (user.photoURL && dom.profileBtn) {
                const img = dom.profileBtn.querySelector('img') || document.createElement('img');
                img.src = user.photoURL;
                if (!dom.profileBtn.querySelector('img')) dom.profileBtn.appendChild(img);
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
            loginOverlay.classList.add('active');
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

        if (currentView === 'explore') {
            exploreBtn?.classList.add('active');
            homeBtn?.classList.remove('active');
            document.querySelector('h1').textContent = "Keşfet";
            inputSectionBase?.classList.add('hidden-mode');
            dashboardFooter?.classList.add('hidden-mode');
        } else if (currentView === 'write') {
            exploreBtn?.classList.remove('active');
            homeBtn?.classList.remove('active');
            document.querySelector('h1').textContent = "Anı Yaz";
            inputSectionBase?.classList.remove('hidden-mode');
            dashboardFooter?.classList.remove('hidden-mode');
        } else {
            exploreBtn?.classList.remove('active');
            homeBtn?.classList.add('active');
            document.querySelector('h1').textContent = "Akış";
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
}

window.openAppThemePicker = () => {
    const themes = [
        { id: 'default', name: 'Koyu', icon: '🌙' },
        { id: 'light', name: 'Açık', icon: '☀️' },
        { id: 'vintage', name: 'Vintage', icon: '📜' }
    ];

    const modal = document.createElement('div');
    modal.className = 'follow-list-modal';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.innerHTML = `
        <div class="follow-list-content" style="max-width: 300px;">
            <div class="follow-list-header">
                <h3>🎨 Tema Seç</h3>
                <button onclick="this.closest('.follow-list-modal').remove()" style="font-size: 1.2rem;">×</button>
            </div>
            <div class="follow-list-body" style="padding: 16px;">
                ${themes.map(t => `
                    <button class="profile-tool-btn" style="width: 100%; margin-bottom: 8px; justify-content: center; ${currentAppTheme === t.id ? 'background: var(--accent); color: white;' : ''}" 
                            onclick="currentAppTheme = '${t.id}'; localStorage.setItem('appTheme', '${t.id}'); applyAppTheme('${t.id}'); this.closest('.follow-list-modal').remove();">
                        ${t.icon} ${t.name}
                    </button>
                `).join('')}
            </div>
        </div>
    `;

    document.body.appendChild(modal);
};

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

        const momentData = {
            text: text || '',
            media: currentMedia,
            location: currentLocation,
            theme: currentMomentTheme,
            mood: currentMood,
            userId: currentUser.uid,
            userDisplayName: userProfile?.username || userProfile?.displayName || currentUser.displayName || 'Anonim',
            userPhotoURL: userProfile?.photoURL || currentUser.photoURL || '👤',
            isPublic: isPublicState,
            likes: [],
            commentsCount: 0,
            createdAt: dateInput ? new Date(dateInput).toISOString() : new Date().toISOString()
        };

        if (isRealLocationActive && currentLocation) {
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
        const currentUser = AuthService.currentUser();
        const isLiked = m.likes?.includes(currentUser?.uid);

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
                
                ${firstImg ? `<div class="card-media" onclick="openImmersiveViewById('${m.id}')"><img src="${firstImg.data}" alt=""></div>` : ''}
                
                ${m.text ? `<div class="card-content" onclick="openImmersiveViewById('${m.id}')">${m.text.substring(0, 150)}${m.text.length > 150 ? '...' : ''}</div>` : ''}
                
                <div class="card-actions">
                    <button class="action-btn ${isLiked ? 'liked' : ''}" onclick="window.toggleLike('${m.id}')">
                        <span class="like-icon">${isLiked ? '❤️' : '🤍'}</span>
                        <span class="like-count">${m.likes?.length || 0}</span>
                    </button>
                    <button class="action-btn" onclick="openImmersiveViewById('${m.id}')">
                        💬 ${m.commentsCount || 0}
                    </button>
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

    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => {
            currentMedia.push({ type: 'image', data: event.target.result });
            renderMediaPreview();
        };
        reader.readAsDataURL(file);
    });
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

    content.innerHTML = '<div class="loading">Yükleniyor...</div>';
    view.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    window._currentProfileUid = uid;

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
                    <p class="profile-bio">${userProfile.bio || 'Henüz bir biyografi eklenmedi.'}</p>
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
                ${uid !== AuthService.currentUser()?.uid ? `
                    <button id="followBtn" class="follow-btn-main ${userProfile.followers?.includes(AuthService.currentUser()?.uid) ? 'following' : ''}">
                        ${userProfile.followers?.includes(AuthService.currentUser()?.uid) ? 'Takibi Bırak' :
                    (userProfile.pendingFollowers?.includes(AuthService.currentUser()?.uid) ? 'İstek Gönderildi' : 'Takip Et')}
                    </button>
                ` : `
                    <div class="own-profile-tools">
                        <button onclick="window.toggleProfilePrivacy(${userProfile.isPrivateProfile})" class="profile-tool-btn">
                            ${userProfile.isPrivateProfile ? '🔒' : '🌐'}
                        </button>
                        <div class="theme-icons-inline">
                            <button onclick="currentAppTheme='default'; localStorage.setItem('appTheme','default'); applyAppTheme('default'); openProfileView('${uid}');" class="theme-icon-btn ${currentAppTheme === 'default' ? 'active' : ''}" title="Koyu">🌙</button>
                            <button onclick="currentAppTheme='light'; localStorage.setItem('appTheme','light'); applyAppTheme('light'); openProfileView('${uid}');" class="theme-icon-btn ${currentAppTheme === 'light' ? 'active' : ''}" title="Açık">☀️</button>
                            <button onclick="currentAppTheme='vintage'; localStorage.setItem('appTheme','vintage'); applyAppTheme('vintage'); openProfileView('${uid}');" class="theme-icon-btn ${currentAppTheme === 'vintage' ? 'active' : ''}" title="Vintage">📜</button>
                        </div>
                    </div>
                `}
            </div>

            <div class="profile-scroll-content">
                <div class="profile-tabs">
                    <button class="tab-btn active">Anılar</button>
                    <button class="tab-btn">Koleksiyonlar</button>
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
            </div>
        `;

        // Follow button handler
        const followBtn = document.getElementById('followBtn');
        if (followBtn) {
            followBtn.onclick = () => window.handleFollowAction(uid);
        }

    } catch (e) {
        console.error("Profil yükleme hatası:", e);
        content.innerHTML = '<div class="error">Profil yüklenemedi</div>';
    }

    closeBtn.onclick = () => {
        view.classList.add('hidden');
        document.body.style.overflow = '';
    };
}

// --- Follow System ---
window.handleFollowAction = async (targetUid) => {
    const currentUser = AuthService.currentUser();
    if (!currentUser) {
        showModal('Giriş Gerekli', 'Takip etmek için giriş yapmalısınız.');
        return;
    }

    const followBtn = document.getElementById('followBtn');
    if (!followBtn) return;

    const originalText = followBtn.innerText;
    const originalClass = followBtn.className;
    followBtn.disabled = true;
    followBtn.innerText = 'İşleniyor...';

    try {
        await DBService.toggleFollow(targetUid);
        openProfileView(targetUid);
    } catch (e) {
        followBtn.innerText = originalText;
        followBtn.className = originalClass;
        followBtn.disabled = false;
        console.error('Follow action error:', e);
    }
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
                    <button onclick="this.closest('.follow-list-modal').remove()" style="font-size: 1.2rem;">×</button>
                </div>
                <div class="follow-list-body">
                    ${users.map(u => `
                        <div class="follow-user-item" onclick="this.closest('.follow-list-modal').remove(); openProfileView('${u.uid}')">
                            <div class="follow-user-avatar">
                                ${u.photoURL?.startsWith('http') ? `<img src="${u.photoURL}">` : '👤'}
                            </div>
                            <div class="follow-user-info">
                                <div class="follow-user-name">${u.displayName || 'Kullanıcı'}</div>
                                <div class="follow-user-username">@${u.username || u.uid.slice(0, 8)}</div>
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
        // Revert on error
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
            commentsList.innerHTML = '<p class="no-comments">Henüz yorum yok</p>';
            return;
        }

        commentsList.innerHTML = comments.map(c => `
            <div class="comment-item">
                <div class="comment-user-info" onclick="openProfileView('${c.userId}')">
                    <span class="comment-username">${c.userDisplayName || 'Anonim'}</span>
                </div>
                <p class="comment-text">${c.text}</p>
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

    // Create notification panel
    if (!document.getElementById('notificationPanel')) {
        const panel = document.createElement('div');
        panel.id = 'notificationPanel';
        panel.className = 'notification-panel';
        panel.innerHTML = `
            <div class="notification-header">
                <h3>Bildirimler</h3>
                <button onclick="markAllNotificationsRead()" style="font-size: 0.8rem; opacity: 0.7;">Tümünü oku</button>
            </div>
            <div class="notification-list" id="notificationList"></div>
        `;
        document.body.appendChild(panel);
    }

    DBService.onNotifications(currentUser.uid, (notifications) => {
        const unreadCount = notifications.filter(n => !n.isRead).length;
        const badge = document.getElementById('notifBadge');
        const notifBtn = document.getElementById('notificationsBtn');

        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        // Gold highlight for bell when has notifications
        if (notifBtn) {
            if (unreadCount > 0) {
                notifBtn.classList.add('has-notifications');
            } else {
                notifBtn.classList.remove('has-notifications');
            }
        }

        window._notifications = notifications;
        renderNotificationsInView(notifications);
    });
}


function renderNotificationsInView(notifications) {
    const list = document.getElementById('notiContent');
    if (!list) return;

    if (!notifications || notifications.length === 0) {
        list.innerHTML = '<div class="notification-empty" style="padding: 40px; text-align: center; color: var(--text-secondary);">Henüz bildirim yok</div>';
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

function toggleNotificationPanel() {
    const view = document.getElementById('notiView');
    const closeBtn = document.getElementById('closeNoti');

    if (view) {
        view.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        // Render notifications in the view
        renderNotificationsInView(window._notifications || []);

        if (closeBtn) {
            closeBtn.onclick = () => {
                view.classList.add('hidden');
                document.body.style.overflow = '';
            };
        }
    }
}

function closeNotifOnOutsideClick(e) {
    const panel = document.getElementById('notificationPanel');
    const btn = document.getElementById('notificationsBtn');
    if (panel && !panel.contains(e.target) && !btn?.contains(e.target)) {
        panel.classList.remove('active');
        document.removeEventListener('click', closeNotifOnOutsideClick);
    }
}

window.handleNotificationClick = async (notifId, momentId, senderUid) => {
    const panel = document.getElementById('notificationPanel');
    panel?.classList.remove('active');

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

// --- Avatar Picker ---
window.showAvatarPicker = () => {
    const picker = document.getElementById('avatarPicker');
    if (picker) picker.classList.toggle('hidden');
};

window.updateAvatar = async (emoji) => {
    const currentUser = AuthService.currentUser();
    if (!currentUser) return;

    try {
        await DBService.updateUserProfile(currentUser.uid, { photoURL: emoji });
        openProfileView(currentUser.uid);
    } catch (e) {
        showModal('Hata', 'Avatar güncellenemedi');
    }
};

window.handleProfilePhotoUpload = async (input) => {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const currentUser = AuthService.currentUser();
        if (!currentUser) return;

        try {
            await DBService.updateUserProfile(currentUser.uid, { photoURL: e.target.result });
            openProfileView(currentUser.uid);
        } catch (err) {
            showModal('Hata', 'Fotoğraf yüklenemedi');
        }
    };
    reader.readAsDataURL(file);
};

// --- Name Change ---
window.promptDisplayNameChange = async () => {
    const newName = prompt('Yeni görünen adınızı girin:');
    if (!newName || newName.trim() === '') return;

    const currentUser = AuthService.currentUser();
    if (!currentUser) return;

    try {
        await DBService.updateUserProfile(currentUser.uid, { displayName: newName.trim() });
        openProfileView(currentUser.uid);
    } catch (e) {
        showModal('Hata', 'İsim güncellenemedi');
    }
};

window.promptNicknameChange = async () => {
    const newUsername = prompt('Yeni kullanıcı adınızı girin (@username):');
    if (!newUsername || newUsername.trim() === '') return;

    const currentUser = AuthService.currentUser();
    if (!currentUser) return;

    try {
        await DBService.updateUserProfile(currentUser.uid, { username: newUsername.trim().toLowerCase() });
        openProfileView(currentUser.uid);
    } catch (e) {
        showModal('Hata', 'Kullanıcı adı güncellenemedi');
    }
};

console.log("momentLog: Script loaded successfully");
