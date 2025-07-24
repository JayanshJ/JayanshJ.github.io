// Minimal Firebase config - only for client-side auth
// All data operations go through secure API endpoints

// Import Firebase Auth SDK
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Minimal config - only what's needed for client auth
const firebaseConfig = {
    apiKey: "AIzaSyDhz3dQ_lHVaX0k53XUS3T-4TL0Y9nNaAk",
    authDomain: "ai-app-daeda.firebaseapp.com",
    projectId: "ai-app-daeda"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Make Firebase Auth available globally for the secure client
window.firebase = {
    auth: () => auth,
    auth: {
        GoogleAuthProvider: () => new (await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js')).GoogleAuthProvider(),
        signInWithEmailAndPassword: async (auth, email, password) => {
            const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            return signInWithEmailAndPassword(auth, email, password);
        },
        createUserWithEmailAndPassword: async (auth, email, password) => {
            const { createUserWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            return createUserWithEmailAndPassword(auth, email, password);
        },
        signInWithPopup: async (auth, provider) => {
            const { signInWithPopup } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            return signInWithPopup(auth, provider);
        },
        onAuthStateChanged: async (auth, callback) => {
            const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            return onAuthStateChanged(auth, callback);
        }
    }
};

console.log('Firebase client-side auth initialized');