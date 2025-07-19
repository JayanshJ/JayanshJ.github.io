// Configuration file for your ChatGPT app
// 
// API key is now prompted when the website loads - no need to edit this file!
// This makes the app safe to publish and share

const OPENAI_API_KEY = 'prompt-for-key'; // Will be prompted on load

// Optional: Customize these settings
const CHAT_CONFIG = {
    model: 'o3-2025-04-16', // Using o3 model for advanced reasoning capabilities
    maxCompletionTokens: 1000
    // Temperature is automatically set: 1.0 for o3 models, 0.1 for GPT-4.1 models
};

// Export for use in script.js
window.CONFIG = {
    apiKey: OPENAI_API_KEY,
    ...CHAT_CONFIG
};
