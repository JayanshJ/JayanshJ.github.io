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
            
            // Check if domain is authorized
            if (!window.location.hostname.includes('github.io') && !window.location.hostname.includes('vercel.app') && window.location.hostname !== 'localhost') {
                console.warn('⚠️ Domain mismatch! Current domain may not be authorized in Firebase Console');
                console.warn('💡 Add this domain to Firebase Console → Authentication → Settings → Authorized domains:');
                console.warn('📝 Domain to add:', window.location.hostname);
            }
            
            const auth = firebase.auth();
            const provider = new firebase.auth.GoogleAuthProvider();
            
            // Add scopes for better user info
            provider.addScope('profile');
            provider.addScope('email');
            
            // Use redirect for mobile devices, popup for desktop
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                             window.innerWidth <= 768 || 
                             ('ontouchstart' in window) || 
                             (navigator.maxTouchPoints > 0);
            
            console.log('📱 Is mobile device:', isMobile);
            console.log('📏 Window width:', window.innerWidth);
            console.log('👆 Touch support:', 'ontouchstart' in window);
            console.log('🔢 Max touch points:', navigator.maxTouchPoints);
            
            let result;
            if (isMobile) {
                console.log('📱 Mobile detected, using redirect...');
                console.log('🔄 Starting signInWithRedirect...');
                
                // Check if redirect is supported
                if (typeof auth.signInWithRedirect === 'function') {
                    console.log('✅ signInWithRedirect is available');
                    await auth.signInWithRedirect(provider);
                    console.log('✅ Redirect initiated, page will reload...');
                    return { success: true, pending: true }; // Will complete on redirect
                } else {
                    console.error('❌ signInWithRedirect not available');
                    throw new Error('signInWithRedirect not supported');
                }
            } else {
                console.log('💻 Desktop detected, using popup...');
                result = await auth.signInWithPopup(provider);
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
            
            // Use redirect for mobile devices, popup for desktop
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                             window.innerWidth <= 768 || 
                             ('ontouchstart' in window) || 
                             (navigator.maxTouchPoints > 0);
            
            let result;
            if (isMobile) {
                console.log('📱 Mobile detected, using redirect...');
                console.log('🔄 Starting signInWithRedirect...');
                await auth.signInWithRedirect(provider);
                console.log('✅ Redirect initiated, page will reload...');
                return { success: true, pending: true }; // Will complete on redirect
            } else {
                console.log('💻 Desktop detected, using popup...');
                result = await auth.signInWithPopup(provider);
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

    // Chat storage functions that use secure API
    async saveChat(chatData) {
        console.log('💾 saveChat called for chat:', chatData.id);
        console.log('👤 Current user:', this.currentUser);
        
        const token = localStorage.getItem('firebase_token');
        console.log('🔑 Firebase token exists:', !!token);
        
        if (!token) {
            console.warn('❌ No authentication token found');
            return { success: false, error: 'Not authenticated' };
        }
        
        if (!this.currentUser) {
            console.warn('❌ No current user found');
            return { success: false, error: 'User not authenticated' };
        }

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
            
            const result = await response.json();
            console.log('📥 API response:', result);
            return result;
        } catch (error) {
            console.error('💥 saveChat error:', error);
            return { success: false, error: error.message };
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
            
            const result = await response.json();
            console.log('📊 getUserChats API response:', result);
            return result;
        } catch (error) {
            console.error('💥 getUserChats error:', error);
            return { success: false, error: error.message };
        }
    }

    async deleteChat(chatId) {
        const token = localStorage.getItem('firebase_token');
        if (!token) return { success: false, error: 'Not authenticated' };

        try {
            const response = await fetch(`${this.apiBase}/chats?chatId=${chatId}`, {
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