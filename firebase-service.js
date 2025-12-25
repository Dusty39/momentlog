/**
 * Firebase Service
 * Handles Authentication and Database interactions
 */

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// --- Auth Service ---
const AuthService = {
    // Google ile Giriş
    signInWithGoogle: () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        return auth.signInWithPopup(provider);
    },

    // Çıkış
    signOut: () => {
        return auth.signOut();
    },

    // Kullanıcı Durumunu İzle
    onAuthStateChanged: (callback) => {
        return auth.onAuthStateChanged(callback);
    },

    // Mevcut Kullanıcı
    currentUser: () => {
        return auth.currentUser;
    }
};

// --- Database Service ---
const DBService = {
    // Kullanıcı Profilini Getir/Oluştur
    async getUserProfile(uid) {
        const docRef = db.collection('users').doc(uid);
        const doc = await docRef.get();
        if (doc.exists) {
            return doc.data();
        } else {
            // Yeni kullanıcı profili oluştur
            const user = auth.currentUser;
            const newUser = {
                uid: user.uid,
                displayName: user.displayName,
                email: user.email,
                photoURL: user.photoURL,
                bio: 'Merhaba, ben momentLog kullanıyorum!',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await docRef.set(newUser);
            return newUser;
        }
    },

    // Dosya Yükle (Storage)
    uploadFile: async (fileData, type) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        try {
            // Check for storage availability with a try-catch for safety
            let storageEnabled = false;
            try {
                if (firebase.storage && firebase.storage().ref()) {
                    storageEnabled = true;
                }
            } catch (initErr) {
                console.warn("Storage check failed:", initErr);
            }

            if (!storageEnabled) {
                console.warn("Storage not available, fallback to Base64.");
                return null;
            }

            const fileName = `${user.uid}_${Date.now()}.${type === 'audio' ? 'webm' : 'jpg'}`;
            const storageRef = storage.ref().child(`moments/${user.uid}/${fileName}`);

            // Manual Base64 to Blob conversion
            const dataParts = fileData.split(',');
            const mime = dataParts[0].match(/:(.*?);/)[1];
            const binary = atob(dataParts[1]);
            const array = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                array[i] = binary.charCodeAt(i);
            }
            const blob = new Blob([array], { type: mime });

            const snapshot = await storageRef.put(blob);
            const downloadURL = await snapshot.ref.getDownloadURL();
            return downloadURL;
        } catch (e) {
            console.error("Firebase Storage Error (Falling back to Base64):", e);
            // Return null to signify fallback
            return null;
        }
    },

    // Anı Ekle
    addMoment: async (moment) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        return db.collection('moments').add({
            ...moment,
            userId: user.uid,
            userDisplayName: user.displayName,
            userPhotoURL: user.photoURL,
            likesCount: 0,
            commentsCount: 0,
            createdAt: moment.createdAt || new Date().toISOString()
        });
    },

    // Kişisel Anıları Getir
    getMyMoments: async () => {
        const user = auth.currentUser;
        if (!user) return [];

        try {
            const snapshot = await db.collection('moments')
                .where('userId', '==', user.uid)
                .orderBy('createdAt', 'desc')
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error("Firestore Index Error (Personal Feed):", e);
            throw e; // app.js handles the alert
        }
    },

    // Belirli Bir Kullanıcının Anılarını Getir
    getMomentsByUser: async (uid) => {
        try {
            const snapshot = await db.collection('moments')
                .where('userId', '==', uid)
                .where('isPublic', '==', true) // Only public moments for profile view
                .orderBy('createdAt', 'desc')
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error("Firestore Index Error (Profile View):", e);
            throw e;
        }
    },

    // Anı Sil
    deleteMoment: async (id) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        const docRef = db.collection('moments').doc(id);
        const doc = await docRef.get();
        if (doc.exists && doc.data().userId !== user.uid) {
            throw new Error("Bu anıyı silme yetkiniz yok!");
        }
        return docRef.delete();
    },

    // Anı Güncelle
    updateMoment: async (id, data) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        const docRef = db.collection('moments').doc(id);
        const doc = await docRef.get();
        if (doc.exists && doc.data().userId !== user.uid) {
            throw new Error("Bu anıyı güncelleme yetkiniz yok!");
        }

        return docRef.update({
            ...data,
            updatedAt: new Date().toISOString()
        });
    },

    // Beğeni Arttır/Azalt
    toggleLike: async (momentId) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");
        const docRef = db.collection('moments').doc(momentId);
        const doc = await docRef.get();
        if (!doc.exists) return;

        const data = doc.data();
        const likes = data.likes || [];
        const index = likes.indexOf(user.uid);

        if (index > -1) {
            likes.splice(index, 1); // Unlike
        } else {
            likes.push(user.uid); // Like
        }

        return docRef.update({ likes });
    },

    // Görünürlük Ayarla
    setMomentVisibility: async (momentId, isPublic) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        const docRef = db.collection('moments').doc(momentId);
        const doc = await docRef.get();
        if (doc.exists && doc.data().userId !== user.uid) {
            throw new Error("Bu yetkiye sahip değilsiniz!");
        }
        return docRef.update({ isPublic });
    },

    // Genel Akış (Feed) - Herkesin Public Anıları
    getPublicFeed: async () => {
        try {
            const snapshot = await db.collection('moments')
                .where('isPublic', '==', true)
                .orderBy('createdAt', 'desc')
                .limit(20)
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error("Firestore Index Error (Public Feed):", e);
            throw e;
        }
    }
};
