// Configuration file for your ChatGPT app
// 
// IMPORTANT: Replace 'your-api-key-here' with your actual OpenAI API key
// You can get your API key from: https://platform.openai.com/api-keys
//
// Example: const OPENAI_API_KEY = 'sk-proj-abc123def456...';

const OPENAI_API_KEY = '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';

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
