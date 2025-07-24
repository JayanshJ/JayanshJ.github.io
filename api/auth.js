// Vercel serverless function for Firebase auth
import admin from 'firebase-admin';

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

export default async function handler(req, res) {
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
      }
    }
    
    res.status(400).json({ success: false, error: 'Invalid request' });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}