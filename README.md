# AI Chat Application

A modern ChatGPT-like interface with Firebase authentication and cross-device chat synchronization.

## Features

- > ChatGPT-like interface with multiple AI models
- = Firebase authentication (Google & Email/Password)
-  Cross-device chat synchronization
- =¾ Local storage backup
- =ñ Responsive design (mobile & desktop)
- <¨ Modern UI with dark/light themes
- =Ê Token usage tracking
- =Â Chat organization with folders
- <™ Voice input support
- =Ä File upload support (images, PDFs, etc.)

## Setup Instructions

### 1. Firebase Configuration

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com)
2. Enable Authentication (Google & Email/Password providers)
3. Create a Firestore database
4. Copy `firebase-config.example.js` to `firebase-config.js`
5. Replace the placeholder values with your Firebase config:

```javascript
const firebaseConfig = {
    apiKey: "your-api-key-here",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "your-app-id"
};
```

### 2. Firebase Security Rules

Set up Firestore security rules to protect user data:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /chats/{chatId} {
      allow read, write: if request.auth != null && 
                         request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && 
                    request.auth.uid == request.resource.data.userId;
    }
  }
}
```

### 3. OpenAI API Key

- The app will prompt for your OpenAI API key on first use
- Your API key is stored locally and never shared
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

-   Never commit `firebase-config.js` to version control
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