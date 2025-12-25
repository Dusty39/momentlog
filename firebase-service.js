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
            // Check if storage is actually initialized/configured
            if (!firebase.storage || !firebase.storage().ref()) {
                console.warn("Storage not initialized, skipping upload.");
                return null;
            }

            const fileName = `${user.uid}_${Date.now()}.${type === 'audio' ? 'webm' : 'jpg'}`;
            const storageRef = storage.ref().child(`moments/${user.uid}/${fileName}`);

            // Mobile Optimization: Convert Data URL to Blob before upload
            const response = await fetch(fileData);
            const blob = await response.blob();

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
            createdAt: new Date().toISOString()
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
        return db.collection('moments').doc(id).delete();
    },

    // Anı Güncelle
    updateMoment: async (id, data) => {
        return db.collection('moments').doc(id).update({
            ...data,
            updatedAt: new Date().toISOString()
        });
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
