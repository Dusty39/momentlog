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
    // Profili Güncelle
    updateProfile: (data) => {
        const user = auth.currentUser;
        if (user) {
            return user.updateProfile(data);
        }
        return Promise.reject("Kullanıcı bulunamadı");
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
            const profile = doc.data();
            // Security cleanup: Remove email if it somehow still exists in public profile
            if (profile.email) delete profile.email;
            return profile;
        } else {
            // Only create profile if it's the current user
            const user = auth.currentUser;
            if (user && user.uid === uid) {
                const newUser = {
                    uid: user.uid,
                    displayName: user.displayName || 'İsimsiz',
                    photoURL: user.photoURL || '👤',
                    bio: 'Merhaba, ben momentLog kullanıyorum!',
                    username: null,
                    isVerified: false,
                    isPrivateProfile: false,
                    followers: [],
                    following: [],
                    pendingFollowers: [],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                // Store sensitive data separately
                const privateData = {
                    email: user.email,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                // Auto-verify first 20 Google users
                const isGoogleUser = user.providerData.some(p => p.providerId === 'google.com');
                const verifiedSnap = await db.collection('users').where('isVerified', '==', true).get();
                if (isGoogleUser && verifiedSnap.size < 20) {
                    newUser.isVerified = true;
                }

                await docRef.set(newUser);
                await docRef.collection('private').doc('config').set(privateData);

                return newUser;
            }
            return null;
        }
    },

    // Kullanıcı Profilini Güncelle
    async updateUserProfile(uid, data) {
        return db.collection('users').doc(uid).update(data);
    },

    // Tüm anılardaki kullanıcı bilgilerini güncelle
    async syncUserMoments(uid, updateData) {
        const snapshots = await db.collection('moments').where('userId', '==', uid).get();
        if (snapshots.empty) return;

        const dataToSync = {};
        if (updateData.username) dataToSync.userDisplayName = updateData.username;
        else if (updateData.displayName) dataToSync.userDisplayName = updateData.displayName;
        if (updateData.photoURL) dataToSync.userPhotoURL = updateData.photoURL;
        if (updateData.isVerified !== undefined) dataToSync.isVerified = updateData.isVerified;

        if (Object.keys(dataToSync).length === 0) return;

        // Process in batches of 500 (Firestore limit)
        const docs = snapshots.docs;
        for (let i = 0; i < docs.length; i += 500) {
            const batch = db.batch();
            const chunk = docs.slice(i, i + 500);
            chunk.forEach(doc => {
                batch.update(doc.ref, dataToSync);
            });
            await batch.commit();
        }
    },

    // Profil Fotoğrafı - Base64 olarak döndür (Storage yerine Firestore'da sakla)
    async uploadProfilePhoto(uid, base64Data) {
        // Firebase Storage kullanmıyoruz, base64'ü direkt döndür
        return base64Data;
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

    // Dosya Yükle (Storage) - Disabled for cost saving, using optimized Base64
    uploadMedia: async (fileData, type) => {
        return null;
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
            createdAt: data.createdAt || new Date().toISOString()
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
    getMyMoments: async (lastVisible = null) => {
        const user = auth.currentUser;
        if (!user) return { moments: [], lastVisible: null };

        try {
            let query = db.collection('moments')
                .where('userId', '==', user.uid)
                .orderBy('createdAt', 'desc');

            if (lastVisible) {
                query = query.startAfter(lastVisible);
            }

            const snapshot = await query.limit(5).get();
            const moments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const lastDoc = snapshot.docs[snapshot.docs.length - 1];

            // Enrich with fresh profile
            const profileDoc = await db.collection('users').doc(user.uid).get();
            const profile = profileDoc.exists ? profileDoc.data() : null;

            return {
                moments: moments.map(m => ({
                    ...m,
                    userDisplayName: profile?.username || profile?.displayName || m.userDisplayName || 'Anonim',
                    userPhotoURL: profile?.photoURL || m.userPhotoURL || '👤',
                    isEarlyUser: profile?.isEarlyUser || false
                })),
                lastVisible: lastDoc
            };
        } catch (e) {
            console.error("Personal Feed error:", e);
            return { moments: [], lastVisible: null };
        }
    },

    // Belirli Bir Kullanıcının Anılarını Getir
    async getMomentsByUser(uid, lastVisible = null) {
        const currentUser = auth.currentUser;
        try {
            let query = db.collection('moments').where('userId', '==', uid);

            // If not own profile, only show public moments to avoid security rule errors
            if (!currentUser || currentUser.uid !== uid) {
                query = query.where('isPublic', '==', true);
            }

            query = query.orderBy('createdAt', 'desc');

            if (lastVisible) {
                query = query.startAfter(lastVisible);
            }

            const snapshot = await query.limit(5).get();
            const moments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const lastDoc = snapshot.docs[snapshot.docs.length - 1];

            // Enrich with fresh profile
            const profileDoc = await db.collection('users').doc(uid).get();
            const profile = profileDoc.exists ? profileDoc.data() : null;

            return {
                moments: moments.map(m => ({
                    ...m,
                    userDisplayName: profile?.username || profile?.displayName || m.userDisplayName || 'Anonim',
                    userPhotoURL: profile?.photoURL || m.userPhotoURL || '👤',
                    isEarlyUser: profile?.isEarlyUser || false
                })),
                lastVisible: lastDoc
            };
        } catch (e) {
            console.error("User Feed error:", e);
            throw e;
        }
    },

    // Tek bir anıyı getir
    getMomentById: async (id) => {
        try {
            const doc = await db.collection('moments').doc(id).get();
            if (!doc.exists) return null;
            return { id: doc.id, ...doc.data() };
        } catch (e) {
            console.error("Get Moment error:", e);
            return null;
        }
    },
    // Anı Sil
    deleteMoment: async (id) => {
        return db.collection('moments').doc(id).delete();
    },

    // Takip Edilenlerin Anılarını Getir (Following Feed)
    async getFollowingMoments(lastVisible = null) {
        try {
            const currentUser = auth.currentUser;
            if (!currentUser) return { moments: [], lastVisible: null };

            // Get user's following list
            const userDoc = await db.collection('users').doc(currentUser.uid).get();
            let following = userDoc.data()?.following || [];

            // Include current user's own posts in the feed
            if (!following.includes(currentUser.uid)) {
                following = [currentUser.uid, ...following];
            }

            if (following.length === 0) {
                return { moments: [], lastVisible: null };
            }

            // Firestore 'in' query supports max 10 items, so chunk if needed
            const chunks = [];
            for (let i = 0; i < following.length; i += 10) {
                chunks.push(following.slice(i, i + 10));
            }

            let allDocs = [];
            for (const chunk of chunks) {
                let query = db.collection('moments')
                    .where('userId', 'in', chunk)
                    .where('isPublic', '==', true)
                    .orderBy('createdAt', 'desc')
                    .limit(5);

                if (lastVisible) {
                    query = query.startAfter(lastVisible);
                }

                const snapshot = await query.get();
                allDocs = [...allDocs, ...snapshot.docs];
            }

            // Sort by createdAt and take the latest 5 globally - Robust handling for mixed types
            allDocs.sort((a, b) => {
                const aTime = a.data().createdAt;
                const bTime = b.data().createdAt;

                const getVal = (v) => {
                    if (!v) return 0;
                    if (typeof v === 'string') return new Date(v).getTime();
                    if (v.seconds) return v.seconds * 1000;
                    return Number(v);
                };

                return getVal(bTime) - getVal(aTime);
            });

            const pagedDocs = allDocs.slice(0, 5);
            const moments = pagedDocs.map(doc => ({ id: doc.id, ...doc.data() }));
            const lastDoc = pagedDocs[pagedDocs.length - 1] || null;

            if (moments.length === 0) return { moments: [], lastVisible: null };

            // Enrich with user profiles
            const userIds = [...new Set(moments.map(m => m.userId).filter(Boolean))];
            const userProfiles = {};
            await Promise.all(userIds.map(async (uid) => {
                try {
                    const profileDoc = await db.collection('users').doc(uid).get();
                    if (profileDoc.exists) userProfiles[uid] = profileDoc.data();
                } catch (e) { console.warn('Could not fetch user:', uid); }
            }));

            return {
                moments: moments.map(m => ({
                    ...m,
                    userDisplayName: userProfiles[m.userId]?.username || userProfiles[m.userId]?.displayName || m.userDisplayName || 'Anonim',
                    userPhotoURL: userProfiles[m.userId]?.photoURL || m.userPhotoURL || '👤',
                    isVerified: userProfiles[m.userId]?.isVerified || false,
                    isEarlyUser: userProfiles[m.userId]?.isEarlyUser || false
                })),
                lastVisible: lastDoc
            };
        } catch (e) {
            console.error("Following Feed error:", e);
            return { moments: [], lastVisible: null };
        }
    },

    // Genel Anıları Getir (Social Feed)
    async getPublicMoments(lastVisible = null) {
        try {
            let query = db.collection('moments')
                .where('isPublic', '==', true)
                .where('isPrivateProfile', '==', false)
                .orderBy('createdAt', 'desc');

            if (lastVisible) {
                query = query.startAfter(lastVisible);
            }

            const snapshot = await query.get();
            const user = auth.currentUser;

            // Filter out current user's moments and limit to 5
            const moments = snapshot.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(m => !user || m.userId !== user.uid)
                .slice(0, 5);

            const lastDoc = snapshot.docs[snapshot.docs.length - 1];

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
            return {
                moments: moments.map(m => {
                    const profile = userProfiles[m.userId];
                    return {
                        ...m,
                        userDisplayName: profile?.username || profile?.displayName || m.userDisplayName || 'Anonim',
                        userPhotoURL: profile?.photoURL || m.userPhotoURL || '👤',
                        isVerified: profile?.isVerified || false,
                        isEarlyUser: profile?.isEarlyUser || false
                    };
                }),
                lastVisible: lastDoc
            };
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

        // Get user profile for username
        const userDoc = await db.collection('users').doc(user.uid).get();
        const userProfile = userDoc.exists ? userDoc.data() : {};

        const commentData = {
            userId: user.uid,
            username: userProfile.username || '',
            userDisplayName: userProfile.displayName || user.displayName || 'Anonim',
            userPhoto: userProfile.photoURL || user.photoURL || '👤',
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

            // Logic for Early Verified Badge: First 20 Google Users
            let isVerified = userDoc.data()?.isVerified || false;

            if (!isVerified) {
                const isGoogleUser = user.providerData.some(p => p.providerId === 'google.com');
                // Check current verified count
                const verifiedSnap = await db.collection('users').where('isVerified', '==', true).get();
                if (isGoogleUser && verifiedSnap.size < 20) {
                    isVerified = true;
                    console.log("[DBService] Granting Early Verifier Badge!");
                }
            }

            transaction.set(usernameRef, { uid: uid });
            transaction.update(userRef, {
                username: newUsername,
                isVerified: isVerified
            });
            return isVerified;
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
