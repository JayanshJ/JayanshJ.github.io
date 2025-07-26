// Secure Firebase client that uses serverless functions
// No Firebase credentials exposed to client!

// Initialize minimal Firebase config for auth only
const firebaseConfig = {
    apiKey: "AIzaSyDhz3dQ_lHVaX0k53XUS3T-4TL0Y9nNaAk",
    authDomain: "ai-app-daeda.firebaseapp.com",
    projectId: "ai-app-daeda"
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
            
            // Mobile troubleshooting info
            const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            console.log('📱 Mobile User Agent detected:', isMobileUA);
            console.log('📱 Touch events supported:', 'ontouchstart' in window);
            console.log('📱 Window innerWidth:', window.innerWidth);
            console.log('📱 Screen width:', screen.width);
            console.log('📱 Max touch points:', navigator.maxTouchPoints);
            console.log('🌐 Online status:', navigator.onLine);
            console.log('🍪 Cookies enabled:', navigator.cookieEnabled);
            
            // Check if domain is authorized
            const authorizedDomains = ['github.io', 'vercel.app', 'localhost', '127.0.0.1'];
            const isAuthorizedDomain = authorizedDomains.some(domain => 
                window.location.hostname.includes(domain) || window.location.hostname === domain
            );
            
            if (!isAuthorizedDomain) {
                console.warn('⚠️ Domain mismatch! Current domain may not be authorized in Firebase Console');
                console.warn('💡 Add this domain to Firebase Console → Authentication → Settings → Authorized domains:');
                console.warn('📝 Domain to add:', window.location.hostname);
                
                // For mobile, provide specific instructions
                if (isMobileUA) {
                    console.warn('📱 MOBILE USERS: This domain authorization issue is common on mobile');
                    console.warn('📱 Try accessing from: https://jayanshj.github.io instead');
                }
                
                return { 
                    success: false, 
                    error: `Domain ${window.location.hostname} not authorized in Firebase Console. Please contact admin to add this domain.` 
                };
            }
            
            const auth = firebase.auth();
            
            // Set persistence for mobile compatibility
            console.log('🔧 Setting auth persistence for mobile compatibility...');
            await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            console.log('✅ Auth persistence set to LOCAL');
            
            const provider = new firebase.auth.GoogleAuthProvider();
            
            // Add scopes for better user info
            provider.addScope('profile');
            provider.addScope('email');
            
            // Always use popup for better mobile compatibility
            console.log('🔧 Using popup method for all devices (better mobile compatibility)');
            console.log('📱 User agent:', navigator.userAgent);
            console.log('📏 Window width:', window.innerWidth);
            console.log('👆 Touch support:', 'ontouchstart' in window);
            
            let result;
            try {
                console.log('🚀 Starting Google sign-in with popup...');
                result = await auth.signInWithPopup(provider);
                console.log('✅ Popup sign-in successful');
            } catch (popupError) {
                console.error('❌ Popup sign-in failed:', popupError);
                
                // Check if it's a popup blocked error
                if (popupError.code === 'auth/popup-blocked') {
                    console.log('🚫 Popup was blocked, trying redirect as fallback...');
                    try {
                        await auth.signInWithRedirect(provider);
                        console.log('✅ Redirect initiated, page will reload...');
                        return { success: true, pending: true };
                    } catch (redirectError) {
                        console.error('❌ Redirect also failed:', redirectError);
                        throw redirectError;
                    }
                } else {
                    throw popupError;
                }
            }
            
            console.log('Google sign in result:', result);
            console.log('User object:', result.user);
            
            if (!result || !result.user) {
                throw new Error('No user returned from Google sign in');
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
            console.error('Google sign in error:', error);
            return { success: false, error: error.message };
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
            console.log('🔄 Checking for mobile redirect result on page load...');
            
            // Wait for Firebase to initialize
            await new Promise(resolve => {
                if (firebase.auth) {
                    console.log('✅ Firebase auth is ready');
                    resolve();
                } else {
                    console.log('⏳ Waiting for Firebase auth to load...');
                    const checkFirebase = () => {
                        if (firebase.auth) {
                            console.log('✅ Firebase auth loaded');
                            resolve();
                        } else {
                            setTimeout(checkFirebase, 100);
                        }
                    };
                    checkFirebase();
                }
            });

            const auth = firebase.auth();
            console.log('🔍 Getting redirect result...');
            const result = await auth.getRedirectResult();
            
            console.log('📱 Redirect result:', result);
            
            if (result && result.user) {
                console.log('🎉 Mobile redirect authentication successful!', result);
                const idToken = await result.user.getIdToken();
                localStorage.setItem('firebase_token', idToken);
                
                const email = result.user.email || '';
                const displayName = result.user.displayName || (email ? email.split('@')[0] : 'User');
                
                this.currentUser = {
                    uid: result.user.uid,
                    email: email,
                    displayName: displayName
                };
                
                console.log('👤 Current user set:', this.currentUser);
                this.notifyAuthListeners(this.currentUser);
                return { success: true, user: this.currentUser };
            } else {
                console.log('❌ No redirect result found');
            }
            return { success: false, error: 'No redirect result' };
        } catch (error) {
            console.error('❌ Initial redirect result error:', error);
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
        
        // Set up Firebase auth state listener - this will automatically handle redirect results
        firebase.auth().onAuthStateChanged(async (user) => {
            console.log('🔄 Firebase auth state changed:', user ? 'User signed in' : 'User signed out');
            
            if (user) {
                console.log('📱 User details:', {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    providerData: user.providerData
                });
                
                const idToken = await user.getIdToken();
                localStorage.setItem('firebase_token', idToken);
                
                this.currentUser = {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'User')
                };
                
                console.log('👤 Current user updated from auth state:', this.currentUser);
                console.log('✅ Mobile sign-in successful!');
            } else {
                this.currentUser = null;
                localStorage.removeItem('firebase_token');
                console.log('👤 User signed out');
            }
            
            this.notifyAuthListeners(this.currentUser);
        });
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