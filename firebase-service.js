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
            const fileName = `${user.uid}_${Date.now()}.${type === 'audio' ? 'webm' : 'jpg'}`;
            const storageRef = storage.ref().child(`moments/${user.uid}/${fileName}`);

            // Base64 string to Blob if needed or just use string
            const snapshot = await storageRef.putString(fileData, 'data_url');
            const downloadURL = await snapshot.ref.getDownloadURL();
            return downloadURL;
        } catch (e) {
            console.error("Firebase Storage Upload Error:", e);
            throw e;
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

        const snapshot = await db.collection('moments')
            .where('userId', '==', user.uid)
            .orderBy('createdAt', 'desc')
            .get();

        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
        const snapshot = await db.collection('moments')
            .where('isPublic', '==', true)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();

        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
};
