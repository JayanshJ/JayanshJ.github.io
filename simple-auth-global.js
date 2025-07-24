// Global auth functions for HTML onclick handlers
// This is a non-module version to ensure compatibility with GitHub Pages

let isAuthenticated = false;
let currentUser = null;

// Initialize auth state when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Retry mechanism to wait for Firebase modules to load
    let retryCount = 0;
    const maxRetries = 10;
    
    function initializeFirebaseAuth() {
        if (typeof window.authFunctions !== 'undefined' && window.authFunctions) {
            // Listen for Firebase auth state changes
            window.authFunctions.onAuthStateChanged((user) => {
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
        } else {
            retryCount++;
            if (retryCount < maxRetries) {
                console.log(`Firebase not ready yet, retrying... (${retryCount}/${maxRetries})`);
                setTimeout(initializeFirebaseAuth, 500);
            } else {
                console.warn('Firebase authFunctions not available after maximum retries');
                console.warn('Authentication features will be disabled');
                // Update UI to show that auth is not available
                updateSettingsAuthUI();
            }
        }
    }
    
    // Start trying to initialize Firebase auth
    setTimeout(initializeFirebaseAuth, 100);
});

// Global functions for HTML onclick handlers
window.showAuthModal = function() {
    const modal = document.getElementById('authModal');
    if (modal) {
        // Check if Firebase is available and update modal content accordingly
        if (typeof window.authFunctions === 'undefined' || !window.authFunctions) {
            // Show message about Firebase not being configured
            const authError = document.getElementById('authError');
            if (authError) {
                authError.innerHTML = 'Authentication requires Firebase configuration. Please see README.md for setup instructions.';
                authError.style.display = 'block';
            }
            // Disable auth buttons
            const submitBtn = document.getElementById('authSubmitBtn');
            const googleBtn = document.querySelector('.social-btn.google');
            if (submitBtn) submitBtn.disabled = true;
            if (googleBtn) googleBtn.disabled = true;
        } else {
            // Firebase is available, enable buttons
            const submitBtn = document.getElementById('authSubmitBtn');
            const googleBtn = document.querySelector('.social-btn.google');
            if (submitBtn) submitBtn.disabled = false;
            if (googleBtn) googleBtn.disabled = false;
            clearAuthError();
        }
        
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
        if (typeof window.authFunctions !== 'undefined' && window.authFunctions) {
            if (isSignUp) {
                result = await window.authFunctions.signUpWithEmail(email, password);
            } else {
                result = await window.authFunctions.signInWithEmail(email, password);
            }
            
            if (result.success) {
                closeAuthModal();
                console.log('User authenticated successfully');
            } else {
                showAuthError(result.error);
            }
        } else {
            showAuthError('Authentication system not available');
        }
    } catch (error) {
        showAuthError('Authentication failed. Please try again.');
        console.error('Auth error:', error);
    }
};

window.handleGoogleAuth = async function() {
    try {
        if (typeof window.authFunctions !== 'undefined' && window.authFunctions) {
            const result = await window.authFunctions.signInWithGoogle();
            
            if (result.success) {
                closeAuthModal();
                console.log('Google authentication successful');
            } else {
                showAuthError(result.error);
            }
        } else {
            showAuthError('Authentication system not available');
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
        if (typeof window.authFunctions !== 'undefined' && window.authFunctions) {
            const result = await window.authFunctions.signOut();
            
            if (result.success) {
                closeUserProfileModal();
                console.log('User signed out successfully');
            } else {
                console.error('Sign out error:', result.error);
            }
        } else {
            console.error('Authentication system not available');
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