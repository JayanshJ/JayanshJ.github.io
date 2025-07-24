// Vercel serverless function for chat data
const admin = require('firebase-admin');

// Initialize Firebase Admin (server-side only)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
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
    res.status(500).json({ success: false, error: error.message });
  }
}