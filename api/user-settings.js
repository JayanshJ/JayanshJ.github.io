// User Settings API - Handle user preferences and inline commands
const admin = require('firebase-admin');

// Initialize Firebase Admin if not already done
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    });
}

const db = admin.firestore();

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // Verify authentication
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ 
                success: false, 
                error: 'Missing or invalid authorization header' 
            });
        }

        const token = authHeader.split('Bearer ')[1];
        let decodedToken;
        
        try {
            decodedToken = await admin.auth().verifyIdToken(token);
        } catch (error) {
            console.error('Token verification failed:', error);
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid authentication token' 
            });
        }

        const userId = decodedToken.uid;
        console.log(`📋 User settings request for user: ${userId}, method: ${req.method}`);

        if (req.method === 'GET') {
            // Get user settings
            try {
                const settingsDoc = await db.collection('userSettings').doc(userId).get();
                
                if (!settingsDoc.exists) {
                    console.log(`📝 No settings found for user ${userId}, returning empty settings`);
                    return res.status(200).json({
                        success: true,
                        settings: {
                            inlineCommands: {},
                            lastUpdated: Date.now()
                        }
                    });
                }

                const settings = settingsDoc.data();
                console.log(`✅ Retrieved settings for user ${userId}:`, Object.keys(settings));
                
                return res.status(200).json({
                    success: true,
                    settings: settings
                });

            } catch (error) {
                console.error('Error retrieving user settings:', error);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to retrieve user settings'
                });
            }

        } else if (req.method === 'POST') {
            // Save user settings
            try {
                const settings = req.body;
                
                if (!settings) {
                    return res.status(400).json({
                        success: false,
                        error: 'Settings data is required'
                    });
                }

                // Ensure userId matches the authenticated user
                settings.userId = userId;
                settings.lastUpdated = Date.now();

                // Save to Firestore
                await db.collection('userSettings').doc(userId).set(settings, { merge: true });
                
                console.log(`✅ Saved settings for user ${userId}:`, Object.keys(settings));
                
                return res.status(200).json({
                    success: true,
                    message: 'Settings saved successfully'
                });

            } catch (error) {
                console.error('Error saving user settings:', error);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to save user settings'
                });
            }

        } else {
            return res.status(405).json({
                success: false,
                error: 'Method not allowed'
            });
        }

    } catch (error) {
        console.error('User settings API error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}