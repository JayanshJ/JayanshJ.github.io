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
      const { type } = req.query;
      
      if (type === 'folders') {
        // Get user's folders
        const foldersRef = db.collection('folders').where('userId', '==', userId);
        const snapshot = await foldersRef.orderBy('createdAt', 'asc').get();
        
        const folders = [];
        snapshot.forEach(doc => {
          folders.push({ id: doc.id, ...doc.data() });
        });

        return res.json({ success: true, folders });
      } else {
        // Get user's chats (default behavior)
        const chatsRef = db.collection('chats').where('userId', '==', userId);
        const snapshot = await chatsRef.orderBy('updatedAt', 'desc').get();
        
        const chats = [];
        snapshot.forEach(doc => {
          chats.push({ id: doc.id, ...doc.data() });
        });

        return res.json({ success: true, chats });
      }
    }

    if (req.method === 'POST') {
      const { type } = req.query;
      
      if (type === 'folders') {
        // Save folders
        const foldersData = req.body;
        
        if (Array.isArray(foldersData)) {
          // Save multiple folders
          const batch = db.batch();
          
          for (const folder of foldersData) {
            const folderRef = db.collection('folders').doc(folder.id);
            const updateData = {
              ...folder,
              userId,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            
            // Check if this is a new folder
            const existingDoc = await folderRef.get();
            if (!existingDoc.exists) {
              updateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
            }
            
            batch.set(folderRef, updateData, { merge: true });
          }
          
          await batch.commit();
          return res.json({ success: true, count: foldersData.length });
        } else {
          // Save single folder
          const folderData = foldersData;
          const folderRef = db.collection('folders').doc(folderData.id);
          
          const existingDoc = await folderRef.get();
          const updateData = {
            ...folderData,
            userId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          
          if (!existingDoc.exists) {
            updateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
          }
          
          await folderRef.set(updateData, { merge: true });
          return res.json({ success: true, id: folderData.id });
        }
      } else {
        // Save a chat (default behavior)
        const chatData = req.body;
        const chatRef = db.collection('chats').doc(chatData.id);
        
        // Check if this is a new chat or an update
        const existingDoc = await chatRef.get();
        const updateData = {
          ...chatData,
          userId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        
        // Only set createdAt for new chats
        if (!existingDoc.exists) {
          updateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        }
        
        await chatRef.set(updateData, { merge: true });

        return res.json({ success: true, id: chatData.id });
      }
    }

    if (req.method === 'DELETE') {
      const { chatId, folderId, type } = req.query;
      
      if (type === 'folder' && folderId) {
        // Delete a folder
        await db.collection('folders').doc(folderId).delete();
        return res.json({ success: true });
      } else if (chatId) {
        // Delete a chat
        await db.collection('chats').doc(chatId).delete();
        return res.json({ success: true });
      } else {
        return res.status(400).json({ success: false, error: 'Missing required parameters' });
      }
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