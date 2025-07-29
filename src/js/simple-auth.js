// Real Firebase authentication integration
import { authFunctions } from './firebase-config.js';

let isAuthenticated = false;
let currentUser = null;

// Initialize auth state in settings
document.addEventListener('DOMContentLoaded', function() {
    // Listen for Firebase auth state changes
    authFunctions.onAuthStateChanged((user) => {
        if (user) {
            isAuthenticated = true;
            currentUser = {
                email: user.email,
                provider: user.providerData[0]?.providerId === 'google.com' ? 'Google' : 'Email/Password',
                displayName: user.displayName || user.email.split('@')[0],
                uid: user.uid
            };
        } else {
            isAuthenticated = false;
            currentUser = null;
        }
        updateSettingsAuthUI();
    });
    console.log('Firebase auth initialized - listening for auth state changes');
});

// Global functions for HTML onclick handlers
window.showAuthModal = function() {
    const modal = document.getElementById('authModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
};

window.closeAuthModal = function() {
    const modal = document.getElementById('authModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
    clearAuthError();
    clearAuthForm();
};

window.switchAuthTab = function(mode) {
    const tabs = document.querySelectorAll('.auth-tab');
    const title = document.getElementById('authModalTitle');
    const submitBtn = document.getElementById('authSubmitBtn');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    document.querySelector(`[onclick="switchAuthTab('${mode}')"]`).classList.add('active');
    
    if (mode === 'signin') {
        title.textContent = '🔐 Sign In';
        submitBtn.textContent = 'Sign In';
    } else {
        title.textContent = '🔐 Sign Up';
        submitBtn.textContent = 'Sign Up';
    }
    
    clearAuthError();
};

window.handleEmailAuth = async function() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    
    if (!email || !password) {
        showAuthError('Please fill in all fields');
        return;
    }
    
    // Check if this is sign in or sign up based on active tab
    const isSignUp = document.querySelector('.auth-tab.active').textContent.trim() === 'Sign Up';
    
    try {
        let result;
        if (isSignUp) {
            result = await authFunctions.signUpWithEmail(email, password);
        } else {
            result = await authFunctions.signInWithEmail(email, password);
        }
        
        if (result.success) {
            closeAuthModal();
            console.log('User authenticated successfully');
        } else {
            showAuthError(result.error);
        }
    } catch (error) {
        showAuthError('Authentication failed. Please try again.');
        console.error('Auth error:', error);
    }
};

window.handleGoogleAuth = async function() {
    try {
        const result = await authFunctions.signInWithGoogle();
        
        if (result.success) {
            closeAuthModal();
            console.log('Google authentication successful');
        } else {
            showAuthError(result.error);
        }
    } catch (error) {
        showAuthError('Google sign-in failed. Please try again.');
        console.error('Google auth error:', error);
    }
};

window.showUserProfileModal = function() {
    const modal = document.getElementById('userProfileModal');
    if (modal && currentUser) {
        // Update user info in modal
        document.getElementById('userEmail').textContent = currentUser.email;
        document.getElementById('userProvider').textContent = `Signed in with ${currentUser.provider}`;
        
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
};

window.closeUserProfileModal = function() {
    const modal = document.getElementById('userProfileModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
};

window.handleSignOut = async function() {
    try {
        const result = await authFunctions.signOut();
        
        if (result.success) {
            closeUserProfileModal();
            console.log('User signed out successfully');
        } else {
            console.error('Sign out error:', result.error);
        }
    } catch (error) {
        console.error('Sign out error:', error);
    }
};

// Helper functions

function updateSettingsAuthUI() {
    const signInBtn = document.getElementById('signInBtn');
    const userProfileBtn = document.getElementById('userProfileBtn');
    const userNameInSettings = document.getElementById('userNameInSettings');
    const userEmailInSettings = document.getElementById('userEmailInSettings');
    const userIconInSettings = document.getElementById('userIconInSettings');
    
    if (isAuthenticated && currentUser) {
        // Show user profile button, hide sign-in button
        if (signInBtn) signInBtn.style.display = 'none';
        if (userProfileBtn) userProfileBtn.style.display = 'block';
        
        // Update user info in settings
        if (userNameInSettings) {
            userNameInSettings.textContent = currentUser.displayName || currentUser.email.split('@')[0];
        }
        if (userEmailInSettings) {
            userEmailInSettings.textContent = currentUser.email;
        }
        if (userIconInSettings) {
            userIconInSettings.textContent = currentUser.displayName.charAt(0).toUpperCase();
        }
    } else {
        // Show sign-in button, hide user profile button
        if (signInBtn) signInBtn.style.display = 'block';
        if (userProfileBtn) userProfileBtn.style.display = 'none';
    }
}

function showAuthError(message) {
    const errorDiv = document.getElementById('authError');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

function clearAuthError() {
    const errorDiv = document.getElementById('authError');
    if (errorDiv) {
        errorDiv.style.display = 'none';
        errorDiv.textContent = '';
    }
}

function clearAuthForm() {
    const emailInput = document.getElementById('authEmail');
    const passwordInput = document.getElementById('authPassword');
    
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
}