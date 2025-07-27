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
            // Check for any pending redirect results (mobile or desktop)
            const wasRedirectInitiated = localStorage.getItem('google_auth_initiated');
            
            if (wasRedirectInitiated) {
                console.log('🔄 Redirect was initiated - checking for result...');
                window.authFunctions.handleInitialRedirectResult()
                    .then(result => {
                        if (result && result.success) {
                            console.log('✅ Redirect authentication successful');
                        } else if (result && result.error) {
                            // Don't show error immediately - auth state listener might handle it
                            if (result.error.includes('waiting for auth state')) {
                                console.log('⏳ Waiting for auth state listener to handle redirect...');
                            } else {
                                console.warn('❌ Redirect authentication failed:', result.error);
                                
                                // For mobile users with failed redirects, offer popup fallback
                                const wasMobileAttempt = localStorage.getItem('mobile_auth_attempt');
                                if (wasMobileAttempt && result.error.includes('No redirect result')) {
                                    console.log('📱 Mobile redirect failed, will offer popup fallback');
                                    setTimeout(() => {
                                        const stillHasFlags = localStorage.getItem('google_auth_initiated');
                                        if (stillHasFlags) {
                                            console.log('🔄 Attempting popup fallback for mobile...');
                                            showMobilePopupFallback();
                                        }
                                    }, 3000); // Reduced to 3 seconds for faster fallback
                                } else {
                                    // Show error after a delay to let auth state listener try first
                                    setTimeout(() => {
                                        const stillHasFlags = localStorage.getItem('google_auth_initiated');
                                        if (stillHasFlags) {
                                            console.log('🚨 Auth state listener didn\'t handle redirect, showing error');
                                            showRedirectError(result.error);
                                            // Clean up failed redirect flags
                                            localStorage.removeItem('google_auth_initiated');
                                            localStorage.removeItem('auth_redirect_timestamp');
                                        }
                                    }, 3000); // Wait 3 seconds for auth state
                                }
                            }
                        }
                    })
                    .catch(error => {
                        console.warn('❌ Redirect check failed:', error);
                        // Don't immediately show error - give auth state listener a chance
                        setTimeout(() => {
                            const stillHasFlags = localStorage.getItem('google_auth_initiated');
                            if (stillHasFlags) {
                                console.log('🚨 Auth state listener didn\'t handle redirect error, cleaning up');
                                localStorage.removeItem('google_auth_initiated');
                                localStorage.removeItem('auth_redirect_timestamp');
                            }
                        }, 5000);
                    });
            } else {
                // Always check for redirect results just in case
                console.log('🔍 Checking for any redirect results...');
                window.authFunctions.handleInitialRedirectResult()
                    .catch(error => {
                        // Silently handle - this is expected if no redirect occurred
                        console.log('No redirect result (expected)');
                    });
            }
            
            // Listen for Firebase auth state changes
            window.authFunctions.onAuthStateChanged((user) => {
                if (user) {
                    isAuthenticated = true;
                    currentUser = {
                        email: user.email,
                        provider: user.providerData?.[0]?.providerId === 'google.com' ? 'Google' : 
                                 user.providerData?.[0]?.providerId === 'apple.com' ? 'Apple' : 'Email/Password',
                        displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'User'),
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
        console.log('🔐 Starting Google authentication from UI...');
        
        if (typeof window.authFunctions !== 'undefined' && window.authFunctions) {
            console.log('✅ Auth functions available, calling signInWithGoogle...');
            
            // Enhanced mobile detection
            const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
            const isSmallScreen = window.innerWidth <= 768;
            const isMobile = isMobileUA || isTouchDevice || isSmallScreen;
            
            console.log('🔐 Mobile detection in UI:', {
                userAgent: isMobileUA,
                touchDevice: isTouchDevice, 
                smallScreen: isSmallScreen,
                isMobile: isMobile,
                width: window.innerWidth
            });
            
            // Show enhanced loading state
            const googleBtn = document.querySelector('.social-btn.google');
            if (googleBtn) {
                googleBtn.disabled = true;
                if (isMobile) {
                    googleBtn.innerHTML = 'Opening popup... 📱';
                    console.log('📱 Mobile login initiated - showing popup message');
                } else {
                    googleBtn.innerHTML = 'Signing in... ⏳';
                }
            }
            
            const result = await window.authFunctions.signInWithGoogle();
            console.log('📥 Auth result received:', result);
            
            if (result.success && !result.pending) {
                closeAuthModal();
                console.log('✅ Google authentication successful');
                
                // Show success message briefly
                if (googleBtn) {
                    googleBtn.innerHTML = 'Success! ✅';
                }
            } else if (result.pending) {
                console.log('⏳ Authentication pending (redirect in progress)');
                
                if (isMobile) {
                    // Mobile popup fallback to redirect - show guidance
                    const authError = document.getElementById('authError');
                    if (authError) {
                        authError.innerHTML = '🔄 Popup blocked - redirecting to Google... Complete sign-in and return to this page.';
                        authError.style.display = 'block';
                        authError.style.backgroundColor = '#1f2937';
                        authError.style.color = '#60a5fa';
                        authError.style.border = '1px solid #3b82f6';
                    }
                    
                    if (googleBtn) {
                        googleBtn.innerHTML = 'Redirecting... Please wait ⏳';
                    }
                    
                    console.log('📱 Mobile fallback redirect pending - showing user guidance');
                    
                    // Keep modal open longer on mobile to show instructions
                    setTimeout(() => {
                        closeAuthModal();
                    }, 3000);
                } else {
                    closeAuthModal();
                }
            } else {
                console.error('❌ Google auth failed:', result.error);
                showAuthError(result.error || 'Google sign-in failed');
                resetGoogleButton(googleBtn);
            }
        } else {
            console.error('❌ Auth functions not available');
            showAuthError('Authentication system not available');
            resetGoogleButton(googleBtn);
        }
    } catch (error) {
        console.error('💥 Google auth error:', error);
        showAuthError('Google sign-in failed. Please try again.');
        resetGoogleButton(document.querySelector('.social-btn.google'));
    }
};

function resetGoogleButton(googleBtn) {
    if (googleBtn) {
        googleBtn.disabled = false;
        googleBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>Continue with Google';
    }
}

window.handleAppleAuth = async function() {
    try {
        if (typeof window.authFunctions !== 'undefined' && window.authFunctions) {
            const result = await window.authFunctions.signInWithApple();
            
            if (result.success) {
                closeAuthModal();
                console.log('Apple authentication successful');
            } else {
                showAuthError(result.error);
            }
        } else {
            showAuthError('Authentication system not available');
        }
    } catch (error) {
        showAuthError('Apple sign-in failed. Please try again.');
        console.error('Apple auth error:', error);
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
            userNameInSettings.textContent = currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : 'User');
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

function showRedirectError(errorMessage) {
    // Show a non-intrusive notification for redirect errors
    try {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #ef4444, #dc2626);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            max-width: 300px;
            animation: slideInRight 0.3s ease-out;
        `;
        errorDiv.innerHTML = `❌ Login failed: ${errorMessage}`;
        
        document.body.appendChild(errorDiv);
        
        // Remove after 5 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.remove();
            }
        }, 5000);
    } catch (error) {
        console.log('Could not show redirect error:', error);
    }
}

window.showMobilePopupFallback = function showMobilePopupFallback() {
    // Show a notification offering popup fallback for mobile users
    try {
        const fallbackDiv = document.createElement('div');
        fallbackDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #3b82f6, #1d4ed8);
            color: white;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            max-width: 350px;
            animation: slideInRight 0.3s ease-out;
            cursor: pointer;
        `;
        fallbackDiv.innerHTML = `
            📱 Mobile login redirect failed<br>
            <small style="opacity: 0.9;">Tap here to try popup method instead</small>
        `;
        
        fallbackDiv.onclick = async () => {
            console.log('📱 User clicked mobile popup fallback');
            fallbackDiv.innerHTML = '⏳ Trying popup method...';
            
            try {
                // Clean up redirect flags first
                localStorage.removeItem('google_auth_initiated');
                localStorage.removeItem('auth_redirect_timestamp');
                localStorage.removeItem('mobile_auth_attempt');
                localStorage.removeItem('auth_user_agent');
                localStorage.removeItem('auth_current_domain');
                
                // Try popup method directly
                if (typeof window.authFunctions !== 'undefined' && window.authFunctions) {
                    const auth = firebase.auth();
                    const provider = new firebase.auth.GoogleAuthProvider();
                    provider.addScope('profile');
                    provider.addScope('email');
                    
                    const result = await auth.signInWithPopup(provider);
                    if (result && result.user) {
                        fallbackDiv.innerHTML = '✅ Success!';
                        setTimeout(() => fallbackDiv.remove(), 2000);
                        console.log('✅ Mobile popup fallback successful');
                    }
                }
            } catch (popupError) {
                console.error('❌ Mobile popup fallback failed:', popupError);
                fallbackDiv.innerHTML = '❌ Popup also failed.<br><small>Try opening the login page again</small>';
                setTimeout(() => fallbackDiv.remove(), 5000);
                
                // Show manual refresh option
                showManualRefreshOption();
            }
        };
        
        document.body.appendChild(fallbackDiv);
        
        // Remove after 15 seconds if not clicked
        setTimeout(() => {
            if (fallbackDiv.parentNode) {
                fallbackDiv.remove();
            }
        }, 15000);
    } catch (error) {
        console.log('Could not show mobile popup fallback:', error);
    }
}

function showManualRefreshOption() {
    try {
        const refreshDiv = document.createElement('div');
        refreshDiv.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: linear-gradient(135deg, #f59e0b, #d97706);
            color: white;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            max-width: 350px;
            animation: slideInRight 0.3s ease-out;
            cursor: pointer;
        `;
        refreshDiv.innerHTML = `
            🔄 Try Manual Login<br>
            <small style="opacity: 0.9;">Tap to clear state and try again</small>
        `;
        
        refreshDiv.onclick = () => {
            // Clear all auth states
            localStorage.clear();
            
            // Reload the page to start fresh
            window.location.reload();
        };
        
        document.body.appendChild(refreshDiv);
        
        // Remove after 20 seconds
        setTimeout(() => {
            if (refreshDiv.parentNode) {
                refreshDiv.remove();
            }
        }, 20000);
    } catch (error) {
        console.log('Could not show manual refresh option:', error);
    }
}