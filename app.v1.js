// --- Global Helpers ---
function escapeHTML(str) {
    if (!str) return "";
    const p = document.createElement("p");
    p.textContent = str;
    return p.innerHTML;
}

window.onerror = function (msg, url, line) {
    console.error("Error: " + msg + " at line " + line);
    return false;
};

// --- Shadow Persistence Check (Removed for Simplicity) ---
// We will rely on Firebase's fast local persistence check instead
// const hasShadowSession = localStorage.getItem('momentLog_hasSession');
// if (hasShadowSession === 'true') { ... }

// --- Constants & State ---
const STORAGE_KEY = 'momentLog_data_v2';

let moments = [];
let currentMedia = [];
let currentLocation = null;
let backgroundAudio = null;
let currentMomentTheme = 'minimal';
let currentMood = '😊';
let isDictating = false;
let mediaRecorder = null;
let audioChunks = [];
const MAX_AUDIO_SECONDS = 24;
let myPrivateMoments = []; // Separate cache for own moments to ensure individual visibility
let currentLastDoc = null; // Pagination: track last visible document
let hasMore = true; // Pagination: flag if more data exists
let isLoadingNextPage = false; // Pagination: prevent multiple simultaneous loads
let currentCollection = null; // Selected collection for new moment
let currentUserProfile = null; // Cache user profile for premium checks

// Dynamic photo limit based on premium status
function getMaxPhotos() {
    if (currentUserProfile?.isVerified || currentUserProfile?.isEarlyUser) {
        return 7; // Premium users
    }
    return 3; // Regular users
}

// --- Image Compression for Fallback (WebP 2K Ready) ---
async function compressImage(dataUrl, quality = 0.65, maxWidth = 1080) {
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
            // High quality smoothing for professional results
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            // WebP provides much better quality/size ratio than JPEG
            const compressedData = canvas.toDataURL('image/webp', quality);
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
function generateMiniCollage(media, verticalOffset = 50) {
    console.log(`[Collage] Rendering with vCenter: ${verticalOffset}%`);
    const images = media.filter(m => m.type === 'image').slice(0, 7);
    if (images.length === 0) return '';

    let html = `<div class="mini-collage count-${images.length}">`;
    images.forEach((img, idx) => {
        // Increased rotation range for a more natural "scattered" look
        const rotation = (idx % 2 === 0 ? 1 : -1) * (Math.random() * 12 + 4);

        // Centered positioning - using a responsive bounded area
        let top = verticalOffset, left = 50;
        let extraTransform = 'translate(-50%, -50%)';

        if (images.length === 1) {
            top = verticalOffset;
            left = 50;
        } else if (images.length === 2) {
            const offset = 14;
            const positions = [
                { t: verticalOffset - offset, l: 50 - (offset * 0.8) },
                { t: verticalOffset + (offset * 0.9), l: 50 + offset }
            ];
            top = positions[idx].t;
            left = positions[idx].l;
        } else if (images.length === 3) {
            // Asymmetric Triangle
            const positions = [
                { t: verticalOffset - 16, l: 50 + 5 },
                { t: verticalOffset + 12, l: 35 },
                { t: verticalOffset + 15, l: 65 }
            ];
            top = positions[idx].t;
            left = positions[idx].l;
        } else if (images.length === 4) {
            // Scattered Quadrant
            const positions = [
                { t: verticalOffset - 18, l: 50 - 15 },
                { t: verticalOffset - 12, l: 50 + 12 },
                { t: verticalOffset + 15, l: 50 - 10 },
                { t: verticalOffset + 10, l: 50 + 18 }
            ];
            top = positions[idx].t;
            left = positions[idx].l;
        } else {
            // Random-ish Spread for 5+ images
            const diff = verticalOffset - 50;
            const seed = (idx * 137) % 100; // Deterministic pseudo-randomness
            const positions = [
                { t: 35 + diff, l: 38 },
                { t: 40 + diff, l: 65 },
                { t: 65 + diff, l: 32 },
                { t: 68 + diff, l: 68 },
                { t: 52 + diff, l: 48 },
                { t: 48 + diff, l: 55 },
                { t: 50 + diff, l: 50 }
            ];
            top = positions[idx % positions.length].t;
            left = positions[idx % positions.length].l;
        }

        const transformStyle = `${extraTransform} rotate(${rotation}deg)`;

        html += `
            <div class="mini-img-wrapper" 
                 style="transform: ${transformStyle}; top: ${top}%; left: ${left}%; z-index: ${idx + 1};"
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

        let isVerifiedNow = false;

        if (username && username !== originalUsername.toLowerCase()) {
            isVerifiedNow = await DBService.changeUsername(currentUser.uid, username);
        } else {
            // Force fetch latest profile to see if user is verified
            const currentProfile = await DBService.getUserProfile(currentUser.uid);

            // Check if user is eligible for verification even without username change
            isVerifiedNow = currentProfile?.isVerified || false;

            if (!isVerifiedNow) {
                const isGoogleUser = currentUser.providerData.some(p => p.providerId === 'google.com');
                const verifiedSnap = await db.collection('users').where('isVerified', '==', true).get();
                // ONLY granted if user is Google user and less than 20 verified users exist
                if (isGoogleUser && verifiedSnap.size < 20) {
                    isVerifiedNow = true;
                    // Update the flag on user profile
                    await DBService.updateUserProfile(currentUser.uid, { isVerified: true });
                }
            } else {
                // IMPORTANT: If they were already verified, ENSURE it stays true
                isVerifiedNow = true;
            }
        }

        if (photoURL) {
            updateData.photoURL = photoURL;
        }

        // Always sync the verification status to all moments
        updateData.isVerified = isVerifiedNow;

        await DBService.updateUserProfile(currentUser.uid, updateData);

        // Update Firebase Auth profile
        try {
            const authUpdate = { displayName: updateData.displayName };
            if (updateData.photoURL) {
                authUpdate.photoURL = updateData.photoURL;
            }
            await AuthService.updateProfile(authUpdate);
        } catch (authError) {
            console.warn("Auth profile update failed:", authError);
        }

        // Sync ALL moments with new profile data and VERIFIED status
        await DBService.syncUserMoments(currentUser.uid, updateData);

        // Success: Close and refresh
        window.closeEditProfileModal();
        await showModal('Başarılı', 'Profilin güncellendi! ✨', false, 1500);
        location.reload();
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

// --- Collection Management ---
window.openCollectionModal = async () => {
    const modal = document.getElementById('collectionModal');
    const list = document.getElementById('collectionList');

    if (!modal || !list) return;

    const currentUser = AuthService.currentUser();
    if (!currentUser) return;

    try {
        const collections = await DBService.getJournals(currentUser.uid);

        if (collections.length === 0) {
            list.innerHTML = '<div class="no-collections">Henüz koleksiyon yok. Yeni bir tane oluştur!</div>';
        } else {
            list.innerHTML = collections.map(col => `
                <div class="collection-item ${currentCollection?.id === col.id ? 'selected' : ''}" 
                     onclick="window.selectCollection('${col.id}', '${escapeHTML(col.coverEmoji || '📁')}', '${escapeHTML(col.title)}')">
                    <span class="collection-emoji">${col.coverEmoji || '📁'}</span>
                    <span class="collection-title">${escapeHTML(col.title)}</span>
                    ${currentCollection?.id === col.id ? '<span class="selected-badge">✓</span>' : ''}
                </div>
            `).join('');
        }

        modal.classList.remove('hidden');
    } catch (e) {
        console.error('Collection load error:', e);
        showModal('Hata', 'Koleksiyonlar yüklenemedi.');
    }
};

window.closeCollectionModal = () => {
    const modal = document.getElementById('collectionModal');
    if (modal) modal.classList.add('hidden');
};

window.selectCollection = (id, emoji, title) => {
    currentCollection = { id, emoji, title };
    const btn = document.getElementById('collectionBtn');
    if (btn) {
        btn.innerHTML = emoji;
        btn.classList.add('active');
        btn.title = `Koleksiyon: ${title}`;
    }
    window.closeCollectionModal();
};

window.showCreateCollectionModal = () => {
    window.closeCollectionModal();
    const modal = document.getElementById('createCollectionModal');
    if (modal) {
        document.getElementById('collectionEmoji').value = '📁';
        document.getElementById('collectionTitle').value = '';
        modal.classList.remove('hidden');
    }
};

window.closeCreateCollectionModal = () => {
    const modal = document.getElementById('createCollectionModal');
    if (modal) modal.classList.add('hidden');
};

window.saveNewCollection = async () => {
    const emoji = document.getElementById('collectionEmoji').value.trim() || '📁';
    const title = document.getElementById('collectionTitle').value.trim();

    if (!title) {
        showModal('Hata', 'Lütfen koleksiyon başlığı girin.');
        return;
    }

    try {
        const docRef = await DBService.createJournal(title, emoji);
        await showModal('Başarılı', 'Koleksiyon oluşturuldu!', false, 1500);
        window.closeCreateCollectionModal();

        // Auto-select the new collection
        window.selectCollection(docRef.id, emoji, title);
    } catch (e) {
        console.error('Collection creation error:', e);
        showModal('Hata', 'Koleksiyon oluşturulamadı: ' + e.message);
    }
};

// --- Edit Moment (Premium Feature) ---
window.openEditMomentModal = async (momentId) => {
    const moment = moments.find(m => m.id === momentId);
    if (!moment) return;

    // Verify premium status
    const currentUser = AuthService.currentUser();
    if (!currentUser) return;

    const profile = await DBService.getUserProfile(currentUser.uid);
    if (!profile.isVerified && !profile.isEarlyUser) {
        showModal('Premium Özellik', 'Anı düzenleme sadece premium üyeler içindir.');
        return;
    }

    // Check 5-minute window
    const timeDiff = Date.now() - new Date(moment.createdAt).getTime();
    if (timeDiff > 5 * 60 * 1000) {
        showModal('Süre Doldu', 'Anılar sadece ilk 5 dakika içinde düzenlenebilir.');
        return;
    }

    // Pre-fill modal
    document.getElementById('editMomentText').value = moment.text || '';
    document.getElementById('editStickerText').value = moment.stickerText || '';
    document.getElementById('editMusicText').value = moment.musicText || '';
    document.getElementById('editMusicUrl').value = moment.musicUrl || '';

    // Set theme
    window.currentEditTheme = moment.theme || 'minimal';
    const themeDisplay = document.getElementById('editThemeDisplay');
    if (themeDisplay) {
        const themeNames = {
            'minimal': 'Minimal',
            'vintage': 'Vintage',
            'polaroid': 'Polaroid',
            'album': 'Albüm',
            'diary': 'Günlük',
            'travel': 'Seyahat',
            'love': 'Aşk',
            'nature': 'Doğa',
            'party': 'Parti',
            'art': 'Sanat'
        };
        themeDisplay.textContent = themeNames[window.currentEditTheme] || 'Minimal';
    }

    // Store moment ID for save
    window.editingMomentId = momentId;

    // Show modal
    document.getElementById('editMomentModal').classList.remove('hidden');
};

window.closeEditMomentModal = () => {
    document.getElementById('editMomentModal').classList.add('hidden');
    window.editingMomentId = null;
    window.currentEditTheme = null;
};

window.saveEditedMoment = async () => {
    const momentId = window.editingMomentId;
    if (!momentId) return;

    const updates = {
        text: document.getElementById('editMomentText').value.trim(),
        stickerText: document.getElementById('editStickerText').value.trim() || null,
        musicText: document.getElementById('editMusicText').value.trim() || null,
        musicUrl: document.getElementById('editMusicUrl').value.trim() || null,
        theme: window.currentEditTheme || 'minimal'
    };

    try {
        await DBService.updateMoment(momentId, updates);
        await showModal('Başarılı', 'Anı güncellendi!', false, 1500);
        window.closeEditMomentModal();

        // Refresh timeline
        await loadMoments();
        renderTimeline();
    } catch (e) {
        console.error('Edit error:', e);
        showModal('Hata', e.message);
    }
};

window.openThemeSelectorForEdit = () => {
    // Temporarily store that we're in edit mode
    window.isEditingTheme = true;
    window.openThemeSelector();
};

// Override selectTheme to handle edit mode
const originalSelectTheme = window.selectTheme;
window.selectTheme = (theme) => {
    if (window.isEditingTheme) {
        window.currentEditTheme = theme;
        const themeDisplay = document.getElementById('editThemeDisplay');
        if (themeDisplay) {
            const themeNames = {
                'minimal': 'Minimal',
                'vintage': 'Vintage',
                'polaroid': 'Polaroid',
                'album': 'Albüm',
                'diary': 'Günlük',
                'travel': 'Seyahat',
                'love': 'Aşk',
                'nature': 'Doğa',
                'party': 'Parti',
                'art': 'Sanat'
            };
            themeDisplay.textContent = themeNames[theme] || 'Minimal';
        }
        document.getElementById('themePicker').classList.add('hidden');
        window.isEditingTheme = false;
    } else {
        originalSelectTheme(theme);
    }
};

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

// --- Legal & Terms Modal ---
window.showLegalModal = () => {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.id = 'legalModal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.9); backdrop-filter: blur(15px);
            display: flex; align-items: center; justify-content: center;
            z-index: 10000; padding: 20px; animation: viewerIn 0.3s ease;
        `;

        modal.innerHTML = `
            <div style="background: var(--bg-surface); border: 1px solid var(--border-subtle); 
                        border-radius: 24px; padding: 30px; max-width: 500px; width: 100%;
                        box-shadow: 0 30px 60px rgba(0,0,0,0.5);">
                <h2 style="font-family: var(--font-heading); margin-bottom: 20px; color: var(--accent);">
                    📜 Kullanım Koşulları & KVKK
                </h2>
                <div style="font-size: 0.95rem; line-height: 1.6; color: var(--text-primary); margin-bottom: 25px; 
                            max-height: 300px; overflow-y: auto; padding-right: 10px;">
                    <p style="margin-bottom: 15px;">momentLog sosyal paylaşım platformuna hoş geldiniz. Paylaşım yapmadan önce lütfen aşağıdaki maddeleri dikkatle okuyunuz:</p>
                    
                    <p style="margin-bottom: 10px;"><strong>1. İçerik Sorumluluğu:</strong> Uygulama üzerinden paylaştığınız tüm metin, fotoğraf, konum ve ses kayıtlarından tamamen siz sorumlusunuz.</p>
                    
                    <p style="margin-bottom: 10px;"><strong>2. Kötü Niyetli Paylaşım:</strong> Yasalara aykırı, telif hakkı ihlali içeren veya topluluk huzurunu bozan paylaşımlar yasaktır. Bu durumlarda momentLog sorumluluk kabul etmez ve gerekli yaptırımları uygulama hakkını saklı tutar.</p>
                    
                    <p style="margin-bottom: 10px;"><strong>3. KVKK ve Gizlilik:</strong> Paylaştığınız verilerin platform altyapısında saklanmasına ve tercih ettiğiniz gizlilik ayarlarıyla yayınlanmasına izin veriyorsunuz.</p>
                    
                    <p style="margin-top: 20px; font-style: italic; color: var(--text-secondary); font-size: 0.85rem;">
                        *Onayla ve Devam Et butonuna basarak yukarıdaki koşulları ve sorumlulukları kabul etmiş sayılırsınız.
                    </p>
                </div>
                <div style="display: flex; gap: 15px;">
                    <button id="legalCancel" class="secondary-btn" style="flex: 1; padding: 12px; border-radius: 14px;">Vazgeç</button>
                    <button id="legalAccept" class="primary-btn" style="flex: 2; padding: 12px; border-radius: 14px; justify-content: center;">Onayla ve Devam Et</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const handleAccept = () => {
            modal.remove();
            resolve(true);
        };
        const handleCancel = () => {
            modal.remove();
            resolve(false);
        };

        modal.querySelector('#legalAccept').onclick = handleAccept;
        modal.querySelector('#legalCancel').onclick = handleCancel;
    });
};

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
        exploreSearchWrapper: document.getElementById('exploreSearchWrapper'),
        exploreSearchInput: document.getElementById('exploreSearchInput'),
        clearSearchBtn: document.getElementById('clearSearchBtn'),
        addLocationBtn: document.getElementById('addLocationBtn'),
    };
}

let currentVisibility = 'private'; // 'public' | 'friends' | 'private'
let currentView = 'my-moments';
let isRealLocationActive = false;
const APP_THEMES = ['default', 'light', 'vintage'];
let currentAppTheme = localStorage.getItem('appTheme') || 'light';

// --- Music URL Helpers ---
function getSpotifyTrackId(url) {
    if (!url) return null;
    const match = url.match(/track\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
}

async function getDeezerPreview(query) {
    try {
        const response = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`);
        const data = await response.json();
        return data.data?.[0]?.preview || null;
    } catch (e) {
        console.warn('[MusicManager] Deezer fallback failed:', e);
        return null;
    }
}

const MusicManager = {
    audio: new Audio(),
    currentMomentId: null,
    isPlaying: false,
    fadeInterval: null,
    originalVolume: 0.8,
    cycleTimeouts: [],
    isDucked: false,
    voicePlayedThisActivation: false,

    async play(url, momentId, skipFade = false, isManual = false, voiceUrl = null) {
        // Autoplay priming
        if (isManual) {
            console.log('[MusicManager] Manual interaction detected, priming audio');
            this.audio.play().then(() => {
                console.log('[MusicManager] Music audio primed');
                this.audio.pause();
            }).catch((err) => { console.warn('[MusicManager] Music priming failed:', err); });
            if (voiceUrl) {
                VoicePlayer.audio.src = voiceUrl; // Set src before priming!
                VoicePlayer.audio.volume = 0; // Silent prime
                VoicePlayer.audio.play().then(() => {
                    console.log('[MusicManager] Voice audio primed');
                    VoicePlayer.audio.pause();
                    VoicePlayer.audio.volume = 1.0; // Reset volume
                    VoicePlayer.audio.currentTime = 0;
                }).catch((err) => { console.warn('[MusicManager] Voice priming failed:', err); });
            }
        }

        if (!url && !voiceUrl) {
            this.stop(true);
            return;
        }

        // Toggle logic: If same moment, pause/resume
        if (this.currentMomentId === momentId && this.isPlaying) {
            console.log('[MusicManager] Same moment clicked while playing, stopping');
            this.stop(true);
            return;
        }

        console.log('[MusicManager] Starting new playback for moment:', momentId);
        this.stop(true);
        this.currentMomentId = momentId;
        this.voicePlayedThisActivation = false; // Reset for new card
        this.isAutoplayAllowed = isManual || this.isAutoplayAllowed;

        const runCycle = async () => {
            if (this.currentMomentId !== momentId) return;

            // Ensure no voice is left playing from previous cycle
            VoicePlayer.stop();

            // RESET state for each loop
            this.isDucked = false;

            // 1. Music Start with Fade-in
            if (url) {
                let playableUrl = url;

                // Spotify & Deezer Logic
                // Spotify & Deezer Logic
                if (url.includes('spotify.com') || !url.startsWith('http')) {
                    const moment = moments.find(m => m.id === momentId);

                    // 1. Try existing metadata
                    let query = (moment && moment.musicText && moment.musicText !== 'Bir şarkı seç...')
                        ? moment.musicText
                        : (moment?.spotifyTitle || "");

                    // 2. If NO text, try to fetch from Spotify oEmbed (Magic Fix for Old Links)
                    if (!query && url.includes('spotify.com')) {
                        console.log('[MusicManager] No musicText, fetching from Spotify oEmbed...');
                        // Show a temporary loading toast if possible, or just log
                        try {
                            // Using a format that doesn't trigger CORS issues if possible, or using a proxy?
                            // Spotify oEmbed usually headers allow. Let's try direct.
                            const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
                            const res = await fetch(oembedUrl);
                            const data = await res.json();
                            if (data.title) {
                                query = data.title; // "Artist - Title" usually
                                console.log('[MusicManager] Resolved from oEmbed:', query);

                                // Optionally save this back to DB/Local to avoid re-fetching? 
                                // For now, just play.
                            }
                        } catch (e) {
                            console.warn('[MusicManager] oEmbed fetch failed:', e);
                        }
                    }

                    if (query) {
                        console.log('[MusicManager] Searching Deezer for:', query);
                        const fallbackUrl = await getDeezerPreview(query);
                        if (fallbackUrl) {
                            playableUrl = fallbackUrl;
                        } else {
                            console.warn('[MusicManager] No preview found for:', query);
                            playableUrl = null;
                        }
                    } else {
                        playableUrl = null;
                    }
                }

                if (playableUrl) {
                    console.log('[MusicManager] Attempting to play:', playableUrl);
                    this.audio.src = playableUrl;
                    this.audio.crossOrigin = "anonymous";
                    this.audio.loop = false;
                    this.audio.volume = 0;
                    this.audio.load();

                    this.audio.onerror = async (e) => {
                        console.error('[MusicManager] Audio error:', playableUrl);
                        // If primary failed, we stop music part essentially
                    };

                    try {
                        await this.audio.play();
                        this.isPlaying = true;
                        this.fadeIn(1500);
                        console.log('[MusicManager] Playback started successfully');
                    } catch (e) {
                        console.error("[MusicManager] Play failed:", e.message);
                        this.isPlaying = false;
                    }
                } else {
                    console.warn('[MusicManager] No playable URL resolved.');
                    this.isPlaying = false;
                }
            } else {
                console.warn('[MusicManager] No music URL provided');
                this.isPlaying = false;
            }

            // 2. 3s Delay -> Voice Start + Ducking (ONLY if not played yet in THIS ACTIVATION)
            this.cycleTimeouts.push(setTimeout(() => {
                if (this.currentMomentId !== momentId) return;

                if (voiceUrl && !this.voicePlayedThisActivation) {
                    this.voicePlayedThisActivation = true;
                    VoicePlayer.play(voiceUrl, momentId);
                    if (this.isPlaying) {
                        this.duck(0.40);
                    }
                }
            }, 3000));

            // 3. 28s Mark -> Fade-out
            this.cycleTimeouts.push(setTimeout(() => {
                if (this.currentMomentId !== momentId) return;
                this.fadeOut(2000, false); // Fade out over 2s but don't stop yet
            }, 28000));

            // 4. 30s Mark -> Restart Cycle
            this.cycleTimeouts.push(setTimeout(() => {
                if (this.currentMomentId !== momentId) return;
                runCycle();
            }, 30000));
        };

        runCycle();
        this.updateUI();
    },

    fadeIn(duration = 1000) {
        clearInterval(this.fadeInterval);
        const target = this.isDucked ? 0.25 : this.originalVolume;
        const step = target / (duration / 50);
        this.fadeInterval = setInterval(() => {
            if (this.audio.volume + step >= target) {
                this.audio.volume = target;
                clearInterval(this.fadeInterval);
            } else {
                this.audio.volume += step;
            }
        }, 50);
    },

    fadeOut(duration = 1000, stopAfter = true) {
        clearInterval(this.fadeInterval);
        const startVol = this.audio.volume;
        const step = startVol / (duration / 50);
        this.fadeInterval = setInterval(() => {
            if (this.audio.volume - step <= 0) {
                this.audio.volume = 0;
                clearInterval(this.fadeInterval);
                if (stopAfter) this.audio.pause();
            } else {
                this.audio.volume -= step;
            }
        }, 50);
    },

    duck(vol) {
        this.isDucked = true;
        this.audio.volume = vol;
    },

    restore() {
        this.isDucked = false;
        if (this.isPlaying) {
            this.audio.volume = this.originalVolume;
        }
    },

    stop(immediate = false) {
        this.cycleTimeouts.forEach(t => clearTimeout(t));
        this.cycleTimeouts = [];
        clearInterval(this.fadeInterval);
        this.audio.pause();
        this.audio.currentTime = 0;
        this.isPlaying = false;
        this.isDucked = false;
        VoicePlayer.stop();
        this.updateUI();
    },

    updateUI() {
        document.querySelectorAll('.music-toggle-btn').forEach(btn => {
            const card = btn.closest('.moment-card');
            const mid = card ? card.dataset.id : btn.dataset.momentId;
            if (mid === this.currentMomentId && (this.isPlaying || VoicePlayer.isPlaying)) {
                btn.innerHTML = '⏸️';
                btn.classList.add('playing');
            } else {
                btn.innerHTML = '▶️';
                btn.classList.remove('playing');
            }
        });
    }
};

document.addEventListener('visibilitychange', () => {
    if (document.hidden && (MusicManager.isPlaying || VoicePlayer.isPlaying)) {
        MusicManager.stop(true);
    }
});

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
            // Initial suggestion from Spotify
            let spotifyTitle = data.title.replace(' | Spotify', '');
            const author = data.author_name || '';
            const songName = spotifyTitle.replace(`${author} - `, '').replace(` - ${author}`, '').replace(' - song by ', '');

            if (author) {
                spotifyTitle = `${author} - ${songName}`;
            } else {
                spotifyTitle = songName;
            }

            // 2. Search Deezer for the 30s preview and precise naming
            const searchTerms = spotifyTitle.split(' - ');
            const query = searchTerms.length > 1 ? `${searchTerms[0]} ${searchTerms[1]}` : spotifyTitle;

            return new Promise((resolve) => {
                const callbackName = 'deezerCallback_' + Math.floor(Math.random() * 1000000);
                window[callbackName] = (res) => {
                    delete window[callbackName];
                    const s = document.getElementById(callbackName);
                    if (s) s.remove();

                    if (res.data && res.data.length > 0) {
                        const track = res.data[0];
                        // Prefer Deezer for the visual label (cleaner format) - NOW: Artist - Title
                        const finalLabel = `${track.artist.name} - ${track.title}`;
                        resolve({
                            title: finalLabel,
                            previewUrl: track.preview
                        });
                    } else {
                        // Fallback to Spotify's refined title
                        resolve({ title: spotifyTitle, previewUrl: null });
                    }
                };
                const script = document.createElement('script');
                script.id = callbackName;
                script.src = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1&output=jsonp&callback=${callbackName}`;
                document.body.appendChild(script);
                // Timeout after 5s
                setTimeout(() => { if (window[callbackName]) resolve({ title: spotifyTitle, previewUrl: null }); }, 5000);
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
    recordingInterval: null,
    recordedBlob: null,
    seconds: 0,
    maxSeconds: 24,
    isProcessing: false,

    async start() {
        if (this.isProcessing || this.isRecording) return;
        this.isProcessing = true;
        this.updateUI();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream, {
                audioBitsPerSecond: 24000 // 24kbps for voice efficiency
            });
            this.audioChunks = [];
            this.seconds = this.maxSeconds; // Start from max

            this.mediaRecorder.ondataavailable = (event) => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                this.isRecording = false;
                this.stopTimer();
                this.updateUI();
                this.tempBlob = blob;
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.startTimer();
            if (MusicManager.isPlaying) {
                MusicManager.duck(0.40);
            }
            this.updateUI();

        } catch (err) {
            console.error("Mikrofon erişim hatası:", err);
            this.isRecording = false;
            this.stopTimer();
            await showModal("Hata", "Mikrofona erişilemedi. Lütfen izinleri kontrol edin.");
        } finally {
            this.isProcessing = false;
            this.updateUI();
        }
    },

    startTimer() {
        const timerDom = document.getElementById('recordingTimer');
        if (timerDom) {
            timerDom.classList.remove('hidden');
            this.updateTimerUI(); // Initial display
        }

        this.recordingInterval = setInterval(() => {
            this.seconds--; // Countdown
            this.updateTimerUI();
            if (this.seconds <= 0) {
                this.stop(true); // Auto stop
            }
        }, 1000);
    },

    stopTimer() {
        clearInterval(this.recordingInterval);
        const timerDom = document.getElementById('recordingTimer');
        if (timerDom) timerDom.classList.add('hidden');
    },

    updateTimerUI() {
        const timerDom = document.getElementById('recordingTimer');
        if (timerDom) {
            timerDom.textContent = this.seconds;
        }
    },

    async stop(auto = false) {
        if (this.isProcessing) return;
        if (!this.mediaRecorder || !this.isRecording) return;
        this.isProcessing = true;
        this.updateUI();

        try {
            if (!auto) {
                const confirmed = await showModal("Ses Kaydı", "Ses kaydını tamamlayıp anıya eklemek istiyor musunuz?", true);
                if (!confirmed) {
                    // Cancel recording
                    if (this.mediaRecorder.state !== 'inactive') {
                        this.mediaRecorder.onstop = null; // Ignore current stop data
                        this.mediaRecorder.stop();
                    }
                    if (this.mediaRecorder.stream) {
                        this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
                    }

                    this.isRecording = false;
                    this.stopTimer();
                    if (MusicManager.isPlaying) {
                        MusicManager.restore();
                    }
                    this.audioChunks = [];
                    this.recordedBlob = null;
                    this.tempBlob = null;
                    return; // finally will handle updateUI and isProcessing
                }
            }

            // Normal completion
            if (this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            if (this.mediaRecorder.stream) {
                this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            }

            // Wait for onstop to finish (using promise approach for cleaner flow)
            await new Promise(resolve => {
                const timer = setTimeout(resolve, 1000); // Safety timeout
                const originalOnStop = this.mediaRecorder.onstop;
                this.mediaRecorder.onstop = () => {
                    clearTimeout(timer);
                    if (originalOnStop) originalOnStop();
                    this.recordedBlob = this.tempBlob;
                    resolve();
                };
                if (this.mediaRecorder.state === 'inactive') {
                    clearTimeout(timer);
                    this.recordedBlob = this.tempBlob;
                    resolve();
                }
            });

            if (MusicManager.isPlaying) {
                MusicManager.restore();
            }
            showModal("Tamam", "Ses kaydı hazır.");
        } catch (err) {
            console.error("VoiceRecorder error:", err);
            this.isRecording = false;
            this.stopTimer();
        } finally {
            this.isProcessing = false;
            this.updateUI();
        }
    },

    async toggle() {
        if (this.isRecording) {
            await this.stop();
        } else if (this.recordedBlob) {
            const confirmed = await showModal("Kaydı Sil", "Mevcut ses kaydını silmek istiyor musunuz?", true);
            if (confirmed) {
                this.recordedBlob = null;
                this.audioChunks = [];
                this.updateUI();
            }
        } else if (!this.isProcessing) {
            await this.start();
        }
    },

    updateUI() {
        const btn = document.getElementById('recordBtn');
        if (btn) {
            btn.classList.toggle('recording', this.isRecording);
            btn.classList.toggle('processing', this.isProcessing);
            btn.disabled = this.isProcessing;
            btn.classList.toggle('active', !!this.recordedBlob);

            if (this.isRecording) {
                btn.innerHTML = '⏹️';
            } else {
                btn.innerHTML = this.recordedBlob ? '✅' : '🎤';
            }
        }
    }
};

window.toggleMusic = (url, momentId, voiceUrl) => {
    MusicManager.play(url, momentId, false, true, voiceUrl); // Mark as manual interaction
};

window.toggleVoiceMemo = (url, momentId) => {
    VoicePlayer.play(url, momentId, true);
};

window.handleCardClick = (e, momentId, musicUrl, voiceUrl) => {
    // Prevent triggering if clicking on buttons, interactive elements, or collage photos
    const interactiveTags = ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'LABEL'];
    if (interactiveTags.includes(e.target.tagName) || e.target.closest('.user-info') || e.target.closest('.card-actions') || e.target.closest('.mini-img-wrapper')) {
        return;
    }

    if (musicUrl || voiceUrl) {
        window.toggleMusic(musicUrl, momentId, voiceUrl);
    }
};

// --- Voice Memo Playback ---
const VoicePlayer = {
    audio: new Audio(),
    currentMomentId: null,
    isPlaying: false,
    playTimeout: null,

    async play(url, momentId, isManual = false) {
        if (!url) return;

        this.stop();
        this.audio.src = url;
        this.currentMomentId = momentId;
        this.audio.volume = 1.0;

        try {
            this.audio.load();
            await this.audio.play();
            this.isPlaying = true;
            this.updateVoiceIcons(true);
        } catch (e) {
            console.warn("Voice play failed:", e);
            showModal('Hata', 'Ses dosyası oynatılamadı: ' + e.message);
            this.isPlaying = false;
        }

        this.audio.onended = () => {
            this.isPlaying = false;
            MusicManager.restore();
            this.updateVoiceIcons(false);
        };
    },

    stop() {
        if (this.playTimeout) {
            clearTimeout(this.playTimeout);
            this.playTimeout = null;
        }
        this.audio.pause();
        this.audio.currentTime = 0;
        this.isPlaying = false;
        if (MusicManager.isPlaying) {
            MusicManager.audio.volume = MusicManager.originalVolume;
        }
        this.updateVoiceIcons(false);
    },

    updateVoiceIcons(active) {
        document.querySelectorAll('.voice-indicator-icon').forEach(icon => {
            const card = icon.closest('.moment-card');
            if (card && card.dataset.id === this.currentMomentId) {
                icon.style.color = active ? 'var(--accent)' : 'inherit';
                icon.style.opacity = active ? '1' : '0.6';
            } else {
                icon.style.color = 'inherit';
                icon.style.opacity = '0.6';
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

    const refreshTodayDate = () => {
        if (dom.momentDate) {
            const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
            dom.momentDate.max = today;
            // Only set value if it's currently empty or was previously set to an old "today"
            if (!dom.momentDate.value || dom.momentDate.value === dom.momentDate._lastToday) {
                dom.momentDate.value = today;
                dom.momentDate._lastToday = today;
            }
        }
    };

    refreshTodayDate();
    // Refresh date when user interacts with date button or focuses
    document.getElementById('dateBtn')?.addEventListener('click', refreshTodayDate);
    dom.momentDate?.addEventListener('focus', refreshTodayDate);

    // Logic: If date changes to past -> Clear verified location
    dom.momentDate?.addEventListener('change', (e) => {
        const selected = new Date(e.target.value);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        selected.setHours(0, 0, 0, 0);

        // If selected date is in the past AND we have a verified location
        if (selected < today && isRealLocationActive) {
            isRealLocationActive = false;
            currentLocation = null;

            if (dom.locationStatus) {
                dom.locationStatus.textContent = '';
                dom.locationStatus.classList.add('hidden');
            }
            if (dom.addLocationBtn) dom.addLocationBtn.classList.remove('active');

            showModal('Konum Sıfırlandı', 'Geçmiş tarihli anılar için aktif konum kullanılamaz. Konum bilgisi kaldırıldı.');
        }
    });

    // Default to Home (my-following)
    currentView = 'my-following';

    // Safety: ensure splash is hidden eventually (100% guarantee)
    const splashTimeout = setTimeout(() => {
        const loadingSplash = document.getElementById('loadingSplash');
        const appDiv = document.getElementById('app');
        if (loadingSplash && !loadingSplash.classList.contains('hidden')) {
            console.warn("Splash safety timeout triggered. Forcing splash hide.");
            loadingSplash.classList.add('hidden');
            if (appDiv) {
                appDiv.classList.remove('hidden');
                appDiv.classList.add('fade-in');
            }
        }
    }, 3000); // Reduced to 3s for better mobile UX

    try {
        setupEventListeners();
        applyAppTheme(currentAppTheme);
        setupAutoplayObserver();
    } catch (e) {
        console.error("Initialization Error:", e);
    }

    // Auth Listener
    // --- Auth State Listener (Robust Mobile Persistence) ---
    // --- Auth State Listener (Robust Mobile Persistence) ---
    AuthService.onAuthStateChanged(async (user) => {
        console.log("[Auth] State changed. User:", user ? user.uid : "null");

        const splash = document.getElementById('loadingSplash');
        const loginOverlay = document.getElementById('loginOverlay');
        const app = document.getElementById('app');

        const showLoginScreen = () => {
            if (splash) splash.style.display = 'none';
            if (app) app.classList.add('hidden');
            if (loginOverlay) {
                loginOverlay.style.display = 'flex';
                setTimeout(() => loginOverlay.classList.add('active'), 100);
            }
            initializeUI();
            moments = [];
            renderTimeline();
        };

        if (user) {
            // --- LOGIN SUCCESS ---
            console.log("[Auth] User detected:", user.uid);

            // RESET LOGIN BUTTON STATE (Fixes "Wait..." hang)
            const loginBtn = document.getElementById('googleLoginBtn');
            if (loginBtn) {
                loginBtn.disabled = false;
                const btnText = loginBtn.querySelector('span');
                if (btnText) btnText.textContent = 'Giriş Yap';
            }

            // 1. Set Shadow Persistence
            localStorage.setItem('momentLog_hasSession', 'true');

            // 2. Setup Basic Profile UI (Prioritize Local Cache to avoid Google Photo revert)
            const cachedPhoto = localStorage.getItem('momentLog_cachedPhoto');
            const displayPhoto = cachedPhoto || user.photoURL || '👤';

            if (dom.profileBtn) {
                dom.profileBtn.innerHTML = `<img src="${displayPhoto}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
            }
            if (dom.userNameSpan) {
                dom.userNameSpan.textContent = user.displayName || 'Kullanıcı';
            }

            // 3. Determine View & Initialize
            let lastView = localStorage.getItem('momentLog_lastView_v2');
            // Revert default to 'my-following' (Home) now that race condition is fixed
            if (!lastView || lastView === 'profile' || lastView === 'notifications') {
                lastView = 'my-following';
            }

            try {
                // 4. UI Transition (Hide splash/overlay FIRST, show app)
                initializeUI();
                if (splash) {
                    splash.style.opacity = '0';
                    setTimeout(() => splash.remove(), 500);
                }
                if (loginOverlay) loginOverlay.style.display = 'none';
                if (app) {
                    app.classList.remove('hidden');
                    app.style.opacity = '1';
                }

                // 5. Load Data & View
                // FIX: Pass user explicitly to prevent empty load race condition
                await window.setView(lastView, true, null, user);
                setupNotifications();

                // 6. Background Enrichment
                DBService.getUserProfile(user.uid).then(profile => {
                    if (profile) {
                        currentUserProfile = profile;
                        // Update Cache
                        if (profile.photoURL) {
                            localStorage.setItem('momentLog_cachedPhoto', profile.photoURL);
                            if (dom.profileBtn) {
                                dom.profileBtn.innerHTML = `<img src="${profile.photoURL}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
                            }
                        }
                        if (profile.username && dom.userNameSpan) dom.userNameSpan.textContent = profile.username;
                    }
                }).catch(e => console.warn("[Auth] Profile enrichment error:", e));

            } catch (initErr) {
                console.error("[Auth] App init failed:", initErr);
            }

        } else {
            // --- LOGOUT / NO USER ---
            console.log("[Auth] No user detected. Resetting UI.");

            // Clean up any residual state
            localStorage.removeItem('momentLog_hasSession');
            sessionStorage.removeItem('momentLog_redirectPending');

            showLoginScreen();
        }
    });

    // Login Button
    // Login Button
    const loginBtn = document.getElementById('googleLoginBtn');
    loginBtn?.addEventListener('click', async () => {
        const btnText = loginBtn.querySelector('span');
        const originalText = btnText ? btnText.textContent : 'Giriş Yap';
        if (btnText) btnText.textContent = 'Bekleyin...';
        loginBtn.disabled = true;

        try {
            const result = await AuthService.signInWithGoogle();
            // EXPLICIT SUCCESS HANDLING (Fixes UI not updating after popup)
            if (result && result.user) {
                console.log("[Login] Explicit success for:", result.user.uid);

                // Force UI Transition immediately
                const loginOverlay = document.getElementById('loginOverlay');
                const app = document.getElementById('app');
                const splash = document.getElementById('loadingSplash');

                if (loginOverlay) loginOverlay.style.display = 'none';
                if (splash) splash.remove();
                if (app) {
                    app.classList.remove('hidden');
                    app.style.opacity = '1';
                }

                // Reset button just in case
                loginBtn.disabled = false;
                if (btnText) btnText.textContent = originalText;

                // Initialize if needed (Listener will also fire, but this ensures speed)
                initializeUI();
                await window.setView('my-following', true, null, result.user);
            }
        } catch (err) {
            console.error("Login start error:", err);
            if (btnText) btnText.textContent = originalText;
            loginBtn.disabled = false;
            // Only show error if it's not a redirect-in-progress (code 3 cancelled usually implies redirect)
            if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
                showModal("Hata", "Giriş başlatılamadı. Lütfen tekrar deneyin.\n(" + err.message + ")");
            }
        }
    });

    // Handle Redirect Results Once (Fallback for flaky onAuthStateChanged on mobile)
    (async () => {
        try {
            const result = await AuthService.getRedirectResult();
            if (result && result.user) {
                console.log("[Auth] Redirect success for:", result.user.uid);

                // FORCE UI TRANSITION (If auth listener was too slow)
                const loginOverlay = document.getElementById('loginOverlay');
                const app = document.getElementById('app');
                const splash = document.getElementById('loadingSplash');

                if (loginOverlay && !loginOverlay.classList.contains('hidden')) {
                    loginOverlay.style.display = 'none';
                    if (app) app.classList.remove('hidden');
                    if (splash) splash.remove(); // Nuke splash if still there
                    initializeUI();
                }
            }
        } catch (err) {
            console.error("[Auth] Redirect result error:", err);
        }
    })();

    // Register Service Worker with Reload Protection
    if ('serviceWorker' in navigator) {
        // Track if we had a controller at start (to distinguish first install from update)
        // If navigator.serviceWorker.controller is null, this is a fresh install.
        // We generally DO NOT want to reload on fresh install, clients.claim() is enough.
        // We ONLY want to reload if there WAS a controller (meaning an update happened).
        const hadController = !!navigator.serviceWorker.controller;

        navigator.serviceWorker.register('./sw-v326.js')

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            if (!hadController) return; // Don't reload on first install

            refreshing = true;
            window.location.reload();
        });
    }

    // --- PWA & Mobile Download Logic ---
    let deferredPrompt;
    const installBtn = document.getElementById('installBtn');
    const loginDownloadBtn = document.getElementById('loginDownloadBtn');

    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent Chrome 67 and earlier from automatically showing the prompt
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredPrompt = e;
        // Update UI notify the user they can add to home screen
        if (installBtn) installBtn.classList.remove('hidden');
    });

    const triggerInstall = async () => {
        if (!deferredPrompt) {
            showModal("Yükle", "Uygulamayı yüklemek için tarayıcı menüsünden 'Ana Ekrana Ekle' seçeneğini kullanabilirsiniz.");
            return;
        }
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            if (installBtn) installBtn.classList.add('hidden');
        }
        deferredPrompt = null;
    };

    if (installBtn) installBtn.onclick = triggerInstall;
    if (loginDownloadBtn) {
        loginDownloadBtn.onclick = () => {
            // Priority 1: If PWA prompt is available, use it.
            if (deferredPrompt) {
                triggerInstall();
            } else {
                // Priority 2: Safe Fallback - Instructional Modal
                // Do NOT navigate to APK directly as it breaks PWA context
                showModal("Uygulamayı Yükle",
                    "Otomatik yükleme başlatılamadı.\n\n" +
                    "Lütfen tarayıcı menüsünden (üç nokta) 'Ana Ekrana Ekle' veya 'Yükle' seçeneğini kullanın."
                );
            }
        };
    }
    // Check if running in Standalone mode (PWA/TWA)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone ||
        document.referrer.includes('android-app://');

    if (isStandalone && loginDownloadBtn) {
        loginDownloadBtn.style.display = 'none';
        // Also hide install button if it was shown
        if (installBtn) installBtn.classList.add('hidden');
    }
});


// --- Event Listeners Setup ---
function initializeUI() {
    // Refresh DOM elements helper
    dom.loginBtn = document.getElementById('loginBtn');
    dom.googleLoginBtn = document.getElementById('googleLoginBtn');
    dom.profileBtn = document.getElementById('profileBtn');
    dom.userNameSpan = document.getElementById('userNameSpan');
    dom.logoutBtn = document.getElementById('logoutBtn');
    dom.momentText = document.getElementById('momentText');
    dom.charCount = document.getElementById('charCount');
    dom.photoInput = document.getElementById('photoInput');
    dom.photoPreview = document.getElementById('photoPreview');
    dom.addLocationBtn = document.getElementById('addLocationBtn');
    dom.locationStatus = document.getElementById('locationStatus');
    dom.dateBtn = document.getElementById('dateBtn');
    dom.momentDate = document.getElementById('momentDate');
    dom.themeBtn = document.getElementById('themeBtn');
    dom.saveMomentBtn = document.getElementById('saveMomentBtn');
    dom.timeline = document.getElementById('timeline');
    dom.headerAddBtn = document.getElementById('headerAddBtn');
    dom.visibilityToggle = document.getElementById('visibilityToggle');
    // Re-run selectors init if needed
    initializeSelectors();
}

function setupEventListeners() {
    // Photo input
    if (dom.photoInput) {
        dom.photoInput.addEventListener('change', handlePhotoInput);
    }

    // --- ROBUST DELEGATED EVENTS (Fixes "Dead Button" issues) ---
    document.body.addEventListener('click', (e) => {
        // 1. Profile Button
        const profileTarget = e.target.closest('#profileBtn');
        if (profileTarget) {
            const user = AuthService.currentUser();
            if (user) {
                openProfileView(user.uid).catch(console.error);
            } else {
                showModal('Giriş Gerekli', "Lütfen önce giriş yapın.");
            }
            return;
        }

        // 2. Notifications Button
        const notifTarget = e.target.closest('#notificationsBtn');
        if (notifTarget) {
            window.setView('notifications');
            return;
        }

        // 3. Home / Explore / Add (Bottom Nav is usually static, but good to be safe)
        // ... (Keep existing specific listeners if they are outside this function)
    });

    // Visibility toggle helper
    window.updateVisibilityUI = () => {
        const visibleIcon = document.getElementById('visibleIcon');
        const privateIcon = document.getElementById('privateIcon');
        const friendsIcon = document.getElementById('friendsIcon'); // New icon

        // Reset all
        visibleIcon?.classList.add('hidden');
        privateIcon?.classList.add('hidden');
        friendsIcon?.classList.add('hidden');

        if (currentVisibility === 'public') {
            visibleIcon?.classList.remove('hidden');
            if (dom.visibilityToggle) dom.visibilityToggle.title = "Görünürlük: Herkese Açık";
        } else if (currentVisibility === 'friends') {
            friendsIcon?.classList.remove('hidden');
            if (dom.visibilityToggle) dom.visibilityToggle.title = "Görünürlük: Sadece Takipçiler";
        } else {
            privateIcon?.classList.remove('hidden');
            if (dom.visibilityToggle) dom.visibilityToggle.title = "Görünürlük: Sadece Ben";
        }
    };

    if (dom.visibilityToggle) {
        dom.visibilityToggle.onclick = () => {
            // Cycle: Private -> Friends -> Public -> Private
            if (currentVisibility === 'private') currentVisibility = 'friends';
            else if (currentVisibility === 'friends') currentVisibility = 'public';
            else currentVisibility = 'private';

            window.updateVisibilityUI();
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

    window.setView = async (viewName, force = false, scrollId = null, explicitUser = null) => {
        if (!force && currentView === viewName) return;

        currentView = viewName;
        // Bump storage key to reset sticky 'explore' state from previous versions
        localStorage.setItem('momentLog_lastView_v2', currentView);

        // Stop all audio when switching views
        MusicManager.stop(true);

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
            dom.exploreSearchWrapper?.classList.remove('hidden-mode');
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
            dom.exploreSearchWrapper?.classList.add('hidden-mode');
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
            dom.exploreSearchWrapper?.classList.add('hidden-mode');
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
            dom.exploreSearchWrapper?.classList.add('hidden-mode');
            dom.timeline?.classList.add('hidden-mode');
            document.getElementById('notiView')?.classList.add('hidden-mode');
            document.getElementById('profileView')?.classList.remove('hidden-mode');
        } else if (currentView === 'my-moments') {
            // Personal Journal View
            if (titleEl) titleEl.textContent = "Günlüğüm";
            exploreBtn?.classList.remove('active');
            homeBtn?.classList.remove('active');
            headerAddBtn?.classList.remove('active');
            notificationsBtn?.classList.remove('active');
            profileBtn?.classList.remove('active');

            inputSectionBase?.classList.add('hidden-mode');
            dashboardFooter?.classList.add('hidden-mode');
            myRecentMoments?.classList.add('hidden-mode');
            dom.exploreSearchWrapper?.classList.add('hidden-mode');
            document.getElementById('profileView')?.classList.add('hidden-mode');
            document.getElementById('notiView')?.classList.add('hidden-mode');
            dom.timeline?.classList.remove('hidden-mode');
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
            dom.exploreSearchWrapper?.classList.add('hidden-mode');
            document.getElementById('profileView')?.classList.add('hidden-mode');
            document.getElementById('notiView')?.classList.add('hidden-mode');
            dom.timeline?.classList.remove('hidden-mode');
        }

        await loadMoments(explicitUser);
        renderTimeline();
        if (currentView === 'write') renderMyRecentMoments();

        // Scroll to specific moment if ID provided
        if (scrollId && (currentView === 'my-moments' || currentView === 'my-following' || currentView === 'explore')) {
            setTimeout(() => {
                const target = document.querySelector(`.moment-card[data-id="${scrollId}"]`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    target.classList.add('highlight-moment');
                    setTimeout(() => target.classList.remove('highlight-moment'), 2000);
                }
            }, 300);
        }
    };

    if (homeBtn) homeBtn.onclick = () => window.setView('my-following');
    if (exploreBtn) exploreBtn.onclick = () => window.setView('explore');
    if (headerAddBtn) headerAddBtn.onclick = () => window.setView('write');
    if (notificationsBtn) notificationsBtn.onclick = () => window.setView('notifications');

    // Explore Search Listeners
    if (dom.exploreSearchInput) {
        dom.exploreSearchInput.oninput = (e) => {
            const val = e.target.value.trim();
            if (dom.clearSearchBtn) {
                dom.clearSearchBtn.classList.toggle('hidden', val === '');
            }
            renderTimeline(val);
        };
    }

    if (dom.clearSearchBtn) {
        dom.clearSearchBtn.onclick = () => {
            if (dom.exploreSearchInput) dom.exploreSearchInput.value = '';
            dom.clearSearchBtn.classList.add('hidden');
            renderTimeline();
        };
    }
    if (profileBtn) profileBtn.onclick = () => {
        const currentUser = AuthService.currentUser();
        if (currentUser) {
            window.openProfileView(currentUser.uid).catch(e => alert("Profil hatası: " + e));
        } else {
            alert("Hata: Oturum kapalı görünüyor (currentUser is null). Lütfen sayfayı yenileyin.");
            // Optional: Force re-check or show login
        }
    };

    // Add Location Button
    // Location Button
    if (dom.addLocationBtn) {
        dom.addLocationBtn.onclick = () => window.handleRealLocation();
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

    // Collection Button
    const collectionBtn = document.getElementById('collectionBtn');
    if (collectionBtn) {
        collectionBtn.onclick = () => window.openCollectionModal();
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
        threshold: 0.5 // Trigger when half of the card is visible/hidden
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const card = entry.target;
            const momentId = card.dataset.id;
            const moment = moments.find(m => m.id === momentId);

            if (entry.isIntersecting) {
                if (moment && moment.musicUrl) {
                    // Respect the global autoplay flag
                    if (!MusicManager.isAutoplayAllowed) return;

                    // Start if not already playing or if different song
                    if (MusicManager.currentMomentId !== momentId || !MusicManager.isPlaying) {
                        MusicManager.play(moment.musicUrl, momentId, false, false); // auto-play
                    }
                } else {
                    // Visible card has no music, fade out current if it was this one or global
                    MusicManager.fadeOut();
                }
            } else {
                // Scrolled out: If the card leaving is the one currently playing, fade out
                if (MusicManager.currentMomentId === momentId && MusicManager.isPlaying) {
                    MusicManager.fadeOut();
                }
            }
        });
    }, options);

    // Initial and periodic observe check
    const observeAll = () => {
        document.querySelectorAll('.moment-card').forEach(card => observer.observe(card));
    };
    observeAll();

    // Check frequently if feed is rendered
    setInterval(observeAll, 3000);

    // Also observe new cards when they are rendered
    window._autoplayObserver = observer;

    // Audio Unlocker: Browser policy bypass
    const unlockAudio = () => {
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
async function loadMoments(explicitUser = null) {
    if (isLoadingNextPage || !hasMore) return;
    isLoadingNextPage = true;

    try {
        // Use explicit user if provided (safer during init), otherwise fallback to auth service
        const currentUser = explicitUser || AuthService.currentUser();

        // Load user profile for premium checks (photo limit, edit, etc.)
        if (currentUser && !currentUserProfile) {
            currentUserProfile = await DBService.getUserProfile(currentUser.uid);
        }

        let result;

        // Fetch own moments once for sidebar
        if (currentUser && myPrivateMoments.length === 0) {
            const res = await DBService.getMyMoments();
            myPrivateMoments = res.moments || [];
        }

        if (currentView === 'explore') {
            result = await DBService.getPublicMoments(currentLastDoc, currentUser?.uid);
            console.log(`[App] Explore moments loaded: ${result?.moments?.length || 0}`);
        } else if (currentView === 'write') {
            result = { moments: myPrivateMoments, lastVisible: null };
            hasMore = false;
        } else if (currentView === 'my-moments') {
            result = await DBService.getMyMoments(currentLastDoc);
        } else {
            result = await DBService.getFollowingMoments(currentLastDoc, currentUser?.uid);
        }

        if (result) {
            const newMoments = result.moments || [];
            moments = [...moments, ...newMoments];
            currentLastDoc = result.lastVisible;

            if (newMoments.length === 0) {
                hasMore = false;
            }
        } else {
            hasMore = false;
        }
    } catch (e) {
        console.error("Critical Data Load Error:", e);
        if (currentView === 'explore') {
            console.warn("Hint: Ensure composite index (isPublic: asc, createdAt: desc) exists in Firebase console.");
        }
        hasMore = false;
    } finally {
        isLoadingNextPage = false;
    }
}

async function saveMoment() {
    const text = dom.input?.value?.trim();
    const dateInput = dom.momentDate?.value;

    // AUTO-STOP recording if user clicks Save while recording
    if (VoiceRecorder.isRecording) {
        await VoiceRecorder.stop(true); // Stop without confirmation
    }

    if (!text && currentMedia.length === 0 && !VoiceRecorder.recordedBlob) {
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

        // LEGAL CHECK: First time share requires agreement
        if (!userProfile.legalAccepted) {
            const accepted = await window.showLegalModal();
            if (!accepted) {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = originalBtnText;
                }
                return;
            }
            // Save acceptance to Firebase
            await DBService.acceptLegalTerms(currentUser.uid);
            userProfile.legalAccepted = true; // Update local copy
        }

        // Upload media to Firebase Storage and get URLs
        const uploadedMedia = [];
        const mediaToUpload = currentMedia.filter(m => m && typeof m.data === 'string');


        if (mediaToUpload.length > 0) {
            showUploadProgress(0, mediaToUpload.length);

            for (let i = 0; i < mediaToUpload.length; i++) {
                const m = mediaToUpload[i];
                try {
                    if (m.type === 'video') {
                        // Video Upload (direct)
                        const cloudinaryUrl = await CloudinaryService.upload(m.data, 'video');
                        uploadedMedia.push({ type: 'video', url: cloudinaryUrl, filter: m.filter || null });
                    } else {
                        // Standard compression for faster upload, but no longer forced by 1MB limit
                        const compressedData = await compressImage(m.data, 0.8, 1200);
                        if (compressedData) {
                            const cloudinaryUrl = await CloudinaryService.upload(compressedData, 'image');
                            uploadedMedia.push({ type: 'image', url: cloudinaryUrl });
                        }
                    }
                } catch (uploadErr) {
                    console.error('Media upload error:', uploadErr);
                }
                showUploadProgress(i + 1, mediaToUpload.length);
            }
            hideUploadProgress();
        }

        // Upload Voice Memo if exists
        let voiceUrl = null;
        if (VoiceRecorder.recordedBlob) {
            try {
                // Upload direct blob to Cloudinary (much more efficient than base64)
                voiceUrl = await CloudinaryService.upload(VoiceRecorder.recordedBlob, 'audio');
            } catch (err) {
                console.error('Voice upload error:', err);
            }
        }


        // Ensure location is a simple string
        const locationString = typeof currentLocation === 'string' ? currentLocation :
            (currentLocation?.text || currentLocation?.name || null);

        const venue = dom.venueInput?.value?.trim() || null;
        const stickerText = dom.stickerInput?.value?.trim() || null;

        // --- SECURITY: Character Limit Validation ---
        const isPremiumUser = userProfile?.isVerified || userProfile?.isEarlyUser;
        const charLimit = isPremiumUser ? 500 : 250;

        if (text && text.length > charLimit) {
            showModal('Sınır Aşıldı', `Anı metniniz çok uzun. ${isPremiumUser ? 'Premium' : 'Normal'} üyeler için sınır ${charLimit} karakterdir. (Şu an: ${text.length})`);

            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalBtnText;
            }
            return;
        }


        // --- MUSIC RESOLUTION FIX ---
        // Force resolve Spotify URL to MP3 preview if not already resolved by debounce
        let resolvedMusicUrl = dom.musicUrlInput?.dataset?.previewUrl || null;
        const inputMusicUrl = dom.musicUrlInput?.value?.trim();

        if (inputMusicUrl && inputMusicUrl.includes('spotify.com') && !resolvedMusicUrl) {
            if (saveBtn) saveBtn.innerHTML = '<span>Müzik İşleniyor...</span>';
            console.log("Saving raw Spotify URL, attempting fallback resolution...");
            try {
                const metadata = await fetchMusicMetadata(inputMusicUrl);
                if (metadata && metadata.previewUrl) {
                    resolvedMusicUrl = metadata.previewUrl;
                    // Also update title if missing
                    if (!dom.musicInput.value.trim() && metadata.title) {
                        dom.musicInput.value = metadata.title;
                    }
                }
            } catch (musicErr) {
                console.warn("Music resolution failed during save:", musicErr);
                // Fallback: save raw URL (better than nothing, though playback might fail for others)
                resolvedMusicUrl = inputMusicUrl;
            }
        } else if (inputMusicUrl && !inputMusicUrl.includes('spotify.com')) {
            // Direct MP3 or other URL
            resolvedMusicUrl = inputMusicUrl;
        }

        const momentData = {
            text: String(text || ''),
            media: uploadedMedia,
            location: locationString,
            venue: venue,
            stickerText: stickerText,
            musicText: dom.musicInput?.value?.trim() || null,
            musicUrl: resolvedMusicUrl,
            voiceUrl: voiceUrl,
            theme: String(currentMomentTheme || 'minimal'),
            mood: String(currentMood || '😊'),
            userId: String(currentUser.uid),
            userDisplayName: String(userProfile?.username || userProfile?.displayName || currentUser.displayName || 'Anonim'),
            userPhotoURL: String(userProfile?.photoURL || currentUser.photoURL || '👤'),
            visibility: currentVisibility,
            isPublic: currentVisibility === 'public',
            isFriendsOnly: currentVisibility === 'friends',
            isPrivateProfile: Boolean(userProfile?.isPrivateProfile), // Store privacy during save
            likes: [],
            commentsCount: 0,
            isVerified: Boolean(userProfile?.isVerified),
            isEarlyUser: Boolean(userProfile?.isEarlyUser),
            momentDate: dateInput || null, // The user-selected date
            createdAt: new Date().toISOString() // ACTUAL UPLOAD TIME for absolute sorting
        };

        if (isRealLocationActive && locationString) {
            momentData.verifiedLocation = true;
        }

        // Add collection if selected
        if (currentCollection) {
            momentData.journalId = currentCollection.id;
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
            renderMediaPreview();
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

            // SUCCESS UX: Show auto-closing modal then switch view
            await showModal('Başarılı', 'Anınız kaydedildi! ✨', false, 1500);
            window.setView('my-moments');
        } catch (refreshErr) {
            console.warn("Kayıt başarılı ancak arayüz yenilenirken hata oluştu:", refreshErr);
            window.setView('my-moments');
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

    // 1. Remove duplicates by ID
    const uniqueMap = new Map();
    moments.forEach(m => uniqueMap.set(m.id, m));
    let sortedMoments = Array.from(uniqueMap.values());

    // 2. Sort by createdAt DESC (Robust)
    sortedMoments.sort((a, b) => {
        const getVal = (v) => {
            if (!v) return 0;
            if (typeof v === 'string') return new Date(v).getTime();
            if (v.seconds) return v.seconds * 1000;
            return Number(v);
        };
        return getVal(b.createdAt) - getVal(a.createdAt);
    });

    let filteredMoments = sortedMoments;
    if (searchQuery) {
        const query = searchQuery.toLowerCase().trim();

        if (query.startsWith('#')) {
            // Hashtag Search
            const tag = query.substring(1);
            filteredMoments = sortedMoments.filter(m =>
                (m.text && m.text.toLowerCase().includes('#' + tag)) ||
                (m.stickerText && m.stickerText.toLowerCase().includes('#' + tag))
            );
        } else if (query.startsWith('@')) {
            // User Search
            const username = query.substring(1);
            filteredMoments = sortedMoments.filter(m =>
                (m.userDisplayName && m.userDisplayName.toLowerCase().includes(username))
            );
        } else {
            // General Search (Location, Text, User, Sticker)
            filteredMoments = sortedMoments.filter(m =>
                m.text?.toLowerCase().includes(query) ||
                m.location?.toLowerCase().includes(query) ||
                m.venue?.toLowerCase().includes(query) ||
                m.userDisplayName?.toLowerCase().includes(query) ||
                m.stickerText?.toLowerCase().includes(query)
            );
        }
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
        // Date: user selected momentDate OR createdAt
        const displayDate = new Date(m.momentDate || m.createdAt);
        // Time: ALWAYS use createdAt for actual capture time (to avoid 00:00/03:00 reset)
        const displayTime = new Date(m.createdAt || m.momentDate);

        const formattedDate = displayDate.toLocaleDateString('tr-TR', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
        const formattedTime = displayTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const locationText = m.location ? ` • ${m.location}` : '';
        const currentUser = AuthService.currentUser();
        const isLiked = m.likes?.includes(currentUser?.uid);
        const isOwner = currentUser?.uid === m.userId;

        // Stickers Generator (Always Split: Time Left, Headline Right)
        const stickersHtml = `
            <div class="collage-stickers-overlay">
                <div class="mini-time-sticker collage-sticker">${formattedTime}</div>
                ${m.stickerText ? `<div class="mini-brush-sticker collage-sticker">${escapeHTML(m.stickerText)}</div>` : ''}
            </div>
        `;

        // Media Carousel Logic
        const mediaItems = m.media?.filter(med => med.type === 'image' || med.type === 'video') || [];
        let mediaHtml = '';

        if (mediaItems.length > 0) {
            const totalSlides = mediaItems.length + 1;
            mediaHtml = `
                <div class="carousel-wrapper">
                    <div class="carousel-indicator hidden-fade"></div>
                    <div class="card-media-carousel" onscroll="window._handleCarouselScroll(this)">
                        <!-- Slide 1: Mini Collage (Interactive & Stickered & Music) -->
                        <div class="carousel-slide collage-slide">
                             ${(() => {
                    // 60% for mobile as requested, 50% for larger screens
                    let vCenter = window.innerWidth <= 768 ? 60 : 50;
                    return generateMiniCollage(m.media, vCenter);
                })()}
                            
                            <!-- Music Marquee inside Collage (Top) -->
                            ${(m.musicText || m.voiceUrl) ? `
                                <div class="collage-music-wrapper">
                                    <div class="collage-music-marquee ${(m.musicText && m.musicText.length > 25) ? 'has-scroll' : ''}">
                                        ${m.musicText ? `🎵 ${escapeHTML(m.musicText)}` : ''}
                                    </div>
                                    ${m.voiceUrl ? `<div class="voice-indicator-icon" title="Ses Kaydı Mevcut">🎙️</div>` : ''}
                                </div>
                                ${m.voiceUrl ? `<div class="voice-visualizer-wave"></div>` : ''}
                            ` : ''}

                            ${stickersHtml}
                        </div>
            `;

            // Sequential Slides: Individual Photos/Videos
            mediaItems.forEach(item => {
                if (item.type === 'video') {
                    mediaHtml += `
                        <div class="carousel-slide">
                            <video src="${item.url || item.data}" controls playsinline class="${item.filter ? 'filtered-' + item.filter : ''}" style="width:100%; height:100%; object-fit:cover;"></video>
                        </div>
                    `;
                } else {
                    mediaHtml += `
                        <div class="carousel-slide">
                            <img src="${item.url || item.data}" alt="" class="${item.filter ? 'filtered-' + item.filter : ''}">
                        </div>
                    `;
                }
            });

            mediaHtml += `
                    </div>
                </div>`;
        }

        return `
            <div class="moment-card theme-${m.theme || 'default'}" data-id="${m.id}" onclick="window.handleCardClick(event, '${m.id}', '${m.musicUrl || ''}', '${m.voiceUrl || ''}')">
                <!-- 1. Header (Kullanıcı Bilgisi) -->
                <div class="card-header">
                    <div class="user-info" onclick="openProfileView('${m.userId}')">
                        <div class="user-avatar">
                            ${(m.userPhotoURL?.startsWith('http') || m.userPhotoURL?.startsWith('data:')) ? `<img src="${m.userPhotoURL}">` : (m.userPhotoURL || '👤')}
                        </div>
                        <div class="user-meta">
                            <div class="user-name-row">
                                <span class="username">${escapeHTML(m.userDisplayName || 'Anonim')}</span>
                                ${m.isVerified ? '<span class="verified-badge">✓</span>' : ''}
                                ${m.isEarlyUser ? '<span class="early-user-tag">PRO</span>' : ''}
                            </div>
                            <div class="moment-metadata">
                                <span class="date">${formattedDate}${escapeHTML(locationText)}</span>
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
                        <div class="collage-music-wrapper" style="position: relative; margin-bottom: 5px; background: rgba(var(--accent-rgb), 0.1);">
                             <div class="collage-music-marquee">
                                ${m.musicText ? `🎵 ${escapeHTML(m.musicText)}` : ''}
                             </div>
                             <div class="voice-indicator-icon">🎙️</div>
                        </div>
                        <div class="voice-visualizer-wave" style="margin-bottom: 10px;"></div>
                        <button class="voice-play-btn" onclick="event.stopPropagation(); window.toggleVoiceMemo('${m.voiceUrl}', '${m.id}')" data-moment-id="${m.id}">
                            🎤 Sesli Not
                        </button>
                    </div>
                ` : ''}
                
                <!-- 5. Medya -->
                ${mediaHtml}
                
                ${m.text ? `<div class="card-content">${escapeHTML(m.text)}</div>` : ''}
                
                <div class="card-actions">
                    <button class="action-btn ${isLiked ? 'liked' : ''}" onclick="window.toggleLike('${m.id}')">
                        <span class="like-icon">${isLiked ? '❤️' : '🤍'}</span>
                        <span class="like-count">${m.likes?.length || 0}</span>
                    </button>
                    <button class="action-btn" onclick="window.toggleComments('${m.id}')">
                        💬 ${m.commentsCount || 0}
                    </button>
                    <button class="action-btn" onclick="window.handleShare(event, '${m.id}')">
                        🔗
                    </button>
                    <div class="action-spacer"></div>
                    ${isOwner ? `
                        ${(() => {
                    const timeDiff = Date.now() - new Date(m.createdAt).getTime();
                    const isPremium = m.isVerified || m.isEarlyUser;
                    const canEdit = isPremium && timeDiff < 5 * 60 * 1000;
                    return canEdit ? `<button class="action-btn edit-btn premium-feature" onclick="window.openEditMomentModal('${m.id}')" title="Düzenle (Premium)">✏️</button>` : '';
                })()}
                        <div class="visibility-wrapper">
                             <span class="visibility-status-text">
                                 ${(() => {
                    if (m.visibility === 'friends' || m.isFriendsOnly) return 'Takipçiler';
                    return m.isPublic ? 'Herkes' : 'Kendim';
                })()}
                             </span>
                             <button class="action-btn visibility-btn" onclick="window.toggleMomentVisibility('${m.id}', '${m.visibility || (m.isPublic ? 'public' : 'private')}')" title="${(() => {
                    if (m.visibility === 'friends' || m.isFriendsOnly) return 'Görünürlük: Sadece Takipçiler';
                    return m.isPublic ? 'Görünürlük: Herkese Açık' : 'Görünürlük: Sadece Ben';
                })()}">
                                ${(() => {
                    if (m.visibility === 'friends' || m.isFriendsOnly) return '👥';
                    return m.isPublic ? '🌐' : '🔒';
                })()}
                            </button>
                             <button class="action-btn delete-btn" onclick="window.deleteMomentConfirm('${m.id}')" title="Sil">🗑️</button>
                        </div>
                    ` : `
                        <button class="action-btn report-btn" onclick="window.openReportModal('${m.id}')" title="Şikayet Et">🚩</button>
                    `}
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
        const displayDate = new Date(m.momentDate || m.createdAt);
        const displayTime = new Date(m.createdAt || m.momentDate);

        const formattedDate = displayDate.toLocaleDateString('tr-TR', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
        const formattedTime = displayTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const firstImg = m.media?.find(med => med.type === 'image');
        const imgSrc = firstImg?.url || firstImg?.data || '';

        return `
            <div class="swipe-item-wrapper">
                <div class="swipe-action-delete" onclick="window.handleSwipeDelete('${m.id}')">
                    <span>✕</span>
                </div>
                <div class="compact-moment-item"
                     onclick="window.setView('my-moments', false, '${m.id}')"
                     ontouchstart="window.handleSwipeStart(event)"
                     ontouchmove="window.handleSwipeMove(event)"
                     ontouchend="window.handleSwipeEnd(event)">
                    <div class="compact-img-wrapper">
                        <div class="compact-thumb">
                            ${imgSrc ? `<img src="${imgSrc}">` : '<div class="no-thumb">📝</div>'}
                        </div>
                    </div>
                    <div class="compact-info">
                        <div class="compact-date">${formattedDate} • ${formattedTime}</div>
                        ${m.location ? `<div class="compact-location">📍 ${escapeHTML(m.location)}</div>` : ''}
                        ${m.text ? `<div class="compact-text">${escapeHTML(m.text.substring(0, 60))}${m.text.length > 60 ? '...' : ''}</div>` : ''}
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
    swipingElement.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    const currentX = e.changedTouches[0].clientX;
    const diff = currentX - swipeStartX;
    const btn = swipingElement.parentElement.querySelector('.swipe-action-delete');

    if (diff < -40) {
        swipingElement.style.transform = 'translateX(-70px)';
        if (btn) btn.style.opacity = '1';
    } else {
        swipingElement.style.transform = 'translateX(0)';
        if (btn) btn.style.opacity = '0';
    }
    swipingElement = null;
};

window.handleSwipeDelete = async (id) => {
    const confirmed = await showModal('Emin misiniz?', 'Bu anıyı silmek istediğinizden emin misiniz?', true);
    if (confirmed) {
        try {
            await DBService.deleteMoment(id);
            // Dynamic UI update: remove from local caches
            myPrivateMoments = myPrivateMoments.filter(m => m.id !== id);
            moments = moments.filter(m => m.id !== id);

            // Re-render compact list immediately
            renderMyRecentMoments();

            // Re-render main timeline if visible
            renderTimeline();

            await showModal('Silindi', 'Anı başarıyla silindi.', false, 2000);
        } catch (e) {
            console.error("Delete error:", e);
            showModal('Hata', 'Silme işlemi sırasında hata oluştu.');
        }
    } else {
        // Reset swipe position if cancelled
        renderMyRecentMoments();
    }
};

// --- Photo Input ---
function handlePhotoInput(e) {
    const files = Array.from(e.target.files);
    const maxPhotos = getMaxPhotos();
    const isPremium = currentUserProfile?.isVerified || currentUserProfile?.isEarlyUser;

    if (currentMedia.length + files.length > maxPhotos) {
        const premiumMsg = isPremium ? '' : ' (Premium: 7 fotoğraf/video)';
        showModal('Limit Aşıldı', `En fazla ${maxPhotos} medya ekleyebilirsiniz.${premiumMsg}`);
        return;
    }

    // Show progress indicator
    let loaded = 0;
    const total = files.length;
    showUploadProgress(loaded, total);

    files.forEach(file => {
        // Video Handling
        if (file.type.startsWith('video/')) {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = function () {
                window.URL.revokeObjectURL(video.src);
                const duration = video.duration;

                if (duration > 15) {
                    showModal('Video Süresi', 'Hikaye modu için videolar en fazla 15 saniye olabilir.');
                    loaded++;
                    if (loaded === total) {
                        hideUploadProgress();
                        renderMediaPreview();
                    }
                } else {
                    // Capture thumbnail at 0.5s mark
                    video.currentTime = 0.5;
                    video.onseeked = function () {
                        const canvas = document.createElement('canvas');
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        const thumbnailData = canvas.toDataURL('image/jpeg', 0.7);

                        const reader = new FileReader();
                        reader.onload = (event) => {
                            currentMedia.push({
                                type: 'video',
                                data: event.target.result,
                                thumbnail: thumbnailData // Store thumbnail for filters
                            });
                            loaded++;
                            showUploadProgress(loaded, total);
                            if (loaded === total) {
                                hideUploadProgress();
                                renderMediaPreview();
                            }
                        };
                        reader.readAsDataURL(file);
                    };
                }
            };
            video.onerror = function () {
                loaded++;
                if (loaded === total) {
                    hideUploadProgress();
                    renderMediaPreview();
                }
            };
            video.src = URL.createObjectURL(file);
        } else {
            // Image Handling
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
        }
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

    const hasImages = currentMedia.some(m => m.type === 'image');

    let html = currentMedia.map((m, i) => `
// Video element includes: controls, playsinline (for iOS), and filter class
        <div class="preview-item">
            ${m.type === 'image'
            ? `<img src="${m.data}" class="${m.filter ? 'filtered-' + m.filter : ''}">`
            : `<video src="${m.data}" controls playsinline class="${m.filter ? 'filtered-' + m.filter : ''}"></video>`}
            <button class="remove-btn" onclick="removeMedia(${i})">×</button>
        </div>
    `).join('');

    if (hasImages) {
        html += `
            <div class="filter-trigger-container">
                <button class="btn-filter-trigger" onclick="window.openFilterModal()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                    </svg>
                    Filtrele
                </button>
            </div>
        `;
    }

    dom.previewArea.innerHTML = html;
}

window.removeMedia = (index) => {
    currentMedia.splice(index, 1);
    renderMediaPreview();
};

/* --- Photo Filter Logic --- */
let currentFilterIndex = 0;
let activeFilter = 'none';

window.openFilterModal = () => {
    // Media includes both images and videos
    const mediaItems = currentMedia.filter(m => m.type === 'image' || m.type === 'video');
    if (mediaItems.length === 0) return;

    currentFilterIndex = 0;
    activeFilter = 'none';

    const modal = document.getElementById('photoFilterModal');
    modal.classList.remove('hidden');

    renderFilterCarousel();
    renderFilterOptions(); // New dynamic generation
};

window.closeFilterModal = () => {
    document.getElementById('photoFilterModal').classList.add('hidden');
};

function renderFilterCarousel() {
    const carousel = document.getElementById('filterCarousel');
    const mediaItems = currentMedia.filter(m => m.type === 'image' || m.type === 'video');

    carousel.innerHTML = mediaItems.map((item, i) => `
        <div class="carousel-slide">
            ${item.type === 'video'
            ? `<video src="${item.data}" class="f-${activeFilter}" id="filterSlide-${i}" muted loop playsinline></video>`
            : `<img src="${item.data}" class="f-${activeFilter}" id="filterSlide-${i}">`
        }
        </div>
    `).join('');

    updateCarouselPosition();
}

function updateCarouselPosition() {
    const carousel = document.getElementById('filterCarousel');
    carousel.style.transform = `translateX(-${currentFilterIndex * 100}%)`;
}

window.nextFilterPhoto = () => {
    const images = currentMedia.filter(m => m.type === 'image');
    if (currentFilterIndex < images.length - 1) {
        currentFilterIndex++;
        updateCarouselPosition();
    }
};

window.prevFilterPhoto = () => {
    if (currentFilterIndex > 0) {
        currentFilterIndex--;
        updateCarouselPosition();
    }
};

window.setFilter = (filterName) => {
    activeFilter = filterName;

    // Apply to all slides preview
    const slides = document.querySelectorAll('.carousel-slide img');
    slides.forEach(img => {
        img.className = filterName === 'none' ? '' : `f-${filterName}`;
    });

    updateFilterOptionsUI();
};

// New: Dynamic Filter Options with Live Thumbnails
function renderFilterOptions() {
    const container = document.getElementById('dynamicFilterOptions');
    if (!container) return;

    // Get thumbnail: Prefer the first image/video in the list
    const mediaItem = currentMedia.find(m => m.type === 'image' || m.type === 'video');

    // For video, use the captured thumbnail. For image, use the data/url.
    let thumbData = '';
    if (mediaItem) {
        thumbData = mediaItem.thumbnail || mediaItem.url || mediaItem.data;
    }

    const filters = [
        { id: 'none', label: 'Normal' },
        { id: 'soft', label: 'Soft' },
        { id: 'vintage', label: 'Vintage' },
        { id: 'dramatic', label: 'Dramatik' },
        { id: 'cinema', label: 'Sinema' },
        { id: 'bw', label: 'Siyah Beyaz' },
        { id: 'retro', label: 'Retro' },
        { id: 'warm', label: 'Sıcak' },
        { id: 'cool', label: 'Soğuk' },
        { id: 'nostalgia', label: 'Nostalji' }
    ];

    container.innerHTML = filters.map(f => `
        <div class="filter-option ${activeFilter === f.id ? 'active' : ''}" 
             onclick="window.setFilter('${f.id}')" 
             data-filter="${f.id}">
             ${
        // If it's a video, we can't easily set bg image unless we have a poster. 
        // For now, if video, maybe just use a color or the video itself (too heavy).
        // Use the data as background (works for images, for video dataURL might work if frame captured)
        // If video is raw dataURL (base64) it might be huge.
        // Optimization: Capture a frame? For MVP, reuse the same data.
        `<div class="filter-preview-thumb ${f.id !== 'none' ? 'filtered-' + f.id : ''}" 
                       style="background-image: url('${thumbData}');"></div>`
        }
            <span>${f.label}</span>
        </div>
    `).join('');
}

function updateFilterOptionsUI() {
    // Just re-render to update 'active' class efficiently or toggle classes
    const options = document.querySelectorAll('.filter-option');
    options.forEach(opt => {
        const isMatch = opt.getAttribute('data-filter') === activeFilter;
        opt.classList.toggle('active', isMatch);
    });
}

window.applyFiltersToAll = async () => {
    if (activeFilter === 'none') {
        // Just clear any existing filters from memory objects
        currentMedia.forEach(m => {
            if (m.type === 'image') delete m.filter;
        });
        renderMediaPreview();
        window.closeFilterModal();
        return;
    }

    const saveBtn = document.getElementById('btn-apply-filters');
    const originalText = saveBtn ? saveBtn.textContent : 'Uygula';
    if (saveBtn) {
        saveBtn.textContent = 'Uygulanıyor...';
        saveBtn.disabled = true;
    }

    try {
        const filterStr = getCSSFilterString(activeFilter);

        for (let i = 0; i < currentMedia.length; i++) {
            if (currentMedia[i].type === 'image') {
                currentMedia[i].data = await processImageWithFilter(currentMedia[i].data, filterStr);
                currentMedia[i].filter = activeFilter; // Store name for preview class
            } else if (currentMedia[i].type === 'video') {
                // For video, we just store the filter name to apply it via CSS class during playback
                currentMedia[i].filter = activeFilter;
            }
        }

        renderMediaPreview();
        window.closeFilterModal();
    } catch (err) {
        console.error("Filter apply error:", err);
        showModal('Hata', 'Filtre uygulanırken bir sorun oluştu.');
    } finally {
        if (saveBtn) {
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
        }
    }
};

function getCSSFilterString(filterName) {
    switch (filterName) {
        case 'soft': return 'brightness(1.1) contrast(0.9) saturate(0.9)';
        case 'vintage': return 'sepia(0.4) contrast(1.2) brightness(0.9)';
        case 'dramatic': return 'contrast(1.4) saturate(0.9) brightness(0.9)';
        case 'cinema': return 'contrast(1.1) brightness(1.1) saturate(1.3) sepia(0.2)';
        case 'bw': return 'grayscale(1) contrast(1.1)';
        case 'nostalgia': return 'sepia(0.35) saturate(0.7) contrast(0.95)';
        case 'retro': return 'sepia(0.5) contrast(1.1) brightness(0.95)';
        case 'warm': return 'sepia(0.25) saturate(1.3) hue-rotate(-10deg)';
        case 'cool': return 'saturate(1.1) hue-rotate(180deg) brightness(1.05)';
        default: return 'none';
    }
}

async function processImageWithFilter(base64Data, filterStr) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');

            ctx.filter = filterStr;
            ctx.drawImage(img, 0, 0);

            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = reject;
        img.src = base64Data;
    });
}

// Delete moment confirmation
window.deleteMomentConfirm = async (momentId) => {
    const confirmed = await showModal('Silmek istediğinize emin misiniz?', 'Bu anı kalıcı olarak silinecek ve geri alınamaz.', true);
    if (confirmed) {
        try {
            await DBService.deleteMoment(momentId);

            // Dynamic UI update: remove from local caches
            moments = moments.filter(m => m.id !== momentId);
            myPrivateMoments = myPrivateMoments.filter(m => m.id !== momentId);

            // Re-render
            renderTimeline();
            renderMyRecentMoments();

            // SUCCESS UX: Show auto-closing modal
            await showModal('Silindi', 'Anı başarıyla silindi.', false, 2000);
        } catch (e) {
            console.error('Delete error:', e);
            showModal('Hata', 'Anı silinemedi: ' + e.message);
        }
    }
};

// Toggle moment visibility (public/private)
// Toggle moment visibility (3-State: Public -> Friends -> Private)
window.toggleMomentVisibility = async (momentId, currentVisibilityOrPublic) => {
    // Determine current state based on old boolean or new string
    let currentState = 'public';
    if (typeof currentVisibilityOrPublic === 'boolean') {
        currentState = currentVisibilityOrPublic ? 'public' : 'private';
    } else {
        currentState = currentVisibilityOrPublic || 'public';
    }

    // Cycle: Public -> Friends -> Private -> Public
    let nextState = 'public';
    if (currentState === 'public') nextState = 'friends';
    else if (currentState === 'friends') nextState = 'private';
    else nextState = 'public';

    try {
        await DBService.setMomentVisibility(momentId, nextState);

        // Update local state
        const updateState = (list) => {
            const m = list.find(item => item.id === momentId);
            if (m) {
                m.visibility = nextState;
                m.isPublic = nextState === 'public';
                m.isFriendsOnly = nextState === 'friends';
            }
        };
        updateState(moments);
        updateState(myPrivateMoments);

        // If hidden/friends-only in public feed, remove it
        if (nextState !== 'public' && (currentView === 'explore' || currentView === 'my-following')) {
            // Keep logic simple: remove if not public in explore
            if (currentView === 'explore') moments = moments.filter(m => m.id !== momentId);
        }

        // Re-render
        renderTimeline();
        renderMyRecentMoments();

        // Feedback
        const labels = {
            'public': 'Herkese Açık 🌐',
            'friends': 'Sadece Takipçiler 👥',
            'private': 'Sadece Ben 🔒'
        };
        // showToast(`Görünürlük: ${labels[nextState]}`); // Removed in favor of card text

    } catch (e) {
        console.error("Visibility update error:", e);
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

async function loadInlineComments(momentId, expanded = false) {
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

        // Sort by likes count (descending)
        comments.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0));

        let displayComments = comments;
        let showMoreBtn = '';

        if (!expanded && comments.length > 3) {
            displayComments = comments.slice(0, 3);
            showMoreBtn = `
                <div class="show-more-comments-wrapper" style="padding: 10px; text-align: center;">
                    <button class="show-more-comments-btn" onclick="loadInlineComments('${momentId}', true)" style="background: none; border: none; color: var(--accent-gold); font-size: 0.85rem; cursor: pointer;">
                        Tüm yorumları gör (${comments.length})
                    </button>
                </div>
            `;
        }

        list.innerHTML = displayComments.map(c => {
            const isOwner = currentUser?.uid === c.userId;
            const isLiked = c.likes?.includes(currentUser?.uid);
            const likeCount = c.likes?.length || 0;
            const date = new Date(c.createdAt).toLocaleDateString('tr-TR');
            return `
                <div class="comment-item">
                    <div class="comment-header">
                        <span class="comment-author">@${escapeHTML(c.username || c.userDisplayName || c.userName || 'anonim')}</span>
                        <span class="comment-date">${date}</span>
                        ${isOwner ? `<button class="comment-delete" onclick="window.deleteComment('${momentId}', '${c.id}')">×</button>` : ''}
                    </div>
                    <div class="comment-text">${escapeHTML(c.text)}</div>
                    <div class="comment-actions">
                        <button class="comment-like ${isLiked ? 'liked' : ''}" onclick="window.toggleCommentLike('${momentId}', '${c.id}')">
                            ${isLiked ? '❤️' : '🤍'} ${likeCount > 0 ? likeCount : ''}
                        </button>
                    </div>
                </div>
            `;
        }).join('') + showMoreBtn;
    } catch (e) {
        list.innerHTML = '<div class="error">Yorumlar yüklenemedi</div>';
    }
}

window.toggleCommentLike = async (momentId, commentId) => {
    try {
        await DBService.toggleCommentLike(momentId, commentId);
        // Determine if we should refresh as expanded or not based on current view
        const list = document.getElementById(`commentsList-${momentId}`);
        const isCurrentlyExpanded = list && list.querySelectorAll('.comment-item').length > 3;
        await loadInlineComments(momentId, isCurrentlyExpanded);
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
    if (!navigator.geolocation) {
        if (dom.locationStatus) {
            dom.locationStatus.textContent = "📍 Tarayıcı konumu desteklemiyor";
            dom.locationStatus.classList.remove('hidden');
        }
        return;
    }

    if (dom.locationStatus) {
        dom.locationStatus.textContent = "📍 Konum alınıyor...";
        dom.locationStatus.classList.remove('hidden');
    }

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            try {
                const { latitude, longitude } = pos.coords;
                // Complying with Nominatim usage policy by providing an identifier (email)
                const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=tr&email=serhataykis@gmail.com`;

                const response = await fetch(url, {
                    headers: {
                        'Accept-Language': 'tr'
                    }
                });

                if (!response.ok) throw new Error("Servis yanıt vermedi");
                const data = await response.json();

                const address = data.address;
                if (!address) {
                    // Fallback to display name if address object is missing
                    if (data.display_name) {
                        currentLocation = data.display_name.split(',').slice(0, 3).join(', ');
                    } else {
                        throw new Error("Adres bulunamadı");
                    }
                } else {
                    // Format: İlçe, İl, Ülke
                    const parts = [];
                    const district = address.town || address.village || address.suburb || address.district || address.city_district || address.neighbourhood;
                    const city = address.province || address.city || address.state || address.admin_level_4;

                    if (district) parts.push(district);
                    if (city) parts.push(city);
                    if (address.country) parts.push(address.country);

                    currentLocation = parts.length > 0 ? parts.join(', ') : (data.display_name ? data.display_name.split(',')[0] : 'Bilinmeyen Konum');
                }

                if (dom.locationStatus) {
                    dom.locationStatus.textContent = `📍 ${currentLocation}`;
                    dom.locationStatus.classList.remove('hidden');
                }

                dom.addLocationBtn?.classList.add('active');
            } catch (e) {
                console.error("Konum ayrıştırma hatası:", e);
                currentLocation = "Konum alınamadı";
                // Show a more descriptive error based on the failure
                if (dom.locationStatus) {
                    dom.locationStatus.textContent = e.message === "Adres bulunamadı" ? "📍 Konum bulunamadı" : "📍 Servis hatası";
                }
                isRealLocationActive = false;
                dom.addLocationBtn?.classList.remove('active');
            }
        },
        (err) => {
            console.warn("Geolocation error:", err);
            let msg = "Konum izni reddedildi";
            if (err.code === 2) msg = "Konum servisleri kapalı";
            if (err.code === 3) msg = "Konum zaman aşımı";

            if (dom.locationStatus) {
                dom.locationStatus.textContent = `📍 ${msg}`;
            }
            isRealLocationActive = false;
            dom.addLocationBtn?.classList.remove('active');
        },
        { timeout: 15000, enableHighAccuracy: true }
    );
}

window.handleRealLocation = () => {
    // Check if the selected date is in the past
    const selectedDate = dom.momentDate?.value;
    const today = new Date().toLocaleDateString('en-CA');

    if (!isRealLocationActive && selectedDate && selectedDate < today) {
        if (dom.locationStatus) {
            dom.locationStatus.textContent = "📍 Önce tarihi bugüne getirin";
            dom.locationStatus.classList.remove('hidden');
            setTimeout(() => {
                if (dom.locationStatus.textContent === "📍 Önce tarihi bugüne getirin") {
                    dom.locationStatus.classList.add('hidden');
                }
            }, 3000);
        }
        return;
    }

    isRealLocationActive = !isRealLocationActive;

    if (isRealLocationActive) {
        dom.addLocationBtn?.classList.add('active');
        fetchLocation();
    } else {
        dom.addLocationBtn?.classList.remove('active');
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
                    <h2>
                        ${escapeHTML(userProfile.displayName || 'İsimsiz')}
                        ${userProfile.isVerified ? '<span class="verified-badge">✓</span>' : ''}
                    </h2>
                    <p class="profile-username">@${escapeHTML(userProfile.username || 'kullanici')}</p>
                    <p class="profile-bio">${escapeHTML(userProfile.bio || '')}</p>
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
                    const targetView = isOwnProfile ? 'my-moments' : 'explore';
                    return `<div class="grid-item" onclick="window.setView('${targetView}', false, '${m.id}')">
                        ${imgSrc ? `<img src="${imgSrc}">` : '<div class="text-placeholder">📝</div>'}
                        </div>`;
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

        // Tab switching
        const tabBtns = content.querySelectorAll('.tab-btn');
        const momentsGrid = content.querySelector('.profile-moments-grid');
        const privateNotice = content.querySelector('.private-profile-notice');

        if (tabBtns.length > 0) {
            tabBtns[0].onclick = () => {
                // Anılar tab
                tabBtns.forEach(btn => btn.classList.remove('active'));
                tabBtns[0].classList.add('active');
                if (momentsGrid) momentsGrid.style.display = 'grid';
                if (privateNotice) privateNotice.style.display = 'flex';
                const collectionsGrid = content.querySelector('.profile-collections-grid');
                if (collectionsGrid) collectionsGrid.style.display = 'none';
            };

            tabBtns[1].onclick = async () => {
                // Koleksiyonlar tab
                tabBtns.forEach(btn => btn.classList.remove('active'));
                tabBtns[1].classList.add('active');
                if (momentsGrid) momentsGrid.style.display = 'none';
                if (privateNotice) privateNotice.style.display = 'none';

                // Load and show collections
                await window.renderCollectionsGrid(uid, content);
            };
        }

    } catch (e) {
        console.error("Profil yükleme hatası:", e);
        content.innerHTML = '<div class="error" style="padding: 40px; text-align: center;">Profil yüklenemedi</div>';
    }

    const closeBtn = view.querySelector('.close-modal-btn');
    if (closeBtn) {
        closeBtn.onclick = () => {
            view.classList.add('hidden');
            document.body.style.overflow = '';
        };
    }
}

window.openProfileView = openProfileView;

// Render Collections Grid
window.renderCollectionsGrid = async (uid, profileContent) => {
    try {
        const collections = await DBService.getJournals(uid);

        // Remove existing collections grid if any
        let collectionsGrid = profileContent.querySelector('.profile-collections-grid');
        if (!collectionsGrid) {
            collectionsGrid = document.createElement('div');
            collectionsGrid.className = 'profile-collections-grid';
            profileContent.querySelector('.profile-scroll-content').appendChild(collectionsGrid);
        }

        collectionsGrid.style.display = 'grid';

        if (collections.length === 0) {
            collectionsGrid.innerHTML = '<div class="no-moments-msg">Henüz koleksiyon yok</div>';
        } else {
            // Get moment counts for each collection
            const collectionsWithCounts = await Promise.all(
                collections.map(async (col) => {
                    const moments = await DBService.getMomentsByJournal(col.id);
                    return { ...col, momentCount: moments.length };
                })
            );

            collectionsGrid.innerHTML = collectionsWithCounts.map(col => `
                <div class="collection-card" onclick="window.openCollectionDetail('${col.id}', '${escapeHTML(col.title)}', '${escapeHTML(col.coverEmoji || '📁')}')">
                    <div class="collection-emoji-large">${col.coverEmoji || '📁'}</div>
                    <div class="collection-title">${escapeHTML(col.title)}</div>
                    <div class="collection-count">${col.momentCount} anı</div>
                </div>
            `).join('');
        }
    } catch (e) {
        console.error('Collections grid error:', e);
    }
};

// Open Collection Detail View
window.openCollectionDetail = async (collectionId, title, emoji) => {
    const view = document.getElementById('profileView');
    const content = document.getElementById('profileContent');

    if (!view || !content) return;

    try {
        const moments = await DBService.getMomentsByJournal(collectionId);

        content.innerHTML = `
            <div class="collection-detail-view">
                <div class="collection-header">
                    <button class="back-btn" onclick="window.closeCollectionDetail()">← Geri</button>
                    <div class="collection-info">
                        <span class="collection-emoji-large">${emoji}</span>
                        <h2>${escapeHTML(title)}</h2>
                        <p>${moments.length} anı</p>
                    </div>
                </div>
                <div class="collection-moments-grid">
                    ${moments.length > 0 ? moments.map(m => {
            const firstImg = m.media ? m.media.find(med => med.type === 'image') : null;
            const imgSrc = firstImg?.url || firstImg?.data || '';
            return `<div class="grid-item" onclick="window.setView('my-moments', false, '${m.id}')">
                            ${imgSrc ? `<img src="${imgSrc}">` : '<div class="text-placeholder">📝</div>'}
                        </div>`;
        }).join('') : '<div class="no-moments-msg">Bu koleksiyonda henüz anı yok</div>'}
                </div>
            </div>
        `;

        view.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    } catch (e) {
        console.error('Collection detail error:', e);
        showModal('Hata', 'Koleksiyon yüklenemedi.');
    }
};

window.closeCollectionDetail = () => {
    const currentUser = AuthService.currentUser();
    if (currentUser) {
        window.openProfileView(currentUser.uid);
    }
};

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
            // Clear shadow persistence
            localStorage.removeItem('momentLog_hasSession');

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
        // Determine action based on UI state to fix sync issues
        // If button says 'takibi bırak' (has .following class), we intend to UNFOLLOW regardless of backend state
        if (followBtn.classList.contains('following')) {
            await DBService.unfollowUser(targetUid);
        } else {
            await DBService.followUser(targetUid);
        }
    } catch (e) {
        console.error('Follow action error:', e);
        // Don't show error modal - action may have partially succeeded
    }
    // Always refresh profile to show current state
    await openProfileView(targetUid);
};

window.toggleProfilePrivacy = async (currentPrivacy) => {
    const newPrivacy = !currentPrivacy;

    // Immediate UI Feedback (Optimistic)
    const toggleBtn = document.querySelector('.privacy-toggle-btn'); // Assuming class name, but referencing by context
    if (toggleBtn) toggleBtn.innerHTML = '⏳ Güncelleniyor...';

    try {
        const currentUser = AuthService.currentUser();
        if (!currentUser) return;

        await DBService.updateUserProfile(currentUser.uid, {
            isPrivateProfile: newPrivacy
        });

        // Manually update local cache to reflect change immediately
        if (currentUserProfile) {
            currentUserProfile.isPrivateProfile = newPrivacy;
        }

        await showModal('Başarılı', `Profiliniz artık ${newPrivacy ? 'Gizli 🔒' : 'Herkese Açık 🌐'}.`, false, 1500);
        openProfileView(currentUser.uid);

    } catch (e) {
        console.error("Privacy toggle error:", e);
        showModal('Hata', 'Gizlilik ayarı güncellenemedi.' + (e.message ? ` (${e.message})` : ''));
        // Revert UI effectively happens by not reloading view or manually resetting if we had a specific button reference
        openProfileView(AuthService.currentUser()?.uid);
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

        // Sort by likes count (descending)
        comments.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0));

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
        const avatar = (n.senderPhoto?.startsWith('http') || n.senderPhoto?.startsWith('data:')) ? `<img src="${n.senderPhoto}">` : (n.senderPhoto || '👤');
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
                <div class="notif-main" onclick="handleNotificationClick('${n.id}', '${n.momentId || ''}', '${n.senderUid}', '${n.type}')">
                    <div class="notif-avatar">${avatar}</div>
                    <div class="notif-content">
                        <div class="notif-text"><strong>${escapeHTML(n.senderName || 'Biri')}</strong> ${typeText[n.type] || 'etkileşimde bulundu'}</div>
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

window.handleNotificationClick = async (notifId, momentId, senderUid, type) => {
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
                const found = scrollToId();
                if (found || attempts > 20) {
                    clearInterval(interval);
                    if (found && type === 'comment') {
                        setTimeout(() => window.toggleComments(momentId), 500);
                    }
                }
            }, 500);
        } else {
            if (type === 'comment') {
                setTimeout(() => window.toggleComments(momentId), 500);
            }
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

// --- Toast Notification ---
window.showToast = function (message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification fade-in';
    toast.textContent = message;

    // Style it dynamically if not in CSS yet
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(39, 39, 42, 0.95)',
        color: '#fff',
        padding: '12px 24px',
        borderRadius: '50px',
        fontSize: '0.95rem',
        fontWeight: '500',
        zIndex: '10000',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(10px)',
        whiteSpace: 'nowrap'
    });

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.transition = 'opacity 0.5s, transform 0.5s';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => toast.remove(), 500);
    }, duration);
};

window.handleShare = async (e, momentId) => {
    e.stopPropagation();
    const moment = moments.find(m => m.id === momentId);
    const text = moment?.text || 'Harika bir anıya bak!';

    const shareData = {
        title: 'MomentLog Anısı',
        text: text,
        url: window.location.origin // Dynamic app URL
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            // Fallback for desktop: Copy to clipboard
            const shareUrl = `${window.location.origin}`;
            await navigator.clipboard.writeText(shareUrl);
            showModal('Bağlantı Kopyalandı', 'Uygulama bağlantısı panoya kopyalandı! 🔗');
        }
    } catch (err) {
        console.warn('Share failed:', err);
    }
};

