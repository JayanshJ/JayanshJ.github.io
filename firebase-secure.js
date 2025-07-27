// Secure Firebase client that uses serverless functions
// No Firebase credentials exposed to client!

// Initialize minimal Firebase config for auth only
const firebaseConfig = {
    apiKey: "AIzaSyDhz3dQ_lHVaX0k53XUS3T-4TL0Y9nNaAk",
    authDomain: "ai-app-daeda.firebaseapp.com",
    projectId: "ai-app-daeda",
    // Add persistence and session management
    persistenceEnabled: true
};

// Initialize Firebase with minimal config
firebase.initializeApp(firebaseConfig);

class SecureFirebaseClient {
    constructor() {
        // Use Vercel deployment URL for API calls
        this.apiBase = 'https://jgpteasy.vercel.app/api';
        this.currentUser = null;
        this.authListeners = [];
        this.redirectHandled = false;
    }

    // Authentication functions
    async signUpWithEmail(email, password) {
        try {
            const response = await fetch(`${this.apiBase}/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'signUp', email, password })
            });
            const result = await response.json();
            
            if (result.success) {
                // For simplicity, auto sign in after signup
                return await this.signInWithEmail(email, password);
            }
            return result;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async signInWithEmail(email, password) {
        try {
            // Use Firebase Auth client-side for sign in (this is safe)
            const auth = firebase.auth();
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            
            // Get ID token for API calls
            const idToken = await userCredential.user.getIdToken();
            localStorage.setItem('firebase_token', idToken);
            
            this.currentUser = {
                uid: userCredential.user.uid,
                email: userCredential.user.email,
                displayName: userCredential.user.displayName || (email ? email.split('@')[0] : 'User')
            };
            
            this.notifyAuthListeners(this.currentUser);
            return { success: true, user: this.currentUser };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async signInWithGoogle() {
        try {
            console.log('🔐 Starting Google sign in...');
            console.log('🌐 Current URL:', window.location.href);
            console.log('🏠 Current domain:', window.location.hostname);
            console.log('🔗 Current origin:', window.location.origin);
            console.log('📱 User agent:', navigator.userAgent);
            
            // Enhanced mobile detection
            const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
            const isSmallScreen = window.innerWidth <= 768;
            const isMobile = isMobileUA || isTouchDevice || isSmallScreen;
            
            console.log('📱 Mobile detection:', {
                userAgent: isMobileUA,
                touchDevice: isTouchDevice,
                smallScreen: isSmallScreen,
                isMobile: isMobile,
                width: window.innerWidth,
                maxTouchPoints: navigator.maxTouchPoints
            });
            
            // Check if domain is authorized - Enhanced for mobile and all deployment targets
            const authorizedDomains = [
                'github.io', 
                'vercel.app', 
                'localhost', 
                '127.0.0.1',
                'jayanshj.github.io',
                'jgpteasy.vercel.app',
                'jayansh-j-github-io.vercel.app',
                'jayansh-j-github-io-2.vercel.app',
                'new-gpt-taupe.vercel.app'
            ];
            const isAuthorizedDomain = authorizedDomains.some(domain => 
                window.location.hostname.includes(domain) || window.location.hostname === domain
            );
            
            console.log('🔍 Domain authorization check:', {
                currentDomain: window.location.hostname,
                authorizedDomains: authorizedDomains,
                isAuthorized: isAuthorizedDomain
            });
            
            if (!isAuthorizedDomain) {
                console.warn('⚠️ Domain mismatch! Current domain may not be authorized in Firebase Console');
                // Don't immediately fail on mobile - Firebase Console might have different domain settings
                if (isMobile) {
                    console.log('📱 Mobile detected - attempting authentication despite domain warning');
                } else {
                    return { 
                        success: false, 
                        error: `Domain ${window.location.hostname} not authorized in Firebase Console.` 
                    };
                }
            }
            
            const auth = firebase.auth();
            
            // Set persistence for mobile compatibility - use SESSION for better mobile support
            console.log('🔧 Setting auth persistence...');
            if (isMobile) {
                // Use SESSION persistence for mobile to ensure state survives redirects
                await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
                console.log('✅ Auth persistence set to SESSION for mobile');
            } else {
                await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
                console.log('✅ Auth persistence set to LOCAL for desktop');
            }
            
            const provider = new firebase.auth.GoogleAuthProvider();
            
            // Enhanced OAuth configuration for mobile compatibility
            provider.addScope('profile');
            provider.addScope('email');
            provider.addScope('openid'); // Explicitly request OpenID
            
            // Force redirect on mobile devices for better compatibility
            if (isMobile) {
                console.log('📱 Mobile device detected - using redirect method for better compatibility');
                try {
                    // Reset redirect handled flag for new attempt
                    this.redirectHandled = false;
                    
                    // Enhanced mobile redirect setup
                    localStorage.setItem('google_auth_initiated', 'true');
                    localStorage.setItem('auth_redirect_timestamp', Date.now().toString());
                    localStorage.setItem('mobile_auth_attempt', 'true');
                    localStorage.setItem('auth_user_agent', navigator.userAgent);
                    localStorage.setItem('auth_current_domain', window.location.hostname);
                    
                    // Enhanced mobile-specific provider settings
                    provider.setCustomParameters({
                        'prompt': 'select_account', // Use select_account for better UX (replaces approval_prompt)
                        'access_type': 'offline', // Use offline for better token persistence
                        'include_granted_scopes': 'true',
                        'response_type': 'code'
                        // Note: removed approval_prompt as it conflicts with prompt parameter
                    });
                    
                    console.log('🔄 Initiating mobile redirect with enhanced OAuth settings...');
                    console.log('🔧 Provider configuration:', {
                        scopes: provider.getScopes(),
                        customParameters: {
                            prompt: 'select_account',
                            access_type: 'offline',
                            include_granted_scopes: 'true',
                            response_type: 'code'
                        }
                    });
                    
                    await auth.signInWithRedirect(provider);
                    console.log('✅ Redirect initiated successfully, page will reload...');
                    return { success: true, pending: true };
                } catch (redirectError) {
                    console.error('❌ Mobile redirect failed:', redirectError);
                    console.error('❌ Redirect error details:', {
                        code: redirectError.code,
                        message: redirectError.message,
                        details: redirectError.details
                    });
                    
                    // Clean up on error
                    localStorage.removeItem('google_auth_initiated');
                    localStorage.removeItem('auth_redirect_timestamp');
                    localStorage.removeItem('mobile_auth_attempt');
                    localStorage.removeItem('auth_user_agent');
                    
                    // Try popup as fallback on mobile if redirect fails
                    console.log('🔄 Redirect failed, trying popup as fallback...');
                    try {
                        const fallbackResult = await auth.signInWithPopup(provider);
                        console.log('✅ Mobile popup fallback successful');
                        return await this.processAuthResult(fallbackResult);
                    } catch (popupError) {
                        console.error('❌ Mobile popup fallback also failed:', popupError);
                        throw new Error(`Mobile authentication failed: ${redirectError.message}. Popup fallback: ${popupError.message}`);
                    }
                }
            } else {
                // Desktop: try popup first, fallback to redirect
                console.log('🖥️ Desktop device - trying popup method');
                try {
                    const result = await auth.signInWithPopup(provider);
                    console.log('✅ Popup sign-in successful');
                    return await this.processAuthResult(result);
                } catch (popupError) {
                    console.error('❌ Popup sign-in failed:', popupError);
                    
                    if (popupError.code === 'auth/popup-blocked' || popupError.code === 'auth/popup-closed-by-user') {
                        console.log('🔄 Popup blocked/closed, trying redirect as fallback...');
                        localStorage.setItem('google_auth_initiated', 'true');
                        localStorage.setItem('auth_redirect_timestamp', Date.now().toString());
                        await auth.signInWithRedirect(provider);
                        return { success: true, pending: true };
                    } else {
                        throw popupError;
                    }
                }
            }
        } catch (error) {
            console.error('🚨 Google sign in error:', error);
            return { success: false, error: error.message };
        }
    }
    
    cleanupRedirectFlags() {
        localStorage.removeItem('google_auth_initiated');
        localStorage.removeItem('auth_redirect_timestamp');
        localStorage.removeItem('mobile_auth_attempt');
        localStorage.removeItem('auth_user_agent');
        localStorage.removeItem('auth_current_domain');
        this.redirectHandled = false;
    }
    
    async processAuthResult(result) {
        try {
            console.log('📋 Processing auth result:', result);
            
            if (!result || !result.user) {
                throw new Error('No user returned from authentication');
            }
            
            const idToken = await result.user.getIdToken();
            localStorage.setItem('firebase_token', idToken);
            
            // Clean up redirect flags
            this.cleanupRedirectFlags();
            
            const email = result.user.email || '';
            const displayName = result.user.displayName || (email ? email.split('@')[0] : 'User');
            
            this.currentUser = {
                uid: result.user.uid,
                email: email,
                displayName: displayName
            };
            
            console.log('✅ User authenticated successfully:', this.currentUser);
            this.notifyAuthListeners(this.currentUser);
            return { success: true, user: this.currentUser };
        } catch (error) {
            console.error('❌ Error processing auth result:', error);
            throw error;
        }
    }

    async signInWithApple() {
        try {
            console.log('Starting Apple sign in...');
            const auth = firebase.auth();
            const provider = new firebase.auth.OAuthProvider('apple.com');
            
            // Request additional scopes
            provider.addScope('email');
            provider.addScope('name');
            
            // Always use popup for better mobile compatibility
            console.log('🔧 Using popup method for Apple sign-in (better mobile compatibility)');
            
            let result;
            try {
                console.log('🍎 Starting Apple sign-in with popup...');
                result = await auth.signInWithPopup(provider);
                console.log('✅ Apple popup sign-in successful');
            } catch (popupError) {
                console.error('❌ Apple popup sign-in failed:', popupError);
                
                // Check if it's a popup blocked error
                if (popupError.code === 'auth/popup-blocked') {
                    console.log('🚫 Popup was blocked, trying redirect as fallback...');
                    try {
                        await auth.signInWithRedirect(provider);
                        console.log('✅ Apple redirect initiated, page will reload...');
                        return { success: true, pending: true };
                    } catch (redirectError) {
                        console.error('❌ Apple redirect also failed:', redirectError);
                        throw redirectError;
                    }
                } else {
                    throw popupError;
                }
            }
            
            console.log('Apple sign in result:', result);
            console.log('User object:', result.user);
            
            if (!result || !result.user) {
                throw new Error('No user returned from Apple sign in');
            }
            
            const idToken = await result.user.getIdToken();
            localStorage.setItem('firebase_token', idToken);
            
            // Safely extract email and displayName
            const email = result.user.email || '';
            const displayName = result.user.displayName || (email ? email.split('@')[0] : 'User');
            
            this.currentUser = {
                uid: result.user.uid,
                email: email,
                displayName: displayName
            };
            
            console.log('Created user object:', this.currentUser);
            this.notifyAuthListeners(this.currentUser);
            return { success: true, user: this.currentUser };
        } catch (error) {
            console.error('Apple sign in error:', error);
            return { success: false, error: error.message };
        }
    }

    async signOut() {
        try {
            await firebase.auth().signOut();
            localStorage.removeItem('firebase_token');
            this.currentUser = null;
            this.notifyAuthListeners(null);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    getCurrentUser() {
        console.log('🔍 getCurrentUser called, returning:', this.currentUser);
        return this.currentUser;
    }

    async handleInitialRedirectResult() {
        try {
            console.log('🔄 Checking for redirect result on page load...');
            
            // Check if we were expecting a redirect result
            const wasRedirectInitiated = localStorage.getItem('google_auth_initiated');
            const redirectTimestamp = localStorage.getItem('auth_redirect_timestamp');
            const wasMobileAttempt = localStorage.getItem('mobile_auth_attempt');
            const authUserAgent = localStorage.getItem('auth_user_agent');
            
            console.log('🔍 Redirect state check:', {
                wasInitiated: !!wasRedirectInitiated,
                timestamp: redirectTimestamp,
                wasMobileAttempt: !!wasMobileAttempt,
                authUserAgent: authUserAgent,
                currentUserAgent: navigator.userAgent,
                url: window.location.href,
                hasAuthCode: window.location.href.includes('code='),
                hasAuthState: window.location.href.includes('state='),
                hasError: window.location.href.includes('error=')
            });
            
            // Special handling for mobile redirects
            if (wasMobileAttempt && wasRedirectInitiated) {
                console.log('📱 Mobile redirect detected - using enhanced recovery');
                
                // Wait a bit longer for mobile browsers to stabilize
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Try to get current user first before checking redirect result
                const auth = firebase.auth();
                const currentUser = auth.currentUser;
                
                if (currentUser) {
                    console.log('✅ Found authenticated user immediately:', currentUser.email);
                    return await this.processAuthResult({ user: currentUser });
                }
            }
            
            if (wasRedirectInitiated) {
                console.log('📱 Redirect was initiated, checking result...');
                
                // Check if redirect is too old (more than 10 minutes - increased timeout)
                if (redirectTimestamp) {
                    const timeDiff = Date.now() - parseInt(redirectTimestamp);
                    if (timeDiff > 10 * 60 * 1000) {
                        console.log('⏰ Redirect timestamp too old, cleaning up');
                        this.cleanupRedirectFlags();
                        return { success: false, error: 'Redirect timeout' };
                    }
                }
            }
            
            // Wait for Firebase to initialize with longer timeout
            await new Promise((resolve, reject) => {
                let attempts = 0;
                const maxAttempts = 50; // 5 seconds
                
                const checkFirebase = () => {
                    attempts++;
                    if (firebase.auth) {
                        console.log('✅ Firebase auth loaded after', attempts * 100, 'ms');
                        resolve();
                    } else if (attempts >= maxAttempts) {
                        reject(new Error('Firebase auth failed to load'));
                    } else {
                        setTimeout(checkFirebase, 100);
                    }
                };
                
                if (firebase.auth) {
                    console.log('✅ Firebase auth already ready');
                    resolve();
                } else {
                    console.log('⏳ Waiting for Firebase auth to load...');
                    checkFirebase();
                }
            });

            const auth = firebase.auth();
            console.log('🔍 Getting redirect result...');
            
            // For mobile, use a different approach
            let result;
            if (wasMobileAttempt) {
                // On mobile, wait for auth state to stabilize before getting redirect result
                await new Promise(resolve => setTimeout(resolve, 500));
                
                try {
                    // Don't use timeout on mobile - let it complete naturally
                    result = await auth.getRedirectResult();
                } catch (redirectError) {
                    console.log('⚠️ Mobile redirect result error:', redirectError);
                    // Don't throw - continue to check auth state
                    result = null;
                }
            } else {
                // Desktop can use timeout
                result = await Promise.race([
                    auth.getRedirectResult(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Redirect result timeout')), 10000)
                    )
                ]);
            }
            
            console.log('📱 Redirect result received:', {
                hasResult: !!result,
                hasUser: !!(result && result.user),
                userEmail: result && result.user ? result.user.email : null,
                credential: result && result.credential ? 'present' : 'none'
            });
            
            if (result && result.user) {
                console.log('🎉 Redirect authentication successful!');
                console.log('👤 User details:', {
                    uid: result.user.uid,
                    email: result.user.email,
                    displayName: result.user.displayName
                });
                return await this.processAuthResult(result);
            } else if (wasRedirectInitiated) {
                console.log('⚠️ Expected redirect result but got none');
                console.log('🔍 URL contains auth params:', window.location.href.includes('code='));
                console.log('🔍 URL contains error params:', window.location.href.includes('error='));
                console.log('🔍 Current URL:', window.location.href);
                console.log('🔍 Result object details:', {
                    hasResult: !!result,
                    resultKeys: result ? Object.keys(result) : null,
                    credential: result && result.credential ? 'present' : 'none',
                    operationType: result && result.operationType ? result.operationType : 'none'
                });
                
                // Check if this is a mobile attempt and try alternative approach
                if (wasMobileAttempt) {
                    console.log('📱 Mobile redirect result empty - checking current auth state...');
                    
                    // Give Firebase more time to process the redirect on mobile
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Check if user is already authenticated
                    const currentUser = auth.currentUser;
                    if (currentUser) {
                        console.log('✅ Found authenticated user in current state:', currentUser.email);
                        return await this.processAuthResult({ user: currentUser });
                    }
                    
                    // Try getting redirect result again with longer timeout
                    console.log('🔄 Retry getting redirect result for mobile...');
                    try {
                        const retryResult = await Promise.race([
                            auth.getRedirectResult(),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Second redirect result timeout')), 5000)
                            )
                        ]);
                        
                        if (retryResult && retryResult.user) {
                            console.log('✅ Mobile redirect retry successful!');
                            return await this.processAuthResult(retryResult);
                        }
                    } catch (retryError) {
                        console.log('⚠️ Mobile redirect retry failed:', retryError.message);
                    }
                    
                    // Last resort: Force check auth state with extended waiting
                    console.log('🔄 Final attempt: Force auth state check...');
                    for (let i = 0; i < 10; i++) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                        const finalUser = auth.currentUser;
                        if (finalUser) {
                            console.log('✅ Found user in final auth state check:', finalUser.email);
                            return await this.processAuthResult({ user: finalUser });
                        }
                        console.log(`⏳ Auth state check attempt ${i + 1}/10`);
                    }
                }
                
                // Don't immediately fail - let auth state listener handle it
                console.log('⏳ Waiting for auth state change instead...');
                return { success: false, error: 'No redirect result, waiting for auth state' };
            } else {
                console.log('ℹ️ No redirect result (not expected)');
                return { success: false, error: 'No redirect result' };
            }
        } catch (error) {
            console.error('❌ Initial redirect result error:', error);
            console.error('❌ Error details:', {
                message: error.message,
                code: error.code,
                stack: error.stack
            });
            
            // Don't clean up flags immediately on error - give auth state listener a chance
            if (error.message.includes('timeout')) {
                console.log('⏳ Timeout error - waiting for auth state listener');
                return { success: false, error: 'Waiting for auth state change' };
            }
            
            // Clean up flags on other errors
            this.cleanupRedirectFlags();
            return { success: false, error: error.message };
        }
    }

    async handleRedirectResult() {
        try {
            const auth = firebase.auth();
            const result = await auth.getRedirectResult();
            
            if (result && result.user) {
                console.log('Redirect authentication successful:', result);
                const idToken = await result.user.getIdToken();
                localStorage.setItem('firebase_token', idToken);
                
                const email = result.user.email || '';
                const displayName = result.user.displayName || (email ? email.split('@')[0] : 'User');
                
                this.currentUser = {
                    uid: result.user.uid,
                    email: email,
                    displayName: displayName
                };
                
                this.notifyAuthListeners(this.currentUser);
                return { success: true, user: this.currentUser };
            }
            return { success: false, error: 'No redirect result' };
        } catch (error) {
            console.error('Redirect result error:', error);
            return { success: false, error: error.message };
        }
    }

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        
        // Set up Firebase auth state listener with unsubscribe capability
        const unsubscribe = firebase.auth().onAuthStateChanged(async (user) => {
            console.log('🔄 Firebase auth state changed:', user ? 'User signed in' : 'User signed out');
            
            // Special handling for mobile redirect completion
            const wasMobileAttempt = localStorage.getItem('mobile_auth_attempt');
            const wasRedirectInitiated = localStorage.getItem('google_auth_initiated');
            
            if (user && wasMobileAttempt && wasRedirectInitiated && !this.redirectHandled) {
                console.log('📱 Mobile redirect completed via auth state change!');
                this.redirectHandled = true;
            }
            
            if (user) {
                console.log('📱 User details:', {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    providerData: user.providerData,
                    isAnonymous: user.isAnonymous,
                    emailVerified: user.emailVerified
                });
                
                // Check if this is from a redirect we initiated
                const wasRedirectInitiated = localStorage.getItem('google_auth_initiated');
                const redirectTimestamp = localStorage.getItem('auth_redirect_timestamp');
                
                if (wasRedirectInitiated) {
                    console.log('✅ Auth state change from redirect - SUCCESS!');
                    console.log('⏱️ Time since redirect:', redirectTimestamp ? Date.now() - parseInt(redirectTimestamp) : 'unknown');
                    
                    // Clean up flags
                    this.cleanupRedirectFlags();
                    
                    // Show success notification
                    this.showAuthSuccessMessage();
                } else {
                    console.log('✅ Auth state change (not from redirect)');
                }
                
                try {
                    const idToken = await user.getIdToken();
                    localStorage.setItem('firebase_token', idToken);
                    console.log('🔑 ID token saved successfully');
                } catch (tokenError) {
                    console.error('❌ Failed to get ID token:', tokenError);
                }
                
                this.currentUser = {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'User')
                };
                
                console.log('👤 Current user updated from auth state:', this.currentUser);
                console.log('✅ Authentication successful!');
                
            } else {
                console.log('👤 User signed out');
                this.currentUser = null;
                localStorage.removeItem('firebase_token');
                
                // Clean up any pending redirect flags only if they're old
                const redirectTimestamp = localStorage.getItem('auth_redirect_timestamp');
                if (redirectTimestamp) {
                    const timeDiff = Date.now() - parseInt(redirectTimestamp);
                    // Only clean up if redirect is older than 30 seconds (to avoid cleaning during redirect)
                    if (timeDiff > 30000) {
                        console.log('🧹 Cleaning up old redirect flags');
                        this.cleanupRedirectFlags();
                    }
                }
            }
            
            this.notifyAuthListeners(this.currentUser);
        });
    }
    
    showAuthSuccessMessage() {
        try {
            // Show a brief success message
            const successDiv = document.createElement('div');
            successDiv.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #22c55e, #16a34a);
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                font-size: 14px;
                animation: slideInRight 0.3s ease-out;
            `;
            successDiv.innerHTML = '✅ Successfully signed in!';
            
            // Add animation styles
            const style = document.createElement('style');
            style.textContent = `
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);
            
            document.body.appendChild(successDiv);
            
            // Remove after 3 seconds
            setTimeout(() => {
                if (successDiv.parentNode) {
                    successDiv.remove();
                }
                if (style.parentNode) {
                    style.remove();
                }
            }, 3000);
        } catch (error) {
            console.log('Could not show success message:', error);
        }
    }

    notifyAuthListeners(user) {
        this.authListeners.forEach(callback => callback(user));
    }

    // Token refresh helper
    async refreshToken() {
        try {
            const auth = firebase.auth();
            const user = auth.currentUser;
            if (user) {
                const newToken = await user.getIdToken(true); // force refresh
                localStorage.setItem('firebase_token', newToken);
                console.log('🔄 Token refreshed successfully');
                return newToken;
            }
        } catch (error) {
            console.error('Failed to refresh token:', error);
        }
        return null;
    }

    // Chat storage functions that use secure API
    async saveChat(chatData) {
        console.log('💾 saveChat called for chat:', chatData.id);
        console.log('👤 Current user:', this.currentUser);
        
        let token = localStorage.getItem('firebase_token');
        console.log('🔑 Firebase token exists:', !!token);
        
        if (!token) {
            console.warn('❌ No authentication token found');
            return { success: false, error: 'Not authenticated' };
        }
        
        if (!this.currentUser) {
            console.warn('❌ No current user found');
            return { success: false, error: 'User not authenticated' };
        }

        // Try the request, and if it fails with auth error, refresh token and retry
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                console.log('📤 Sending chat to API:', this.apiBase + '/chats');
                const response = await fetch(`${this.apiBase}/chats`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(chatData)
                });
                
                console.log('📡 Save API response status:', response.status);
                
                if (response.status === 401 && attempt === 0) {
                    // Token expired, try to refresh
                    console.log('🔄 Token expired, refreshing...');
                    token = await this.refreshToken();
                    if (token) {
                        console.log('✅ Token refreshed, retrying request...');
                        continue; // Retry with new token
                    } else {
                        return { success: false, error: 'Authentication token expired and refresh failed' };
                    }
                }
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('❌ Save API returned error:', response.status, errorText);
                    
                    return { 
                        success: false, 
                        error: `API error: ${response.status} - ${errorText}`, 
                        fallback: true 
                    };
                }
                
                const result = await response.json();
                console.log('📥 API response:', result);
                return result;
            } catch (error) {
                console.error('💥 saveChat error:', error);
                if (attempt === 1) { // Last attempt
                    return { 
                        success: false, 
                        error: error.message, 
                        fallback: true 
                    };
                }
            }
        }
    }

    async getUserChats() {
        console.log('📂 getUserChats called');
        console.log('👤 Current user:', this.currentUser);
        
        const token = localStorage.getItem('firebase_token');
        console.log('🔑 Firebase token exists:', !!token);
        
        if (!token) {
            console.warn('❌ No authentication token for getUserChats');
            return { success: false, error: 'Not authenticated' };
        }
        
        if (!this.currentUser) {
            console.warn('❌ No current user for getUserChats');
            return { success: false, error: 'User not authenticated' };
        }

        try {
            console.log('📥 Fetching chats from API:', this.apiBase + '/chats');
            const response = await fetch(`${this.apiBase}/chats`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            console.log('📡 API response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ API returned error:', response.status, errorText);
                
                // Fallback to localStorage if API fails
                console.log('🔄 Falling back to localStorage only');
                return { 
                    success: false, 
                    error: `API error: ${response.status}`, 
                    fallback: true 
                };
            }
            
            const result = await response.json();
            console.log('📊 getUserChats API response:', result);
            return result;
        } catch (error) {
            console.error('💥 getUserChats error:', error);
            console.log('🔄 Falling back to localStorage only');
            return { 
                success: false, 
                error: error.message, 
                fallback: true 
            };
        }
    }

    async deleteChat(chatId) {
        console.log('🗑️ deleteChat called for:', chatId);
        console.log('👤 Current user:', this.currentUser);
        
        const token = localStorage.getItem('firebase_token');
        console.log('🔑 Firebase token exists:', !!token);
        
        if (!token) {
            console.warn('❌ No authentication token for deleteChat');
            return { success: false, error: 'Not authenticated' };
        }
        
        if (!this.currentUser) {
            console.warn('❌ No current user for deleteChat');
            return { success: false, error: 'User not authenticated' };
        }

        try {
            const deleteUrl = `${this.apiBase}/chats?chatId=${chatId}`;
            console.log('📤 Sending DELETE request to:', deleteUrl);
            console.log('🔑 Using token (first 10 chars):', token.substring(0, 10) + '...');
            
            const response = await fetch(deleteUrl, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            console.log('📡 Delete API response status:', response.status);
            console.log('📡 Delete API response ok:', response.ok);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Delete API returned error:', response.status, errorText);
                return { 
                    success: false, 
                    error: `API error: ${response.status} - ${errorText}` 
                };
            }
            
            const result = await response.json();
            console.log('📥 Delete API response:', result);
            
            if (result.success) {
                console.log('✅ Chat successfully deleted from Firebase');
            } else {
                console.error('❌ Firebase delete failed:', result.error);
            }
            
            return result;
        } catch (error) {
            console.error('💥 deleteChat error:', error);
            return { success: false, error: error.message };
        }
    }

    // Folder sync methods
    async saveFolders(foldersData) {
        console.log('📁 saveFolders called with:', foldersData.length, 'folders');
        
        let token = localStorage.getItem('firebase_token');
        if (!token || !this.currentUser) {
            return { success: false, error: 'Not authenticated' };
        }

        // Try the request, and if it fails with auth error, refresh token and retry
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const response = await fetch(`${this.apiBase}/chats?type=folders`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(foldersData)
                });
                
                if (response.status === 401 && attempt === 0) {
                    token = await this.refreshToken();
                    if (token) {
                        continue;
                    } else {
                        return { success: false, error: 'Authentication token expired and refresh failed' };
                    }
                }
                
                if (!response.ok) {
                    const errorText = await response.text();
                    return { 
                        success: false, 
                        error: `API error: ${response.status} - ${errorText}`, 
                        fallback: true 
                    };
                }
                
                const result = await response.json();
                console.log('📁 Folders saved successfully:', result);
                return result;
            } catch (error) {
                if (attempt === 1) {
                    return { 
                        success: false, 
                        error: error.message, 
                        fallback: true 
                    };
                }
            }
        }
    }

    async getUserFolders() {
        console.log('📂 getUserFolders called');
        
        let token = localStorage.getItem('firebase_token');
        if (!token || !this.currentUser) {
            return { success: false, error: 'Not authenticated' };
        }

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const response = await fetch(`${this.apiBase}/chats?type=folders`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.status === 401 && attempt === 0) {
                    token = await this.refreshToken();
                    if (token) {
                        continue;
                    } else {
                        return { success: false, error: 'Authentication token expired and refresh failed', fallback: true };
                    }
                }
                
                if (!response.ok) {
                    const errorText = await response.text();
                    return { 
                        success: false, 
                        error: `API error: ${response.status} - ${errorText}`, 
                        fallback: true 
                    };
                }
                
                const result = await response.json();
                console.log('📂 getUserFolders API response:', result);
                return result;
            } catch (error) {
                if (attempt === 1) {
                    return { 
                        success: false, 
                        error: error.message, 
                        fallback: true 
                    };
                }
            }
        }
    }

    async deleteFolder(folderId) {
        const token = localStorage.getItem('firebase_token');
        if (!token) return { success: false, error: 'Not authenticated' };

        try {
            const response = await fetch(`${this.apiBase}/chats?type=folder&folderId=${folderId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            return await response.json();
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

// Initialize the secure client
const secureFirebase = new SecureFirebaseClient();

// Make available globally
window.authFunctions = secureFirebase;
window.chatStorage = secureFirebase;