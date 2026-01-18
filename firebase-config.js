// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDpXGB1z3sr0JcIknVBaSVtI8c67IjvSzM",
    // Use the current domain for auth if we are on the custom domain (prevents redirect loops)
    authDomain: window.location.hostname === 'momentlog.com.tr' || window.location.hostname === 'www.momentlog.com.tr'
        ? "momentlog.com.tr"
        : "momentlog-social.firebaseapp.com",
    projectId: "momentlog-social",
    storageBucket: "momentlog-social.firebasestorage.app",
    messagingSenderId: "644402735978",
    appId: "1:644402735978:web:4eb212c3857d654e7fd313"
};

// Initialize Firebase (will be done in firebase-service.js)
// firebase.initializeApp(firebaseConfig);
