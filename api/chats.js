// Vercel serverless function for chat data
const admin = require('firebase-admin');

// Initialize Firebase Admin (server-side only)
if (!admin.apps.length) {
  try {
    // Check if required environment variables exist
    const requiredEnvVars = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
    
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Firebase Admin initialization failed:', error.message);
    throw error;
  }
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Verify the user's ID token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    if (req.method === 'GET') {
      // Get user's chats
      const chatsRef = db.collection('chats').where('userId', '==', userId);
      const snapshot = await chatsRef.orderBy('updatedAt', 'desc').get();
      
      const chats = [];
      snapshot.forEach(doc => {
        chats.push({ id: doc.id, ...doc.data() });
      });

      return res.json({ success: true, chats });
    }

    if (req.method === 'POST') {
      // Save a chat
      const chatData = req.body;
      const chatRef = db.collection('chats').doc(chatData.id);
      
      await chatRef.set({
        ...chatData,
        userId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.json({ success: true, id: chatData.id });
    }

    if (req.method === 'DELETE') {
      // Delete a chat
      const { chatId } = req.query;
      await db.collection('chats').doc(chatId).delete();
      return res.json({ success: true });
    }

    res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Chats API error:', error);
    
    // Provide more specific error information
    let errorMessage = error.message;
    if (error.message.includes('Missing required environment variables')) {
      errorMessage = 'Server configuration error: Firebase environment variables not set';
    } else if (error.code === 'auth/id-token-expired') {
      errorMessage = 'Authentication token expired';
    } else if (error.code === 'auth/invalid-id-token') {
      errorMessage = 'Invalid authentication token';
    }
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}