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
                username: null,
                isPrivateProfile: false, // Default public
                followers: [],
                following: [],
                pendingFollowers: [], // People who want to follow this user
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await docRef.set(newUser);
            return newUser;
        }
    },

    // Kullanıcı Profilini Güncelle
    async updateUserProfile(uid, data) {
        return db.collection('users').doc(uid).update(data);
    },

    // Takip Et / İstek Gönder
    async followUser(targetUid) {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("Giriş yapmalısınız!");
        if (currentUser.uid === targetUid) throw new Error("Kendinizi takip edemezsiniz!");

        const targetRef = db.collection('users').doc(targetUid);
        const targetDoc = await targetRef.get();
        if (!targetDoc.exists) return;

        const targetData = targetDoc.data();

        if (targetData.isPrivateProfile) {
            // Send request
            await targetRef.update({
                pendingFollowers: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
            });
            return this.addNotification(targetUid, { type: 'follow_request' });
        } else {
            // Direct follow
            await targetRef.update({
                followers: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
            });
            await db.collection('users').doc(currentUser.uid).update({
                following: firebase.firestore.FieldValue.arrayUnion(targetUid)
            });
            return this.addNotification(targetUid, { type: 'follow' });
        }
    },

    // Takipten Çık
    async unfollowUser(targetUid) {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("Giriş yapmalısınız!");

        await db.collection('users').doc(targetUid).update({
            followers: firebase.firestore.FieldValue.arrayRemove(currentUser.uid),
            pendingFollowers: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
        });
        return db.collection('users').doc(currentUser.uid).update({
            following: firebase.firestore.FieldValue.arrayRemove(targetUid)
        });
    },

    // Takip Aç/Kapat
    async toggleFollow(targetUid) {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("Giriş yapmalısınız!");

        // Check if already following
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        const following = userDoc.data()?.following || [];

        if (following.includes(targetUid)) {
            return this.unfollowUser(targetUid);
        } else {
            return this.followUser(targetUid);
        }
    },

    // Takip İsteğini Kabul Et
    async acceptFollowRequest(requestUid) {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("Giriş yapmalısınız!");

        // Remove from pending, add to followers
        await db.collection('users').doc(currentUser.uid).update({
            pendingFollowers: firebase.firestore.FieldValue.arrayRemove(requestUid),
            followers: firebase.firestore.FieldValue.arrayUnion(requestUid)
        });
        // Add to requester's following
        await db.collection('users').doc(requestUid).update({
            following: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
        });
        return this.addNotification(requestUid, { type: 'follow' });
    },

    // Takip İsteğini Reddet
    async declineFollowRequest(requestUid) {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("Giriş yapmalısınız!");

        return db.collection('users').doc(currentUser.uid).update({
            pendingFollowers: firebase.firestore.FieldValue.arrayRemove(requestUid)
        });
    },

    // Dosya Yükle (Storage)
    uploadFile: async (fileData, type) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        try {
            let storageEnabled = false;
            try {
                if (firebase.storage && firebase.storage().ref()) {
                    storageEnabled = true;
                }
            } catch (initErr) {
                console.warn("Storage check failed:", initErr);
            }

            if (!storageEnabled) return null;

            const fileName = `${user.uid}_${Date.now()}.${type === 'audio' ? 'webm' : 'jpg'}`;
            const storageRef = storage.ref().child(`moments/${user.uid}/${fileName}`);

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
            console.error("Storage upload error:", e);
            return null;
        }
    },

    // Anı Ekle
    async addMoment(data) {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        const momentData = {
            ...data,
            userId: user.uid,
            userDisplayName: user.displayName || 'İsimsiz',
            userPhotoURL: data.userPhotoURL || user.photoURL || '👤',
            likes: [],
            createdAt: data.createdAt || Date.now()
        };

        return db.collection('moments').add(momentData);
    },

    // Anı Güncelle
    async updateMoment(id, data) {
        return db.collection('moments').doc(id).update(data);
    },

    // Beğeni Aç/Kapat
    async toggleLike(id) {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        const momentRef = db.collection('moments').doc(id);
        const doc = await momentRef.get();
        if (!doc.exists) return;

        const data = doc.data();
        const likes = data.likes || [];
        const isLiked = likes.includes(user.uid);

        if (isLiked) {
            return momentRef.update({
                likes: firebase.firestore.FieldValue.arrayRemove(user.uid)
            });
        } else {
            await momentRef.update({
                likes: firebase.firestore.FieldValue.arrayUnion(user.uid)
            });
            return this.addNotification(data.userId, { type: 'like', momentId: id });
        }
    },

    // Görünürlük Ayarla
    async setMomentVisibility(id, isPublic) {
        return db.collection('moments').doc(id).update({ isPublic: isPublic });
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
            console.error("Personal Feed error:", e);
            throw e;
        }
    },

    // Belirli Bir Kullanıcının Anılarını Getir
    getMomentsByUser: async (uid) => {
        try {
            const snapshot = await db.collection('moments')
                .where('userId', '==', uid)
                .where('isPublic', '==', true)
                .orderBy('createdAt', 'desc')
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (e) {
            console.error("Profile View error:", e);
            throw e;
        }
    },

    // Anı Sil
    deleteMoment: async (id) => {
        return db.collection('moments').doc(id).delete();
    },

    // Takip Edilenlerin Anılarını Getir (Following Feed)
    async getFollowingMoments() {
        try {
            const currentUser = auth.currentUser;
            if (!currentUser) return [];

            // Get user's following list
            const userDoc = await db.collection('users').doc(currentUser.uid).get();
            let following = userDoc.data()?.following || [];

            // Include current user's own posts in the feed
            if (!following.includes(currentUser.uid)) {
                following = [currentUser.uid, ...following];
            }

            if (following.length === 0) {
                return []; // No one followed yet
            }

            // Firestore 'in' query supports max 10 items, so chunk if needed
            const chunks = [];
            for (let i = 0; i < following.length; i += 10) {
                chunks.push(following.slice(i, i + 10));
            }

            let allMoments = [];
            for (const chunk of chunks) {
                const snapshot = await db.collection('moments')
                    .where('userId', 'in', chunk)
                    .where('isPublic', '==', true)
                    .orderBy('createdAt', 'desc')
                    .limit(20)
                    .get();
                allMoments = [...allMoments, ...snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))];
            }

            // Sort by createdAt and limit
            allMoments.sort((a, b) => b.createdAt - a.createdAt);
            const moments = allMoments.slice(0, 20);

            // Enrich with user profiles
            const userIds = [...new Set(moments.map(m => m.userId).filter(Boolean))];
            const userProfiles = {};
            await Promise.all(userIds.map(async (uid) => {
                try {
                    const userDoc = await db.collection('users').doc(uid).get();
                    if (userDoc.exists) userProfiles[uid] = userDoc.data();
                } catch (e) { console.warn('Could not fetch user:', uid); }
            }));

            return moments.map(m => ({
                ...m,
                userDisplayName: userProfiles[m.userId]?.username || userProfiles[m.userId]?.displayName || m.userDisplayName || 'Anonim',
                userPhotoURL: userProfiles[m.userId]?.photoURL || m.userPhotoURL || '👤'
            }));
        } catch (e) {
            console.error("Following Feed error:", e);
            return [];
        }
    },

    // Genel Anıları Getir (Social Feed)
    async getPublicMoments() {
        try {
            const snapshot = await db.collection('moments')
                .where('isPublic', '==', true)
                .orderBy('createdAt', 'desc')
                .limit(20)
                .get();

            // Enrich moments with fresh user profile data
            const moments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Get unique user IDs
            const userIds = [...new Set(moments.map(m => m.userId).filter(Boolean))];

            // Fetch all user profiles in parallel
            const userProfiles = {};
            await Promise.all(userIds.map(async (uid) => {
                try {
                    const userDoc = await db.collection('users').doc(uid).get();
                    if (userDoc.exists) {
                        userProfiles[uid] = userDoc.data();
                    }
                } catch (e) {
                    console.warn('Could not fetch user profile:', uid);
                }
            }));

            // Enrich moments with user data
            console.log('User profiles fetched:', userProfiles);
            return moments.map(m => {
                const profile = userProfiles[m.userId];
                console.log('Moment userId:', m.userId, 'Profile username:', profile?.username, 'Profile displayName:', profile?.displayName);
                return {
                    ...m,
                    userDisplayName: profile?.username || profile?.displayName || m.userDisplayName || 'Anonim',
                    userPhotoURL: profile?.photoURL || m.userPhotoURL || '👤'
                };
            });
        } catch (e) {
            console.error("Public Feed error:", e);
            throw e;
        }
    },

    // Yorum Ekle
    async addComment(momentId, textOrData) {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        // Handle both string and object parameter
        const commentText = typeof textOrData === 'string' ? textOrData : (textOrData?.text || '');

        const commentData = {
            userId: user.uid,
            userDisplayName: user.displayName || 'Anonim',
            userPhoto: user.photoURL || '👤',
            text: commentText,
            likes: [],
            createdAt: new Date().toISOString()
        };

        const docSnapshot = await db.collection('moments').doc(momentId).get();
        const momentData = docSnapshot.data();

        const commentRef = await db.collection('moments').doc(momentId).collection('comments').add(commentData);
        await db.collection('moments').doc(momentId).update({
            commentsCount: firebase.firestore.FieldValue.increment(1)
        });

        await this.addNotification(momentData.userId, { type: 'comment', momentId: momentId, text: commentText });
        return { id: commentRef.id, ...commentData };
    },

    // Yorum Beğeni
    async toggleCommentLike(momentId, commentId) {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        const commentRef = db.collection('moments').doc(momentId).collection('comments').doc(commentId);
        const doc = await commentRef.get();
        if (!doc.exists) return;

        const likes = doc.data().likes || [];
        const isLiked = likes.includes(user.uid);

        if (isLiked) {
            await commentRef.update({ likes: firebase.firestore.FieldValue.arrayRemove(user.uid) });
        } else {
            await commentRef.update({ likes: firebase.firestore.FieldValue.arrayUnion(user.uid) });
        }
        return !isLiked;
    },

    // Yorumları Getir
    async getComments(momentId) {
        const snapshot = await db.collection('moments').doc(momentId).collection('comments').orderBy('createdAt', 'asc').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    // Yorum Sil
    async deleteComment(momentId, commentId) {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        await db.collection('moments').doc(momentId).collection('comments').doc(commentId).delete();
        await db.collection('moments').doc(momentId).update({
            commentsCount: firebase.firestore.FieldValue.increment(-1)
        });
    },

    // Yorum Beğen / Beğeniyi Kaldır
    async toggleCommentLike(momentId, commentId) {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        const commentRef = db.collection('moments').doc(momentId).collection('comments').doc(commentId);
        const doc = await commentRef.get();
        if (!doc.exists) return;

        const data = doc.data();
        const likes = data.likes || [];
        const isLiked = likes.includes(user.uid);

        if (isLiked) {
            return commentRef.update({
                likes: firebase.firestore.FieldValue.arrayRemove(user.uid)
            });
        } else {
            await commentRef.update({
                likes: firebase.firestore.FieldValue.arrayUnion(user.uid)
            });
            return this.addNotification(data.userId, { type: 'like', momentId: momentId });
        }
    },

    // Bildirim Ekle
    async addNotification(targetUid, data) {
        const currentUser = auth.currentUser;
        if (!currentUser || currentUser.uid === targetUid) return;

        return db.collection('notifications').add({
            targetUid: targetUid,
            senderUid: currentUser.uid,
            senderName: currentUser.displayName,
            senderPhoto: currentUser.photoURL,
            type: data.type,
            momentId: data.momentId || null,
            text: data.text || '',
            isRead: false,
            createdAt: new Date().toISOString()
        });
    },

    // Bildirimleri Dinle
    onNotifications(uid, callback) {
        return db.collection('notifications')
            .where('targetUid', '==', uid)
            .limit(50)
            .onSnapshot(
                snapshot => {
                    const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    // Sort client-side to avoid composite index
                    notifications.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
                    callback(notifications);
                },
                error => {
                    console.error('Notification listener error:', error);
                    callback([]);
                }
            );
    },

    // Bildirimleri Okundu İşaretle
    async markNotificationsAsRead(uid) {
        const snapshot = await db.collection('notifications')
            .where('targetUid', '==', uid)
            .where('isRead', '==', false)
            .get();

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { isRead: true });
        });
        return batch.commit();
    },

    // Tek Bildirim Sil
    async deleteNotification(notifId) {
        return db.collection('notifications').doc(notifId).delete();
    },

    // Tüm Bildirimleri Temizle
    async clearAllNotifications(uid) {
        const snapshot = await db.collection('notifications')
            .where('targetUid', '==', uid)
            .get();

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        return batch.commit();
    },

    // Kullanıcı Adı Müsait mi?
    async checkUsernameAvailability(username) {
        const doc = await db.collection('usernames').doc(username.toLowerCase()).get();
        return !doc.exists;
    },

    // Kullanıcı Adı Değiştir
    async changeUsername(uid, newUsername) {
        const user = auth.currentUser;
        if (!user || user.uid !== uid) throw new Error("Yetkisiz işlem!");

        const lowerNew = newUsername.toLowerCase();
        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();
        const oldUsername = userDoc.data().username;

        return db.runTransaction(async (transaction) => {
            const usernameRef = db.collection('usernames').doc(lowerNew);
            const usernameDoc = await transaction.get(usernameRef);

            if (usernameDoc.exists) throw new Error("Bu kullanıcı adı zaten alınmış!");

            if (oldUsername) {
                transaction.delete(db.collection('usernames').doc(oldUsername.toLowerCase()));
            }

            transaction.set(usernameRef, { uid: uid });
            transaction.update(userRef, { username: newUsername });
        });
    },

    // Kullanıcı Adı Kaydet
    async registerUsername(username, uid) {
        const lowerUsername = username.toLowerCase();
        return db.collection('usernames').doc(lowerUsername).set({ uid: uid });
    },

    // Kullanıcı Adı Serbest Bırak
    async releaseUsername(username) {
        const lowerUsername = username.toLowerCase();
        return db.collection('usernames').doc(lowerUsername).delete();
    },

    // Kullanıcı Ara
    async searchUsers(query) {
        if (!query) return [];
        const snapshot = await db.collection('users')
            .where('username', '>=', query)
            .where('username', '<=', query + '\uf8ff')
            .limit(10)
            .get();

        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    // Koleksiyon (Journal) Oluştur
    async createJournal(title, coverEmoji) {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        return db.collection('journals').add({
            userId: user.uid,
            title: title,
            coverEmoji: coverEmoji || '📁',
            createdAt: new Date().toISOString()
        });
    },

    // Kullanıcının Koleksiyonlarını Getir
    async getJournals(uid) {
        const snapshot = await db.collection('journals')
            .where('userId', '==', uid)
            .orderBy('createdAt', 'desc')
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    // Koleksiyon İçindeki Anıları Getir
    async getMomentsByJournal(journalId) {
        const snapshot = await db.collection('moments')
            .where('journalId', '==', journalId)
            .orderBy('createdAt', 'desc')
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    // Koleksiyona Üye Ekle (Collaborative)
    async inviteToJournal(journalId, invitedUid) {
        const user = auth.currentUser;
        if (!user) throw new Error("Giriş yapmalısınız!");

        const journalRef = db.collection('journals').doc(journalId);
        return db.runTransaction(async (transaction) => {
            const doc = await transaction.get(journalRef);
            if (!doc.exists) throw new Error("Koleksiyon bulunamadı.");

            const data = doc.data();
            if (data.userId !== user.uid && !data.members?.includes(user.uid)) {
                throw new Error("Yetkisiz işlem!");
            }

            const members = data.members || [];
            if (!members.includes(invitedUid)) {
                members.push(invitedUid);
                transaction.update(journalRef, { members: members });

                // Add notification
                await this.addNotification(invitedUid, {
                    type: 'collab_invite',
                    text: `\${user.displayName} sizi "\${data.title}" koleksiyonuna davet etti!`,
                    momentId: journalId
                });
            }
        });
    },

    // Alias for createMoment (backwards compatibility)
    createMoment: async function (data) {
        return this.addMoment(data);
    }
};
