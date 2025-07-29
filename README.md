# 🤖 AI Chat Application

A modern ChatGPT-like interface with Firebase authentication, cross-device chat synchronization, and cloud-synced slash commands.

> **📁 Recently Optimized**: File structure has been reorganized for better maintainability and development experience.

## Features

- > ChatGPT-like interface with multiple AI models
- = Firebase authentication (Google & Email/Password)
-  Cross-device chat synchronization
- =� Local storage backup
- =� Responsive design (mobile & desktop)
- <� Modern UI with dark/light themes
- =� Token usage tracking
- =� Chat organization with folders
- <� Voice input support
- =� File upload support (images, PDFs, etc.)

## Setup Instructions

## 🌐 **Public Site Ready!**

This site includes Firebase authentication and is ready for public use! Anyone can:
- ✅ Sign up with email/password or Google
- ✅ Have their chats sync across devices
- ✅ Access their personal chat history anywhere

### Firebase Configuration (For Developers)

The Firebase configuration is already included for public use. If you want to fork this project with your own Firebase backend:

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com)
2. Enable Authentication (Google & Email/Password providers)  
3. Create a Firestore database
4. Replace the config in `firebase-config.js` with your project's config
5. Set environment variables for Vercel deployment:
   - `API_KEY_ENCRYPTION_SECRET`: 32+ character secret for encrypting stored API keys

### ⚠️ **IMPORTANT: Update Your Firebase Security Rules**

**Before making the site public**, update your Firestore security rules to this more restrictive version:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only access their own chats
    match /chats/{chatId} {
      allow read, write: if request.auth != null && 
                         request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && 
                    request.auth.uid == request.resource.data.userId;
    }
    
    // Users can only access their own settings (including API keys)
    match /userSettings/{userId} {
      allow read, write: if request.auth != null && 
                         request.auth.uid == userId;
    }
    
    // Deny all other access
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**This ensures:**
- ✅ Users can only see their own chats
- ✅ No user can access another user's data  
- ✅ Anonymous users can't access anything
- ❌ Blocks all unauthorized access

### 3. OpenAI API Key

- The app will prompt for your OpenAI API key on first use
- **NEW**: When signed in, API keys are encrypted and stored in your account for cross-device access
- API keys are encrypted using AES-256-CBC before storage
- Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)

### 4. Local Development

1. Clone this repository
2. Set up Firebase configuration (see above)
3. Open `index.html` in a web browser
4. Enter your OpenAI API key when prompted

## Usage

### Basic Chat
- Type messages and get AI responses
- Supports multiple models (GPT-4, GPT-4.1, etc.)
- Automatic conversation saving

### Authentication
- Click the user icon in settings to sign in
- Use Google sign-in or email/password
- Chats sync across devices when signed in

### File Support
- Drag & drop files or use the attachment button
- Supports images, PDFs, text files
- AI can analyze and discuss uploaded content

### Voice Input
- Click the microphone button to record voice messages
- Automatic transcription using OpenAI Whisper
- Hands-free chat experience

## Security Notes

- � Never commit `firebase-config.js` to version control
-  Use environment variables for production deployments
-  Keep Firebase security rules restrictive
-  API keys are stored locally only

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is open source and available under the MIT License.