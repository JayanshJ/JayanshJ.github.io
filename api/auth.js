// Vercel serverless function for Firebase auth
const admin = require('firebase-admin');
const crypto = require('crypto');

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

// Encryption functions for API keys
function encryptApiKey(apiKey) {
  const algorithm = 'aes-256-cbc';
  const secretKey = process.env.API_KEY_ENCRYPTION_SECRET || 'fallback-key-for-dev-only-not-secure';
  const key = crypto.scryptSync(secretKey, 'salt', 32);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipher(algorithm, key, iv);
  
  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return {
    encrypted,
    iv: iv.toString('hex')
  };
}

function decryptApiKey(encryptedData) {
  const algorithm = 'aes-256-cbc';
  const secretKey = process.env.API_KEY_ENCRYPTION_SECRET || 'fallback-key-for-dev-only-not-secure';
  const key = crypto.scryptSync(secretKey, 'salt', 32);
  const iv = Buffer.from(encryptedData.iv, 'hex');
  
  const decipher = crypto.createDecipher(algorithm, key, iv);
  
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'POST') {
      const { action, email, password, idToken } = req.body;

      switch (action) {
        case 'signUp':
          const newUser = await admin.auth().createUser({
            email,
            password,
          });
          return res.json({ success: true, uid: newUser.uid });

        case 'signIn':
          // Verify the ID token from client
          const decodedToken = await admin.auth().verifyIdToken(idToken);
          return res.json({ success: true, uid: decodedToken.uid });

        case 'getUser':
          if (idToken) {
            const decoded = await admin.auth().verifyIdToken(idToken);
            const user = await admin.auth().getUser(decoded.uid);
            return res.json({ success: true, user: user.toJSON() });
          }
          break;

        case 'saveApiKey':
          if (idToken && req.body.apiKey) {
            const decoded = await admin.auth().verifyIdToken(idToken);
            const firestore = admin.firestore();
            
            // Encrypt the API key before storing
            const encryptedApiKey = encryptApiKey(req.body.apiKey);
            
            await firestore.collection('userSettings').doc(decoded.uid).set({
              encryptedApiKey: encryptedApiKey,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            
            return res.json({ success: true });
          }
          break;

        case 'getApiKey':
          if (idToken) {
            const decoded = await admin.auth().verifyIdToken(idToken);
            const firestore = admin.firestore();
            
            const doc = await firestore.collection('userSettings').doc(decoded.uid).get();
            if (doc.exists && doc.data().encryptedApiKey) {
              try {
                // Decrypt the API key before returning
                const decryptedApiKey = decryptApiKey(doc.data().encryptedApiKey);
                return res.json({ success: true, apiKey: decryptedApiKey });
              } catch (error) {
                console.error('Decryption error:', error);
                return res.json({ success: false, error: 'Failed to decrypt API key' });
              }
            } else {
              return res.json({ success: true, apiKey: null });
            }
          }
          break;
      }
    }
    
    res.status(400).json({ success: false, error: 'Invalid request' });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}