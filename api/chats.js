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
    
    // Parse private key more robustly
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    
    // Check if the key is Base64 encoded (alternative storage method)
    if (process.env.FIREBASE_PRIVATE_KEY_BASE64) {
      console.log('🔑 Using Base64 encoded private key');
      try {
        privateKey = Buffer.from(process.env.FIREBASE_PRIVATE_KEY_BASE64, 'base64').toString('utf8');
      } catch (base64Error) {
        console.error('❌ Failed to decode Base64 private key:', base64Error.message);
        throw new Error('Invalid Base64 private key');
      }
    }
    
    if (privateKey) {
      // Handle different formats of newlines in environment variables
      privateKey = privateKey.replace(/\\n/g, '\n');
      
      // Ensure the key has proper BEGIN/END markers
      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        console.error('❌ Private key missing BEGIN marker');
        console.log('Private key preview:', privateKey.substring(0, 100) + '...');
        throw new Error('Invalid private key format: missing BEGIN marker');
      }
      if (!privateKey.includes('-----END PRIVATE KEY-----')) {
        console.error('❌ Private key missing END marker');
        throw new Error('Invalid private key format: missing END marker');
      }
      
      console.log('✅ Private key format validated');
    } else {
      throw new Error('No private key found in environment variables');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
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
  const allowedOrigins = ['*', 'http://127.0.0.1:5500', 'http://localhost:5500'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    console.log('🚀 API Request:', {
      method: req.method,
      url: req.url,
      hasAuth: !!req.headers.authorization,
      timestamp: new Date().toISOString()
    });

    // Verify the user's ID token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ No authorization header found');
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    console.log('🔑 Attempting to verify ID token...');
    
    let userId;
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      userId = decodedToken.uid;
      console.log('✅ Token verified for user:', userId);
    } catch (tokenError) {
      console.error('❌ Token verification failed:', tokenError.message);
      return res.status(401).json({ success: false, error: 'Invalid token: ' + tokenError.message });
    }

    if (req.method === 'GET') {
      const { type } = req.query;
      
      if (type === 'folders') {
        // Get user's folders
        console.log('Fetching folders for userId:', userId);
        const foldersRef = db.collection('folders').where('userId', '==', userId);
        const snapshot = await foldersRef.get();
        
        const folders = [];
        snapshot.forEach(doc => {
          folders.push({ id: doc.id, ...doc.data() });
        });

        console.log(`Found ${folders.length} folders for user ${userId}`);
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
        console.log('Saving folders for userId:', userId, 'folders:', Array.isArray(foldersData) ? foldersData.length : 1);
        
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
        console.log('💾 Attempting to save chat...');
        const chatData = req.body;
        
        if (!chatData || !chatData.id) {
          console.error('❌ Invalid chat data received:', chatData);
          return res.status(400).json({ success: false, error: 'Invalid chat data: missing id' });
        }
        
        console.log('📝 Saving chat:', { id: chatData.id, userId, messageCount: chatData.messages?.length || 0 });
        
        try {
          const chatRef = db.collection('chats').doc(chatData.id);
          
          // Check if this is a new chat or an update
          console.log('🔍 Checking if chat exists...');
          const existingDoc = await chatRef.get();
          
          const updateData = {
            ...chatData,
            userId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          
          // Only set createdAt for new chats
          if (!existingDoc.exists) {
            console.log('✨ Creating new chat');
            updateData.createdAt = admin.firestore.FieldValue.serverTimestamp();
          } else {
            console.log('🔄 Updating existing chat');
          }
          
          await chatRef.set(updateData, { merge: true });
          console.log('✅ Chat saved successfully');

          return res.json({ success: true, id: chatData.id });
        } catch (saveError) {
          console.error('❌ Error saving chat to Firestore:', saveError);
          return res.status(500).json({ success: false, error: 'Failed to save chat: ' + saveError.message });
        }
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