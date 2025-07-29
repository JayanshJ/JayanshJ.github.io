// Configuration file for your ChatGPT app
// 
// API key is now prompted when the website loads - no need to edit this file!
// This makes the app safe to publish and share

const OPENAI_API_KEY = 'prompt-for-key'; // Will be prompted on load

// Optional: Customize these settings
const CHAT_CONFIG = {
    model: 'gpt-4.1-2025-04-14', // Using GPT-4.1 model as default
    maxCompletionTokens: 10000
    // Temperature is automatically set: 0.3 for GPT-4.1, 0.7 for Image Gen model
};

// Export for use in script.js
window.CONFIG = {
    apiKey: OPENAI_API_KEY,
    ...CHAT_CONFIG
};
