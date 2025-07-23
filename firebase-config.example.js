// Firebase configuration and initialization
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Firebase configuration - REPLACE WITH YOUR ACTUAL CONFIG
const firebaseConfig = {
    apiKey: "your-api-key-here",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "your-app-id"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Configure providers
const googleProvider = new GoogleAuthProvider();

// Auth state management
let currentUser = null;

// Authentication functions
export const authFunctions = {
    // Email/Password signup
    async signUpWithEmail(email, password) {
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            return { success: true, user: userCredential.user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Email/Password login
    async signInWithEmail(email, password) {
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            return { success: true, user: userCredential.user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Google login
    async signInWithGoogle() {
        try {
            const result = await signInWithPopup(auth, googleProvider);
            return { success: true, user: result.user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Sign out
    async signOut() {
        try {
            await signOut(auth);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Get current user
    getCurrentUser() {
        return currentUser;
    },

    // Listen to auth state changes
    onAuthStateChanged(callback) {
        return onAuthStateChanged(auth, (user) => {
            currentUser = user;
            callback(user);
        });
    }
};

// Firestore functions for chat data
export const chatStorage = {
    // Save chat to Firestore
    async saveChat(chatData) {
        console.log('saveChat called for:', chatData.id, 'currentUser:', currentUser);
        if (!currentUser) {
            console.log('No current user, cannot save chat');
            return { success: false, error: 'User not authenticated' };
        }
        
        try {
            // Use the chat's local ID as the document ID for consistent referencing
            const chatRef = doc(db, 'chats', chatData.id);
            console.log('Saving chat to Firestore:', chatData.id, 'for user:', currentUser.uid);
            await setDoc(chatRef, {
                userId: currentUser.uid,
                ...chatData,
                createdAt: new Date(),
                updatedAt: new Date()
            }, { merge: true });
            console.log('Successfully saved chat:', chatData.id);
            return { success: true, id: chatData.id };
        } catch (error) {
            console.error('Error saving chat to Firestore:', error);
            console.error('Error code:', error.code);
            console.error('Error message:', error.message);
            return { success: false, error: error.message };
        }
    },

    // Update existing chat
    async updateChat(chatId, chatData) {
        if (!currentUser) return { success: false, error: 'User not authenticated' };
        
        try {
            const chatRef = doc(db, 'chats', chatId);
            await updateDoc(chatRef, {
                ...chatData,
                updatedAt: new Date()
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Get user's chats
    async getUserChats() {
        console.log('getUserChats called, currentUser:', currentUser);
        if (!currentUser) {
            console.log('No current user found');
            return { success: false, error: 'User not authenticated' };
        }
        
        console.log('Attempting to query Firestore for user:', currentUser.uid);
        try {
            // Simplified query without orderBy to avoid index issues
            const q = query(
                collection(db, 'chats'), 
                where('userId', '==', currentUser.uid)
            );
            console.log('Query created (simplified), executing...');
            const querySnapshot = await getDocs(q);
            console.log('Query executed, processing results...');
            const chats = [];
            querySnapshot.forEach((doc) => {
                chats.push({ id: doc.id, ...doc.data() });
            });
            
            // Sort by updatedAt on client side to avoid index requirements
            chats.sort((a, b) => {
                const aTime = a.updatedAt?.toDate?.() || new Date(a.timestamp || 0);
                const bTime = b.updatedAt?.toDate?.() || new Date(b.timestamp || 0);
                return bTime - aTime; // Descending order (newest first)
            });
            
            console.log(`Found ${chats.length} chats for user ${currentUser.uid}`);
            return { success: true, chats };
        } catch (error) {
            console.error('Firestore query error:', error);
            console.error('Error code:', error.code);
            console.error('Error message:', error.message);
            return { success: false, error: error.message };
        }
    },

    // Delete chat
    async deleteChat(chatId) {
        if (!currentUser) return { success: false, error: 'User not authenticated' };
        
        try {
            await deleteDoc(doc(db, 'chats', chatId));
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // Listen to user's chats in real-time
    listenToUserChats(callback) {
        if (!currentUser) return null;
        
        const q = query(
            collection(db, 'chats'), 
            where('userId', '==', currentUser.uid)
        );
        
        return onSnapshot(q, (querySnapshot) => {
            const chats = [];
            querySnapshot.forEach((doc) => {
                chats.push({ id: doc.id, ...doc.data() });
            });
            callback(chats);
        });
    }
};

// Export Firebase instances
export { auth, db };

// Make functions available globally for non-module scripts
// Note: This runs in a module context, so we need to ensure global availability
if (typeof window !== 'undefined') {
    window.chatStorage = chatStorage;
    window.authFunctions = authFunctions;
}