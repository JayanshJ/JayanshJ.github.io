// API Communication Module
import { CONFIG, SYSTEM_PROMPT } from './config.js';
import { AppState } from './state.js';

export class APIManager {
    constructor() {
        this.apiKey = null;
    }

    // Get API key from config or localStorage
    getApiKey() {
        if (this.apiKey) return this.apiKey;
        
        // Try to get from global config first
        if (typeof window.getApiKey === 'function') {
            this.apiKey = window.getApiKey();
            return this.apiKey;
        }
        
        // Fallback to localStorage
        this.apiKey = localStorage.getItem('openai_api_key');
        return this.apiKey;
    }

    // Set API key
    setApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('openai_api_key', key);
    }

    // Validate API key
    isValidApiKey() {
        const key = this.getApiKey();
        return key && key !== 'YOUR_API_KEY' && key !== 'your-api-key-here';
    }

    // Build messages array with system prompt
    buildMessagesWithSystem(conversationHistory) {
        // Only add system prompt for non-image models
        if (AppState.currentModel === 'gpt-image-1') {
            return conversationHistory;
        }
        return [SYSTEM_PROMPT, ...conversationHistory];
    }

    // Get model temperature
    getModelTemperature(model) {
        const temperatures = {
            'gpt-4.1-2025-04-14': 0.7,
            'chatgpt-4o-latest': 0.7,
            'gpt-4o-search-preview-2025-03-11': 0.5,
            'gpt-image-1': 0.9
        };
        return temperatures[model] || 0.7;
    }

    // Send chat completion request
    async sendChatCompletion(messages, options = {}) {
        const apiKey = this.getApiKey();
        
        if (!this.isValidApiKey()) {
            throw new Error('Please set a valid OpenAI API key');
        }

        const requestBody = {
            model: AppState.currentModel,
            messages: messages,
            max_completion_tokens: options.maxTokens || 10000,
            ...(!AppState.currentModel.includes('gpt-4o-search-preview') && { 
                temperature: this.getModelTemperature(AppState.currentModel) 
            }),
            ...options
        };

        console.log('🚀 Sending API request:', {
            model: requestBody.model,
            messageCount: messages.length,
            maxTokens: requestBody.max_completion_tokens
        });

        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('✅ API response received:', {
            model: data.model,
            usage: data.usage
        });

        return data;
    }

    // Generate image using DALL-E
    async generateImage(prompt, settings = {}) {
        const apiKey = this.getApiKey();
        
        if (!this.isValidApiKey()) {
            throw new Error('Please set a valid OpenAI API key');
        }

        // Enhance prompt based on settings
        let enhancedPrompt = prompt;
        
        if (settings.quality === 'high') {
            enhancedPrompt += ', high quality, detailed, professional';
        } else if (settings.quality === 'medium') {
            enhancedPrompt += ', good quality, clear';
        } else if (settings.quality === 'low') {
            enhancedPrompt += ', simple, basic style';
        }
        
        if (settings.background === 'transparent') {
            enhancedPrompt += ', transparent background, PNG format';
        } else if (settings.background === 'opaque') {
            enhancedPrompt += ', solid background, no transparency';
        }
        
        // Add aspect ratio hints
        if (settings.size === '1024x1536') {
            enhancedPrompt += ', portrait orientation, vertical composition';
        } else if (settings.size === '1536x1024') {
            enhancedPrompt += ', landscape orientation, horizontal composition';
        } else if (settings.size === '1024x1024') {
            enhancedPrompt += ', square composition';
        }

        const requestBody = {
            model: 'dall-e-3',
            prompt: enhancedPrompt,
            n: 1,
            size: settings.size !== 'auto' ? settings.size : '1024x1024',
            quality: settings.quality !== 'auto' ? settings.quality : 'standard',
            response_format: 'url'
        };

        console.log('🎨 Generating image:', {
            prompt: enhancedPrompt,
            settings: requestBody
        });

        const response = await fetch(CONFIG.IMAGE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'Image generation failed');
        }

        const data = await response.json();
        console.log('✅ Image generated successfully');

        return data;
    }

    // Transcribe audio using Whisper
    async transcribeAudio(audioFile) {
        const apiKey = this.getApiKey();
        
        if (!this.isValidApiKey()) {
            throw new Error('Please set a valid OpenAI API key');
        }

        const formData = new FormData();
        formData.append('file', audioFile);
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'text');

        console.log('🎵 Transcribing audio:', {
            fileName: audioFile.name,
            fileSize: audioFile.size
        });

        const response = await fetch(CONFIG.WHISPER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'Audio transcription failed');
        }

        const transcription = await response.text();
        console.log('✅ Audio transcribed successfully');

        return transcription;
    }

    // Generate smart title for chat
    async generateSmartTitle(messages) {
        try {
            if (!this.isValidApiKey()) {
                return null;
            }

            const conversationSummary = messages
                .filter(msg => msg.role === 'user' || msg.role === 'assistant')
                .slice(0, 6)
                .map(msg => {
                    let content = '';
                    if (typeof msg.content === 'string') {
                        content = msg.content;
                    } else if (Array.isArray(msg.content)) {
                        const textContent = msg.content.find(c => c.type === 'text');
                        content = textContent ? textContent.text : '[Image]';
                    }
                    return `${msg.role}: ${content.substring(0, 150)}`;
                })
                .join('\n');

            const titlePrompt = `Based on this conversation, generate a concise, descriptive title (maximum 4 words). Focus on the main topic or task being discussed:

${conversationSummary}

Title:`;

            const data = await this.sendChatCompletion([{
                role: 'user',
                content: titlePrompt
            }], {
                maxTokens: 20,
                temperature: 0.3
            });

            return data.choices[0].message.content.trim();
        } catch (error) {
            console.log('Smart title generation failed:', error);
            return null;
        }
    }
}

// Create singleton instance
export const apiManager = new APIManager();