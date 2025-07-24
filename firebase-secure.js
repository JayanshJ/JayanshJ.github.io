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
        this.apiBase = window.location.origin + '/api';
        this.currentUser = null;
        this.authListeners = [];
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
                displayName: userCredential.user.displayName || email.split('@')[0]
            };
            
            this.notifyAuthListeners(this.currentUser);
            return { success: true, user: this.currentUser };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async signInWithGoogle() {
        try {
            const auth = firebase.auth();
            const provider = new firebase.auth.GoogleAuthProvider();
            const result = await auth.signInWithPopup(provider);
            
            const idToken = await result.user.getIdToken();
            localStorage.setItem('firebase_token', idToken);
            
            this.currentUser = {
                uid: result.user.uid,
                email: result.user.email,
                displayName: result.user.displayName || result.user.email.split('@')[0]
            };
            
            this.notifyAuthListeners(this.currentUser);
            return { success: true, user: this.currentUser };
        } catch (error) {
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
        return this.currentUser;
    }

    onAuthStateChanged(callback) {
        this.authListeners.push(callback);
        
        // Set up Firebase auth state listener
        firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
                const idToken = await user.getIdToken();
                localStorage.setItem('firebase_token', idToken);
                
                this.currentUser = {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName || user.email.split('@')[0]
                };
            } else {
                this.currentUser = null;
                localStorage.removeItem('firebase_token');
            }
            
            this.notifyAuthListeners(this.currentUser);
        });
    }

    notifyAuthListeners(user) {
        this.authListeners.forEach(callback => callback(user));
    }

    // Chat storage functions that use secure API
    async saveChat(chatData) {
        const token = localStorage.getItem('firebase_token');
        if (!token) return { success: false, error: 'Not authenticated' };

        try {
            const response = await fetch(`${this.apiBase}/chats`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(chatData)
            });
            
            return await response.json();
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getUserChats() {
        const token = localStorage.getItem('firebase_token');
        if (!token) return { success: false, error: 'Not authenticated' };

        try {
            const response = await fetch(`${this.apiBase}/chats`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            return await response.json();
        } catch (error) {
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