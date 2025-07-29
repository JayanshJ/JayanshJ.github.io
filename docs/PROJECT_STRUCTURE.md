# Project Structure

This document outlines the organized file structure of the AI Chat Application.

## 📁 Directory Structure

```
JayanshJ.github.io/
├── 📄 index.html                 # Main application entry point
├── 📄 package.json              # Node.js dependencies and scripts
├── 📄 vercel.json               # Vercel deployment configuration
├── 📄 README.md                 # Project documentation
├── 📄 .gitignore               # Git ignore rules
│
├── 📁 src/                      # Source code directory
│   ├── 📁 js/                   # JavaScript files
│   │   ├── 📄 script.js         # Main application logic (302KB)
│   │   ├── 📄 simple-auth.js    # Simple authentication utilities
│   │   └── 📄 simple-auth-global.js # Global auth functions
│   │
│   ├── 📁 css/                  # Stylesheets
│   │   └── 📄 style.css         # Main application styles (132KB)
│   │
│   └── 📁 firebase/             # Firebase-related files
│       ├── 📄 firebase-secure.js        # Secure Firebase client (53KB)
│       ├── 📄 firebase-client-only.js   # Client-only Firebase setup
│       ├── 📄 firebase-config.example.js # Example configuration
│       └── 📄 firestore.rules           # Firestore security rules
│
├── 📁 api/                      # Serverless API functions
│   ├── 📄 auth.js              # Authentication endpoints
│   ├── 📄 chats.js             # Chat data management
│   ├── 📄 user-settings.js     # User settings & slash commands
│   └── 📄 test.js              # API testing utilities
│
├── 📁 config/                   # Configuration files
│   └── 📄 config.js            # Application configuration
│
├── 📁 docs/                     # Documentation
│   ├── 📄 PROJECT_STRUCTURE.md # This file
│   └── 📄 FORMATTING_ASSISTANT_README.md # Formatting guide
│
├── 📁 assets/                   # Static assets (images, icons, etc.)
│   └── (empty - ready for future assets)
│
├── 📁 .claude/                  # Claude AI configuration
├── 📁 .vscode/                  # VS Code settings
└── 📁 js/                       # Legacy JS directory (to be cleaned)
```

## 🎯 Key Features

### Core Application
- **Main App**: `index.html` + `src/js/script.js` + `src/css/style.css`
- **Authentication**: Firebase-based with secure serverless functions
- **Cloud Sync**: Cross-device chat and slash command synchronization
- **Slash Commands**: Cloud-synced quick website access

### API Architecture
- **Serverless Functions**: Vercel-hosted API endpoints in `/api/`
- **Secure Backend**: Firebase Admin SDK for server-side operations
- **User Data**: Encrypted storage for settings and commands

### Development Tools
- **Hot Reload**: Vercel dev server for local development
- **Type Safety**: JSDoc comments throughout codebase
- **Code Organization**: Modular structure with clear separation

## 🚀 Getting Started

1. **Local Development**:
   ```bash
   npm install
   npm run dev
   ```

2. **Production Deployment**:
   ```bash
   npm run deploy
   ```

3. **File Locations**:
   - Main app logic: `src/js/script.js`
   - Styling: `src/css/style.css`
   - Firebase setup: `src/firebase/`
   - API endpoints: `api/`

## 📝 Recent Optimizations

- ✅ Organized files into logical directories
- ✅ Updated import paths in HTML
- ✅ Separated concerns (JS, CSS, Firebase, API)
- ✅ Created documentation structure
- ✅ Prepared assets directory for future use

## 🔧 Maintenance

- **Large Files**: `script.js` (302KB) and `style.css` (132KB) could be split further
- **Code Splitting**: Consider breaking down main script into modules
- **Asset Optimization**: Use `assets/` for images, icons, and media
- **Documentation**: Keep this structure doc updated with changes