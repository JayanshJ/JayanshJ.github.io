// Minimal Firebase config - only for client-side auth
// All data operations go through secure API endpoints

// Wait for Firebase compat to be loaded
document.addEventListener('DOMContentLoaded', function() {
    // Minimal config - only what's needed for client auth
    const firebaseConfig = {
        apiKey: "AIzaSyDhz3dQ_lHVaX0k53XUS3T-4TL0Y9nNaAk",
        authDomain: "ai-app-daeda.firebaseapp.com",
        projectId: "ai-app-daeda"
    };

    // Initialize Firebase using compat version
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        
        // Make Firebase Auth available globally
        window.firebaseAuth = firebase.auth();
        window.firebaseAuthProvider = firebase.auth;
        
        console.log('✅ Firebase compat auth initialized');
    } else {
        console.error('❌ Firebase compat not loaded');
    }
});