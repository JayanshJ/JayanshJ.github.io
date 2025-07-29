// ChatGPT App Configuration
// The API key and settings are loaded from config.js
const API_URL = 'https://api.openai.com/v1/chat/completions';
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

// System prompt for enhanced technical assistance
const systemPrompt = {
    role: 'system',
    content: `You are a highly accurate and detail-focused assistant for programming and technical reasoning tasks. When given input, follow these principles:

1. Fully solve the problem; do not leave parts vague, omitted, or incomplete.
2. Avoid placeholders like "number > 0" or "X value" — instead, use meaningful variable names, or annotate with comments like /* unknown value */ if the value is unclear.
3. Return structured, readable output. Use code blocks with proper indentation and formatting.
4. When translating or analyzing code, preserve semantics and explain key decisions clearly.
5. Do not make assumptions unless necessary. If something is ambiguous, state it.
6. Use bullet points or sections if the task has multiple parts.
7. Output should be self-contained — assume the reader has not seen earlier messages.
8. Use helpful symbols and formatting in your responses: checkmarks ✓, bullet points •, arrows →, warning symbols ⚠️, and other visual indicators to make content more readable and engaging.
9. Format lists, steps, and key points with appropriate symbols and structure for better visual clarity.
10. Use these specific emojis for content categorization:
    • Tips/Best Practices → 💡
    • Examples → 📝
    • Summary/Conclusion → 📋
    • Errors/Issues → ⚠️
    • Success/Complete → ✅
    • Steps/Process → 🔄
    • Code/Implementation → 💻
    • Notes/Important → 📌
    • Questions/FAQ → ❓
    • References/Links → 🔗
    • Quotes/Highlights → ✨
    • Warnings → 🚨
    • Information → ℹ️
    • Updates/Changes → 🔄`
};

// Function to build messages array with system prompt
function buildMessagesWithSystem(conversationHistory) {
    // Only add system prompt for non-image models
    if (currentModel === 'gpt-image-1') {
        return conversationHistory;
    }
    return [systemPrompt, ...conversationHistory];
}

// Store conversation history
let conversationHistory = [];
let selectedImages = []; // Support multiple images
let selectedFiles = []; // Support multiple files
let currentModel = 'gpt-4.1-2025-04-14';
let currentChatId = null;
let chatHistory = [];
let chatFolders = [];
let currentFolderId = null;

// Storage Optimization Layer
class StorageOptimizer {
    constructor() {
        this.chatCache = new Map();
        this.maxCacheSize = 50;
        this.batchOperations = new Map();
        this.batchTimeout = null;
        this.lastCacheCleanup = Date.now();
        this.cleanupInterval = 5 * 60 * 1000; // 5 minutes
    }

    // LRU Cache implementation
    getCachedChat(chatId) {
        if (this.chatCache.has(chatId)) {
            // Move to end (most recently used)
            const chat = this.chatCache.get(chatId);
            this.chatCache.delete(chatId);
            this.chatCache.set(chatId, chat);
            return chat;
        }
        return null;
    }

    setCachedChat(chatId, chat) {
        // Remove oldest if cache is full
        if (this.chatCache.size >= this.maxCacheSize) {
            const firstKey = this.chatCache.keys().next().value;
            this.chatCache.delete(firstKey);
        }
        this.chatCache.set(chatId, { ...chat, cached: Date.now() });
    }

    // Batch save operations to reduce API calls
    batchSaveChat(chat) {
        this.batchOperations.set(chat.id, chat);
        
        // Debounce batch execution
        clearTimeout(this.batchTimeout);
        this.batchTimeout = setTimeout(() => {
            this.executeBatchSave();
        }, 1000); // 1 second debounce
    }

    async executeBatchSave() {
        if (this.batchOperations.size === 0) return;

        const chatsToSave = Array.from(this.batchOperations.values());
        this.batchOperations.clear();

        console.log(`💾 Batch saving ${chatsToSave.length} chats`);

        // Save to cache immediately for UI responsiveness
        chatsToSave.forEach(chat => {
            this.setCachedChat(chat.id, chat);
            // Update local chatHistory array
            const index = chatHistory.findIndex(c => c.id === chat.id);
            if (index >= 0) {
                chatHistory[index] = chat;
            } else {
                chatHistory.push(chat);
            }
        });

        // Save to Firebase in background
        try {
            if (window.chatStorage && window.chatStorage.getCurrentUser()) {
                // Save each chat (could be optimized with batch API)
                for (const chat of chatsToSave) {
                    await window.chatStorage.saveChat(chat);
                }
                console.log('✅ Batch save completed');
            }
        } catch (error) {
            console.warn('⚠️ Batch save failed:', error);
            // Could implement retry logic here
        }
    }

    // Optimistic update - update UI immediately, sync in background
    async optimisticSaveChat(chat) {
        // Update cache and UI immediately
        this.setCachedChat(chat.id, chat);
        
        // Update local array
        const index = chatHistory.findIndex(c => c.id === chat.id);
        if (index >= 0) {
            chatHistory[index] = chat;
        } else {
            chatHistory.push(chat);
        }

        // Update UI
        updateHistoryDisplay();

        // Save to server in background
        try {
            if (window.chatStorage && window.chatStorage.getCurrentUser()) {
                await window.chatStorage.saveChat(chat);
            }
        } catch (error) {
            console.warn('⚠️ Background save failed:', error);
            // Could show a "sync pending" indicator
        }
    }

    // Cleanup old cache entries
    cleanupCache() {
        const now = Date.now();
        if (now - this.lastCacheCleanup < this.cleanupInterval) return;

        const cutoffTime = now - (30 * 60 * 1000); // 30 minutes
        for (const [chatId, chat] of this.chatCache.entries()) {
            if (chat.cached < cutoffTime) {
                this.chatCache.delete(chatId);
            }
        }
        this.lastCacheCleanup = now;
        console.log(`🧹 Cache cleanup completed. Size: ${this.chatCache.size}`);
    }

    // Get chat with caching
    async getChat(chatId) {
        // Check cache first
        const cached = this.getCachedChat(chatId);
        if (cached) {
            return cached;
        }

        // Check local array
        const local = chatHistory.find(c => c.id === chatId);
        if (local) {
            this.setCachedChat(chatId, local);
            return local;
        }

        // Fetch from server as last resort
        try {
            if (window.chatStorage && window.chatStorage.getCurrentUser()) {
                const result = await window.chatStorage.getChat(chatId);
                if (result.success && result.chat) {
                    this.setCachedChat(chatId, result.chat);
                    return result.chat;
                }
            }
        } catch (error) {
            console.warn('⚠️ Failed to fetch chat from server:', error);
        }

        return null;
    }

    // Progressive loading - load recent chats first
    async loadChatsProgressive() {
        try {
            // Load recent chats first (last 10)
            if (window.chatStorage && window.chatStorage.getCurrentUser()) {
                const result = await window.chatStorage.getUserChats();
                if (result.success && result.chats) {
                    // Sort by last updated and take recent ones
                    const sortedChats = result.chats.sort((a, b) => 
                        (b.lastUpdated || b.timestamp || 0) - (a.lastUpdated || a.timestamp || 0)
                    );
                    
                    // Load first 10 immediately
                    const recentChats = sortedChats.slice(0, 10);
                    chatHistory = recentChats;
                    
                    // Cache them
                    recentChats.forEach(chat => this.setCachedChat(chat.id, chat));
                    
                    // Update UI with recent chats
                    updateHistoryDisplay();
                    
                    // Load remaining chats in background
                    if (sortedChats.length > 10) {
                        setTimeout(() => {
                            const remainingChats = sortedChats.slice(10);
                            chatHistory.push(...remainingChats);
                            remainingChats.forEach(chat => this.setCachedChat(chat.id, chat));
                            updateHistoryDisplay();
                        }, 1000);
                    }
                    
                    return true;
                }
            }
        } catch (error) {
            console.warn('⚠️ Progressive loading failed:', error);
        }
        return false;
    }
}

// Initialize storage optimizer
const storageOptimizer = new StorageOptimizer();

// Optimized save function - use this instead of direct Firebase calls
async function saveCurrentChatOptimized() {
    if (!currentChatId || conversationHistory.length === 0) return;

    const chat = {
        id: currentChatId,
        title: generateChatTitle(),
        messages: conversationHistory,
        timestamp: Date.now(),
        lastUpdated: Date.now(),
        model: currentModel,
        folderId: currentFolderId
    };

    // Use optimistic save for better UX
    await storageOptimizer.optimisticSaveChat(chat);
}

// Batch save function for multiple chats
function batchSaveChat(chat) {
    storageOptimizer.batchSaveChat(chat);
}

// Get chat with caching
async function getChatOptimized(chatId) {
    return await storageOptimizer.getChat(chatId);
}

// Main sendMessage function - this was missing!
async function sendMessage() {
    console.log('📤 sendMessage() called');
    
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) {
        console.error('Message input element not found!');
        return;
    }
    
    const message = messageInput.value.trim();
    
    // Check if it's an inline command first
    if (processInlineCommand(message)) {
        messageInput.value = ''; // Clear input after command
        hideCommandHints();
        return;
    }
    
    // If not a command, proceed with normal message sending
    if (!message && selectedImages.length === 0 && selectedFiles.length === 0) {
        return; // Don't send empty messages
    }
    
    // Clear the input immediately for better UX
    messageInput.value = '';
    hideCommandHints();
    
    // Call the async message sending function
    await sendMessageAsync();
}

// Add message function - this was also missing!
function addMessage(content, sender = 'user', type = 'normal', messageId = null) {
    console.log('📝 addMessage() called:', { content, sender, type, messageId });
    
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) {
        console.error('Messages container not found!');
        return null;
    }
    
    // Generate unique message ID if not provided
    if (!messageId) {
        messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.id = messageId;
    messageDiv.className = `message ${sender}-message`;
    
    // Add special classes for different types
    if (type === 'typing') {
        messageDiv.classList.add('typing-message');
    } else if (type === 'error') {
        messageDiv.classList.add('error-message');
    }
    
    // Create message content
    let messageContent = '';
    
    if (type === 'typing') {
        messageContent = `
            <div class="message-content">
                <div class="typing-indicator">
                    <div class="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                    <span class="typing-text">AI is thinking...</span>
                </div>
            </div>
        `;
    } else {
        messageContent = `
            <div class="message-content">
                <div class="message-text">${content}</div>
            </div>
        `;
    }
    
    messageDiv.innerHTML = messageContent;
    
    // Add to conversation history if it's a real message (not typing indicator)
    if (type !== 'typing' && content.trim()) {
        conversationHistory.push({
            role: sender === 'user' ? 'user' : 'assistant',
            content: content
        });
        
        // Save the chat when a new message is added
        saveCurrentChat();
    }
    
    // Append to messages container
    messagesContainer.appendChild(messageDiv);
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Auto-save chat if it's a real message
    if (type !== 'typing' && content.trim()) {
        setTimeout(() => {
            saveCurrentChatOptimized();
        }, 500);
    }
    
    return messageId;
}

// Remove message function
function removeMessage(messageId) {
    if (!messageId) return;
    
    const messageElement = document.getElementById(messageId);
    if (messageElement) {
        messageElement.remove();
        console.log('🗑️ Removed message:', messageId);
    }
}

// Inline Commands System
let inlineCommands = {
    '/yt': 'https://youtube.com',
    '/google': 'https://google.com',
    '/github': 'https://github.com',
    '/gmail': 'https://gmail.com',
    '/wiki': 'https://wikipedia.org',
    '/weather': 'https://weather.com',
    '/maps': 'https://maps.google.com',
    '/translate': 'https://translate.google.com',
    '/calculator': 'https://calculator.net',
    '/timer': 'https://timer.onlineclock.net',
    '/color': 'https://coolors.co',
    '/unsplash': 'https://unsplash.com',
    '/codepen': 'https://codepen.io',
    '/stackoverflow': 'https://stackoverflow.com',
    '/mdn': 'https://developer.mozilla.org',
    '/regex': 'https://regex101.com',
    '/json': 'https://jsonformatter.org'
};

// Load commands from localStorage and Firebase
async function loadInlineCommands() {
    console.log('🔄 Loading inline commands...');
    
    // First load from localStorage as fallback
    const saved = localStorage.getItem('inlineCommands');
    if (saved) {
        try {
            inlineCommands = JSON.parse(saved);
            console.log('📱 Loaded commands from localStorage:', Object.keys(inlineCommands).length);
        } catch (e) {
            console.warn('Failed to load inline commands from localStorage:', e);
        }
    }
    
    // If user is authenticated, try to load from Firebase
    if (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) {
        try {
            console.log('☁️ User authenticated, loading commands from Firebase...');
            const result = await window.chatStorage.getUserSettings();
            
            if (result.success && result.settings && result.settings.inlineCommands) {
                const cloudCommands = result.settings.inlineCommands;
                console.log('☁️ Loaded commands from Firebase:', Object.keys(cloudCommands).length);
                
                // Merge cloud commands with local ones (cloud takes precedence)
                inlineCommands = { ...inlineCommands, ...cloudCommands };
                
                // Update localStorage with merged commands
                localStorage.setItem('inlineCommands', JSON.stringify(inlineCommands));
                console.log('✅ Commands synced from cloud to local storage');
            } else {
                console.log('📝 No commands found in Firebase, using local only');
                // If no cloud commands exist but we have local ones, sync them to cloud
                if (Object.keys(inlineCommands).length > 0) {
                    console.log('⬆️ Syncing local commands to Firebase...');
                    await saveInlineCommandsToCloud();
                }
            }
        } catch (error) {
            console.warn('⚠️ Failed to load commands from Firebase:', error);
            console.log('📱 Falling back to localStorage only');
        }
    } else {
        console.log('🔒 User not authenticated, using localStorage only');
    }
}

// Save commands to localStorage and Firebase
async function saveInlineCommands() {
    console.log('💾 Saving inline commands...');
    
    // Always save to localStorage first
    localStorage.setItem('inlineCommands', JSON.stringify(inlineCommands));
    console.log('📱 Commands saved to localStorage');
    
    // If user is authenticated, also save to Firebase
    await saveInlineCommandsToCloud();
}

// Save commands to Firebase cloud storage
async function saveInlineCommandsToCloud() {
    if (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) {
        try {
            console.log('☁️ Saving commands to Firebase...');
            const currentUser = window.chatStorage.getCurrentUser();
            
            // Get existing user settings first
            const existingResult = await window.chatStorage.getUserSettings();
            let userSettings = {};
            
            if (existingResult.success && existingResult.settings) {
                userSettings = existingResult.settings;
            }
            
            // Update the inline commands in user settings
            userSettings.inlineCommands = inlineCommands;
            userSettings.lastUpdated = Date.now();
            
            // Save updated settings
            const result = await window.chatStorage.saveUserSettings(userSettings);
            
            if (result.success) {
                console.log('✅ Commands successfully saved to Firebase');
            } else {
                console.warn('⚠️ Failed to save commands to Firebase:', result.error);
            }
        } catch (error) {
            console.warn('⚠️ Error saving commands to Firebase:', error);
        }
    } else {
        console.log('🔒 User not authenticated, skipping cloud save');
    }
}

// Sync commands when user authentication state changes
async function syncCommandsOnAuthChange() {
    console.log('🔄 Syncing commands due to auth state change...');
    
    // Wait a moment for authentication to fully initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Reload commands from cloud if user is now authenticated
    await loadInlineCommands();
    
    // Update the commands modal if it's open
    const modal = document.getElementById('commandsModal');
    if (modal && modal.style.display === 'flex') {
        populateCommandsList();
    }
    
    console.log('✅ Commands sync completed');
}

// Process inline command
function processInlineCommand(input) {
    const trimmed = input.trim();
    if (trimmed in inlineCommands) {
        const url = inlineCommands[trimmed];
        window.open(url, '_blank');
        return true; // Command was processed
    }
    return false; // Not a command
}

// Open website in overlay
function openWebsiteOverlay(url, command) {
    console.log(`🌐 Opening ${command} (${url}) in overlay`);
    
    // Create overlay container
    const overlayId = 'websiteOverlay_' + Date.now();
    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.className = 'website-overlay';
    
    // Ensure URL has protocol
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    
    overlay.innerHTML = `
        <div class="website-overlay-content">
            <div class="website-overlay-header">
                <div class="website-overlay-info">
                    <div class="website-overlay-title">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                        </svg>
                        <span>${command}</span>
                    </div>
                    <div class="website-overlay-url">${fullUrl}</div>
                </div>
                <div class="website-overlay-controls">
                    <button class="overlay-btn refresh-btn" onclick="refreshWebsiteOverlay('${overlayId}')" title="Refresh">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"/>
                            <polyline points="1 20 1 14 7 14"/>
                            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                        </svg>
                    </button>
                    <button class="overlay-btn external-btn" onclick="openExternalLink('${fullUrl}')" title="Open in new tab">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15,3 21,3 21,9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                    </button>
                    <button class="overlay-btn minimize-btn" onclick="minimizeWebsiteOverlay('${overlayId}')" title="Minimize">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M6 9l6 6 6-6"/>
                        </svg>
                    </button>
                    <button class="overlay-btn close-btn" onclick="closeWebsiteOverlay('${overlayId}')" title="Close">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="website-overlay-body">
                <div class="website-loading">
                    <div class="loading-spinner"></div>
                    <span>Loading ${fullUrl}...</span>
                </div>
                <iframe 
                    src="${fullUrl}" 
                    frameborder="0" 
                    allowfullscreen
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation"
                    onload="handleIframeLoad('${overlayId}')"
                    onerror="showWebsiteError('${overlayId}', '${fullUrl}')"
                ></iframe>
            </div>
        </div>
        <div class="website-overlay-backdrop" onclick="closeWebsiteOverlay('${overlayId}')"></div>
    `;
    
    // Add to DOM
    document.body.appendChild(overlay);
    
    // Initialize drag functionality
    initializeWebsiteOverlayDrag(overlay);
    
    // Show with animation
    setTimeout(() => {
        overlay.classList.add('show');
    }, 10);
    
    // Set a timeout for loading and check for common blocking scenarios
    setTimeout(() => {
        const loadingElement = overlay.querySelector('.website-loading');
        const iframe = overlay.querySelector('iframe');
        
        if (loadingElement && loadingElement.style.display !== 'none') {
            console.log('⏰ Timeout reached, checking iframe status...');
            
            // Check if iframe is still loading or blocked
            try {
                if (iframe) {
                    const iframeSrc = iframe.src;
                    const iframeLocation = iframe.contentWindow?.location?.href;
                    
                    // Common signs of blocking
                    if (iframeLocation === 'about:blank' || 
                        iframeSrc === 'about:blank' || 
                        !iframeSrc || 
                        iframeSrc === fullUrl) {
                        
                        console.log('🚫 Website appears to be blocked or failed to load');
                        showWebsiteError(overlayId, fullUrl);
                    } else {
                        // Might have loaded, hide loading anyway
                        console.log('✅ Assuming website loaded successfully');
                        loadingElement.style.display = 'none';
                        iframe.style.display = 'block';
                    }
                }
            } catch (e) {
                console.log('❌ Error checking iframe, showing error state');
                showWebsiteError(overlayId, fullUrl);
            }
        }
    }, 5000); // Reduced to 5 second timeout for better UX
}

// Website overlay control functions
function closeWebsiteOverlay(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => {
            overlay.remove();
        }, 300); // Wait for animation
    }
}

function minimizeWebsiteOverlay(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        const content = overlay.querySelector('.website-overlay-content');
        const minimizeBtn = overlay.querySelector('.minimize-btn svg path');
        
        if (content.classList.contains('minimized')) {
            // Expand
            content.classList.remove('minimized');
            if (minimizeBtn) {
                minimizeBtn.setAttribute('d', 'M6 9l6 6 6-6'); // Down arrow
            }
        } else {
            // Minimize
            content.classList.add('minimized');
            if (minimizeBtn) {
                minimizeBtn.setAttribute('d', 'M18 15l-6-6-6 6'); // Up arrow
            }
        }
    }
}

function refreshWebsiteOverlay(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        const iframe = overlay.querySelector('iframe');
        const loading = overlay.querySelector('.website-loading');
        
        if (iframe && loading) {
            // Show loading
            loading.style.display = 'flex';
            iframe.style.display = 'none';
            
            // Reload iframe
            const currentSrc = iframe.src;
            iframe.src = 'about:blank';
            setTimeout(() => {
                iframe.src = currentSrc;
            }, 100);
        }
    }
}

function openExternalLink(url) {
    window.open(url, '_blank');
}

function handleIframeLoad(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        const loading = overlay.querySelector('.website-loading');
        const iframe = overlay.querySelector('iframe');
        
        if (loading && iframe) {
            // Check if iframe actually loaded content or was blocked
            try {
                // Try to access iframe content to detect if it's blocked
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                
                // If we can access it, hide loading
                setTimeout(() => {
                    loading.style.display = 'none';
                    iframe.style.display = 'block';
                }, 500); // Small delay to ensure content is visible
                
            } catch (e) {
                // If we can't access it, it might be blocked by X-Frame-Options
                console.warn('Iframe may be blocked by X-Frame-Options:', e);
                
                // Check if iframe src is about:blank (common when blocked)
                if (iframe.src === 'about:blank' || iframe.contentWindow.location.href === 'about:blank') {
                    showWebsiteError(overlayId, iframe.src);
                } else {
                    // Assume it loaded successfully even if we can't access it
                    loading.style.display = 'none';
                    iframe.style.display = 'block';
                }
            }
        }
    }
}

function hideWebsiteLoading(overlayId) {
    // Fallback function for compatibility
    handleIframeLoad(overlayId);
}

function showWebsiteError(overlayId, url) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        const loading = overlay.querySelector('.website-loading');
        
        if (loading) {
            loading.innerHTML = `
                <div class="website-error">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="15" y1="9" x2="9" y2="15"/>
                        <line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                    <div class="error-content">
                        <h3>Website Cannot Be Displayed</h3>
                        <p>This website blocks embedding in frames for security reasons.</p>
                        <p class="error-url">${url}</p>
                        <div class="error-suggestion">
                            <p><strong>💡 Try these overlay-friendly commands instead:</strong></p>
                            <div class="command-suggestions">
                                <code>/google</code> <code>/wiki</code> <code>/weather</code> <code>/calculator</code> <code>/translate</code>
                            </div>
                        </div>
                    </div>
                    <div class="error-actions">
                        <button class="external-btn primary" onclick="openExternalLink('${url}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                <polyline points="15,3 21,3 21,9"/>
                                <line x1="10" y1="14" x2="21" y2="3"/>
                            </svg>
                            Open in New Tab
                        </button>
                        <button class="retry-btn" onclick="refreshWebsiteOverlay('${overlayId}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="23 4 23 10 17 10"/>
                                <polyline points="1 20 1 14 7 14"/>
                                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                            </svg>
                            Try Again
                        </button>
                    </div>
                </div>
            `;
        }
    }
}

function initializeWebsiteOverlayDrag(overlay) {
    const header = overlay.querySelector('.website-overlay-header');
    const content = overlay.querySelector('.website-overlay-content');
    
    if (!header || !content) return;
    
    let isDragging = false;
    let startX, startY, startLeft, startTop;
    
    header.style.cursor = 'move';
    
    header.addEventListener('mousedown', (e) => {
        // Don't drag if clicking on buttons
        if (e.target.closest('button')) return;
        
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const rect = content.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        
        content.style.position = 'fixed';
        content.style.zIndex = '10001';
        
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        let newLeft = startLeft + deltaX;
        let newTop = startTop + deltaY;
        
        // Keep overlay within viewport
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const contentRect = content.getBoundingClientRect();
        
        newLeft = Math.max(20, Math.min(newLeft, viewportWidth - contentRect.width - 20));
        newTop = Math.max(20, Math.min(newTop, viewportHeight - contentRect.height - 20));
        
        content.style.left = newLeft + 'px';
        content.style.top = newTop + 'px';
        content.style.transform = 'none';
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// Command hints functionality
let commandHintsDropdown = null;
let selectedHintIndex = -1;

function showCommandHints(input) {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) return;

    // Filter commands based on input
    const query = input.toLowerCase();
    const matchingCommands = Object.entries(inlineCommands).filter(([command, url]) => 
        command.toLowerCase().includes(query)
    );

    if (matchingCommands.length === 0) {
        hideCommandHints();
        return;
    }

    // Create or update hints dropdown
    if (!commandHintsDropdown) {
        commandHintsDropdown = document.createElement('div');
        commandHintsDropdown.className = 'command-hints-dropdown';
        document.body.appendChild(commandHintsDropdown);
    }

    // Position the dropdown
    const inputRect = messageInput.getBoundingClientRect();
    commandHintsDropdown.style.left = inputRect.left + 'px';
    commandHintsDropdown.style.top = (inputRect.top - 10) + 'px';
    commandHintsDropdown.style.width = inputRect.width + 'px';

    // Populate hints
    commandHintsDropdown.innerHTML = '';
    matchingCommands.forEach(([command, url], index) => {
        const hintItem = document.createElement('div');
        hintItem.className = 'command-hint-item';
        if (index === selectedHintIndex) {
            hintItem.classList.add('selected');
        }
        
        hintItem.innerHTML = `
            <div class="hint-command">${command}</div>
            <div class="hint-url">${url}</div>
        `;
        
        hintItem.addEventListener('click', () => {
            messageInput.value = command;
            hideCommandHints();
            messageInput.focus();
        });
        
        commandHintsDropdown.appendChild(hintItem);
    });

    commandHintsDropdown.style.display = 'block';
    selectedHintIndex = -1; // Reset selection
}

function hideCommandHints() {
    if (commandHintsDropdown) {
        commandHintsDropdown.style.display = 'none';
    }
    selectedHintIndex = -1;
}

function navigateHints(direction) {
    if (!commandHintsDropdown || commandHintsDropdown.style.display === 'none') return false;
    
    const hintItems = commandHintsDropdown.querySelectorAll('.command-hint-item');
    if (hintItems.length === 0) return false;

    // Remove current selection
    if (selectedHintIndex >= 0 && selectedHintIndex < hintItems.length) {
        hintItems[selectedHintIndex].classList.remove('selected');
    }

    // Update selection
    if (direction === 'down') {
        selectedHintIndex = (selectedHintIndex + 1) % hintItems.length;
    } else if (direction === 'up') {
        selectedHintIndex = selectedHintIndex <= 0 ? hintItems.length - 1 : selectedHintIndex - 1;
    }

    // Apply new selection
    if (selectedHintIndex >= 0 && selectedHintIndex < hintItems.length) {
        hintItems[selectedHintIndex].classList.add('selected');
        hintItems[selectedHintIndex].scrollIntoView({ block: 'nearest' });
    }

    return true;
}

function selectCurrentHint() {
    if (!commandHintsDropdown || commandHintsDropdown.style.display === 'none') return false;
    
    const hintItems = commandHintsDropdown.querySelectorAll('.command-hint-item');
    if (selectedHintIndex >= 0 && selectedHintIndex < hintItems.length) {
        const selectedItem = hintItems[selectedHintIndex];
        const command = selectedItem.querySelector('.hint-command').textContent;
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.value = command;
            hideCommandHints();
            messageInput.focus();
        }
        return true;
    }
    return false;
}

// Commands Modal Functions
function showCommandsModal() {
    closeSettingsModal();
    const modal = document.getElementById('commandsModal');
    if (modal) {
        populateCommandsList();
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeCommandsModal() {
    const modal = document.getElementById('commandsModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        // Clear input fields
        document.getElementById('newCommandName').value = '';
        document.getElementById('newCommandUrl').value = '';
    }
}

function populateCommandsList() {
    const commandsList = document.getElementById('commandsList');
    if (!commandsList) return;
    
    commandsList.innerHTML = '';
    
    // Add sync status indicator
    const syncStatus = document.createElement('div');
    syncStatus.className = 'commands-sync-status';
    const isAuthenticated = window.chatStorage && window.chatStorage.getCurrentUser();
    
    if (isAuthenticated) {
        syncStatus.innerHTML = `
            <div class="sync-indicator synced">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 6L9 17l-5-5"/>
                </svg>
                <span>Commands synced to cloud</span>
            </div>
        `;
    } else {
        syncStatus.innerHTML = `
            <div class="sync-indicator local-only">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    <polyline points="3.27,6.96 12,12.01 20.73,6.96"/>
                    <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
                <span>Commands stored locally only - <a href="#" onclick="showSettingsModal()" style="color: var(--accent-primary);">Sign in</a> to sync across devices</span>
            </div>
        `;
    }
    
    commandsList.appendChild(syncStatus);
    
    if (Object.keys(inlineCommands).length === 0) {
        const noCommands = document.createElement('div');
        noCommands.className = 'no-commands';
        noCommands.textContent = 'No commands configured yet.';
        commandsList.appendChild(noCommands);
        return;
    }
    
    Object.entries(inlineCommands).forEach(([command, url]) => {
        const commandItem = document.createElement('div');
        commandItem.className = 'command-item';
        commandItem.innerHTML = `
            <div class="command-info">
                <div class="command-name">${command}</div>
                <div class="command-url">${url}</div>
            </div>
            <button class="command-delete-btn" onclick="deleteCommand('${command}')" title="Delete command">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18"/>
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                </svg>
            </button>
        `;
        commandsList.appendChild(commandItem);
    });
}

async function addNewCommand() {
    const nameInput = document.getElementById('newCommandName');
    const urlInput = document.getElementById('newCommandUrl');
    
    const command = nameInput.value.trim();
    const url = urlInput.value.trim();
    
    if (!command || !url) {
        alert('❌ Please enter both command and URL');
        return;
    }
    
    if (!command.startsWith('/')) {
        alert('❌ Command must start with /');
        return;
    }
    
    try {
        new URL(url); // Validate URL
    } catch (e) {
        alert('❌ Please enter a valid URL');
        return;
    }
    
    if (command in inlineCommands) {
        if (!confirm(`⚠️ Command "${command}" already exists. Do you want to replace it?`)) {
            return;
        }
    }
    
    inlineCommands[command] = url;
    await saveInlineCommands();
    populateCommandsList();
    
    // Clear inputs
    nameInput.value = '';
    urlInput.value = '';
    
    alert(`✅ Command "${command}" added successfully!`);
}

async function deleteCommand(command) {
    if (confirm(`❓ Are you sure you want to delete the command "${command}"?`)) {
        delete inlineCommands[command];
        await saveInlineCommands();
        populateCommandsList();
        alert(`✅ Command "${command}" deleted successfully!`);
    }
}




// Voice recording variables - Using MediaRecorder for GPT-4o-transcribe
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// Track active requests per chat to prevent race conditions
let activeRequestTokens = new Map(); // chatId -> requestToken



// Load chat history from Firebase with optimization
async function loadChatHistory() {
    // Store current chat ID to preserve it if possible
    const previousChatId = currentChatId;
    console.log('Loading chat history, preserving current chat ID:', previousChatId);
    
    try {
        // Check if Firebase and authentication are available
        let authRetries = 0;
        const maxRetries = 6; // Reduced to 3 seconds total
        while ((!window.chatStorage || !window.chatStorage.getCurrentUser()) && authRetries < maxRetries) {
            if (authRetries === 0) {
                console.log('🔒 User not authenticated, using localStorage only');
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            authRetries++;
        }
        
        // Load from Firebase only if user is authenticated
        if (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) {
            console.log('User authenticated, using progressive loading...');
            
            // Use progressive loading for better performance
            const loaded = await storageOptimizer.loadChatsProgressive();
            if (!loaded) {
                // Fallback to original method
                const result = await window.chatStorage.getUserChats();
                if (result.success && result.chats) {
                    chatHistory = result.chats;
                    console.log(`Loaded ${result.chats.length} chats from Firebase (fallback)`);
                } else if (result.error && result.error !== 'User not authenticated') {
                    console.warn('Firebase load error:', result.error);
                    chatHistory = []; // Start with empty history on error
                }
            }
        } else {
            console.log('User not authenticated, chat history requires login');
            
            // In development, try to load from localStorage fallback
            if (isLocalDevelopment()) {
                console.log('💾 Development mode: trying localStorage fallback');
                try {
                    const saved = localStorage.getItem('chatgpt_history_dev');
                    if (saved) {
                        chatHistory = JSON.parse(saved);
                        console.log(`✅ Loaded ${chatHistory.length} chats from localStorage (development fallback)`);
                    } else {
                        chatHistory = [];
                    }
                } catch (devError) {
                    console.warn('Failed to load from localStorage:', devError);
                    chatHistory = [];
                }
            } else {
                chatHistory = []; // Empty history when not authenticated in production
            }
        }
        
    } catch (e) {
        console.error('Error loading chat history:', e);
        
        // In development, try localStorage fallback on any error
        if (isLocalDevelopment()) {
            console.log('💾 Error loading from Firebase, trying localStorage fallback');
            try {
                const saved = localStorage.getItem('chatgpt_history_dev');
                if (saved) {
                    chatHistory = JSON.parse(saved);
                    console.log(`✅ Loaded ${chatHistory.length} chats from localStorage (error fallback)`);
                } else {
                    chatHistory = [];
                }
            } catch (devError) {
                console.warn('Failed to load from localStorage:', devError);
                chatHistory = [];
            }
        } else {
            chatHistory = []; // Start with empty history on any error in production
        }
    }
    await loadChatFolders();
    
    // Try to restore the previous current chat ID if it still exists
    if (previousChatId) {
        const previousChatExists = chatHistory.find(chat => chat.id === previousChatId);
        if (previousChatExists) {
            console.log('Restoring previous current chat ID:', previousChatId);
            currentChatId = previousChatId;
            // Load the conversation history for the current chat
            conversationHistory = [...previousChatExists.messages];
            // Update the UI to show the current chat messages
            redisplayConversation();
        } else {
            console.log('Previous chat ID no longer exists, clearing current chat');
            currentChatId = null;
            conversationHistory = [];
        }
    }
    
    updateHistoryDisplay();
}

// Function to redisplay conversation messages without changing chat state
function redisplayConversation() {
    console.log('Redisplaying conversation with', conversationHistory.length, 'messages');
    
    // Clear current messages
    const messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = '';
    
    // Display all messages from the conversation history
    conversationHistory.forEach(message => {
        if (message.role === 'user') {
            let text = '';
            let image = null;
            
            if (typeof message.content === 'string') {
                text = message.content;
            } else if (Array.isArray(message.content)) {
                const textContent = message.content.find(c => c.type === 'text');
                const imageContent = message.content.find(c => c.type === 'image_url');
                
                if (textContent) {
                    text = textContent.text;
                }
                if (imageContent) {
                    image = imageContent.image_url.url;
                }
            }
            
            addMessage(text, 'user', 'normal', image);
        } else if (message.role === 'assistant') {
            addMessage(message.content, 'ai');
        }
    });
}


// Load chat folders from Firebase only
async function loadChatFolders() {
    try {
        // Check if Firebase and authentication are available for folders
        let authRetries = 0;
        const maxRetries = 4; // Reduced to 2 seconds for folders
        while ((!window.chatStorage || !window.chatStorage.getCurrentUser()) && authRetries < maxRetries) {
            if (authRetries === 0) {
                console.log('📁 Loading folders from localStorage (user not authenticated)');
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            authRetries++;
        }
        
        // Load from Firebase only if user is authenticated
        if (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) {
            console.log('User authenticated, loading folders from Firebase...');
            
            const result = await window.chatStorage.getUserFolders();
            if (result.success && result.folders) {
                chatFolders = result.folders;
                console.log(`Loaded ${result.folders.length} folders from Firebase`);
            } else if (result.error && result.error !== 'User not authenticated') {
                console.warn('Firebase folder load error:', result.error);
                chatFolders = []; // Start with empty folders on error
            }
        } else {
            console.log('User not authenticated, loading folders from localStorage');
            // Load from localStorage when not authenticated
            try {
                const saved = localStorage.getItem('chatgpt_folders_dev');
                if (saved) {
                    chatFolders = JSON.parse(saved);
                    console.log(`📁 Loaded ${chatFolders.length} folders from localStorage:`, chatFolders.map(f => ({ id: f.id, name: f.name })));
                } else {
                    console.log('📁 No folders found in localStorage');
                    chatFolders = [];
                }
            } catch (error) {
                console.error('❌ Error loading folders from localStorage:', error);
                chatFolders = [];
            }
        }
    } catch (e) {
        console.error('Error loading chat folders:', e);
        chatFolders = []; // Start with empty folders on any error
    }
}

// Merge folders from different sources, keeping the most recent version

// Save chat folders to Firebase only
let folderSavingInProgress = false;
async function saveChatFolders() {
    if (folderSavingInProgress) {
        console.log('Folder save already in progress, skipping...');
        return;
    }
    
    folderSavingInProgress = true;
    try {
        // First, update all folders with current timestamp
        const currentTime = Date.now();
        chatFolders.forEach(folder => {
            if (!folder.lastUpdated || folder.lastUpdated < currentTime - 1000) {
                folder.lastUpdated = currentTime;
            }
        });
        
        // Save to cloud if signed in, localStorage if not
        // Check multiple auth sources to ensure we detect signed-in state
        const isAuthenticated = (
            (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) ||
            (typeof window.firebaseAuth !== 'undefined' && window.firebaseAuth && window.firebaseAuth.currentUser) ||
            (typeof window.authFunctions !== 'undefined' && window.authFunctions && window.authFunctions.getCurrentUser && window.authFunctions.getCurrentUser())
        );
        
        if (isAuthenticated) {
            console.log(`☁️ User signed in - saving ${chatFolders.length} folders to Firebase...`);
            
            try {
                const result = await window.chatStorage.saveFolders(chatFolders);
                if (result.success) {
                    console.log('✅ Folders saved to Firebase');
                } else {
                    console.warn('⚠️ Failed to save folders to Firebase:', result.error);
                }
            } catch (error) {
                console.warn('⚠️ Firebase folder save failed:', error);
            }
        } else {
            // User not signed in - save to localStorage
            try {
                localStorage.setItem('chatgpt_folders_dev', JSON.stringify(chatFolders));
                console.log(`📁 User not signed in - saved ${chatFolders.length} folders to localStorage`);
                console.log('📁 Folders saved to localStorage:', chatFolders.map(f => ({ id: f.id, name: f.name })));
            } catch (error) {
                console.error('❌ Failed to save folders to localStorage:', error);
                throw error;
            }
        }
    } catch (e) {
        console.error('Error saving chat folders:', e);
    } finally {
        folderSavingInProgress = false;
    }
}

// Create a new folder
async function createFolder() {
    const folderName = prompt('Enter folder name:');
    if (folderName && folderName.trim()) {
        const newFolder = {
            id: 'folder_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            name: folderName.trim(),
            chats: [],
            expanded: true,
            createdAt: Date.now()
        };
        
        // Add userId if user is authenticated
        if (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) {
            newFolder.userId = window.chatStorage.getCurrentUser().uid;
        }
        chatFolders.push(newFolder);
        await saveChatFolders();
        updateHistoryDisplay();
    }
}

// Delete a folder (async implementation)
async function deleteFolderAsync(folderId) {
    console.log('🗑️ deleteFolderAsync called for:', folderId);
    console.log('📁 Current folders:', chatFolders.map(f => ({ id: f.id, name: f.name })));
    
    const folder = chatFolders.find(f => f.id === folderId);
    if (!folder) {
        console.error('❌ Folder not found:', folderId);
        return;
    }
    
    console.log('📂 Found folder to delete:', folder.name, 'with', folder.chats.length, 'chats');
    
    const confirmMessage = folder.chats.length > 0 
        ? `Delete folder "${folder.name}" and its ${folder.chats.length} chat(s)? This cannot be undone.`
        : `Delete folder "${folder.name}"?`;
    
    if (confirm(confirmMessage)) {
        console.log('✅ User confirmed deletion');
        
        // Remove all chats from this folder from main chatHistory
        const chatsToDelete = [...folder.chats]; // Copy array to avoid mutation issues
        console.log('🗑️ Deleting chats:', chatsToDelete);
        
        chatsToDelete.forEach(chatId => {
            chatHistory = chatHistory.filter(chat => chat.id !== chatId);
        });
        
        // Remove the folder
        const originalFolderCount = chatFolders.length;
        chatFolders = chatFolders.filter(f => f.id !== folderId);
        console.log(`📁 Folders: ${originalFolderCount} → ${chatFolders.length}`);
        
        try {
            debouncedSave();
            await saveChatFolders();
            updateHistoryDisplay();
            console.log('✅ Folder deleted successfully');
        } catch (error) {
            console.error('❌ Error saving after folder deletion:', error);
            throw error;
        }
        
        // If current chat was in this folder, start new chat
        if (currentFolderId === folderId) {
            startNewChat();
        }
    }
}

// Rename a folder
// Global variable to store folder ID being renamed
let currentRenamingFolderId = null;
// Global variable to store chat ID being moved
let currentMovingChatId = null;

function renameFolder(folderId) {
    const folder = chatFolders.find(f => f.id === folderId);
    if (!folder) return;
    
    // Store the folder ID and show the modal
    currentRenamingFolderId = folderId;
    const modal = document.getElementById('renameFolderModal');
    const input = document.getElementById('folderNameInput');
    
    if (modal && input) {
        input.value = folder.name; // Pre-fill with current name
        modal.style.display = 'flex';
        input.focus();
        input.select(); // Select all text for easy editing
        document.body.style.overflow = 'hidden';
    }
}

function closeRenameFolderModal() {
    const modal = document.getElementById('renameFolderModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        currentRenamingFolderId = null;
    }
}

async function saveFolderName() {
    const input = document.getElementById('folderNameInput');
    const newName = input.value.trim();
    
    if (!newName) {
        alert('❌ Please enter a folder name');
        return;
    }
    
    if (currentRenamingFolderId) {
        const folder = chatFolders.find(f => f.id === currentRenamingFolderId);
        if (folder && newName !== folder.name) {
            folder.name = newName;
            await saveChatFolders();
            updateHistoryDisplay();
        }
    }
    
    closeRenameFolderModal();
}

// Toggle folder expanded/collapsed state
async function toggleFolder(folderId) {
    const folder = chatFolders.find(f => f.id === folderId);
    if (folder) {
        folder.expanded = !folder.expanded;
        await saveChatFolders();
        updateHistoryDisplay();
    }
}

// Move chat to folder
async function moveChatToFolder(chatId, targetFolderId) {
    // Remove chat from any existing folder
    chatFolders.forEach(folder => {
        folder.chats = folder.chats.filter(id => id !== chatId);
    });
    
    // Add to target folder if specified
    if (targetFolderId) {
        const targetFolder = chatFolders.find(f => f.id === targetFolderId);
        if (targetFolder) {
            targetFolder.chats.push(chatId);
        }
    }
    
    await saveChatFolders();
    updateHistoryDisplay();
}

// Start new chat in specific folder
function startNewChatInFolder(folderId) {
    currentFolderId = folderId;
    startNewChat(true); // Pass true to preserve folder context
}

// Save chat history to Firebase (with localStorage fallback for development)
let savingInProgress = false;
let saveTimeout = null;

// Development fallback - detect if we're running locally
function isLocalDevelopment() {
    return window.location.hostname === '127.0.0.1' || 
           window.location.hostname === 'localhost' || 
           window.location.protocol === 'file:';
}

// Debounced save function to prevent too frequent saves
function debouncedSave() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
        saveChatHistory();
    }, 1000); // Wait 1 second after last change
}

// Immediate save for critical operations
async function immediateSave() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    await saveChatHistory();
}

// Sync with Firebase when coming back online
async function syncChatsWithFirebase() {
    if (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) {
        console.log('🔄 Syncing chats and folders with Firebase...');
        await saveChatHistory(); // This will sync all local changes
        await saveChatFolders(); // Also sync folders
    }
}
async function saveChatHistory() {
    // Prevent concurrent saves
    if (savingInProgress) {
        console.log('Save already in progress, skipping...');
        return;
    }
    
    savingInProgress = true;
    try {
        // First, update all chats with current timestamp
        const currentTime = Date.now();
        chatHistory.forEach(chat => {
            if (!chat.lastUpdated || chat.lastUpdated < currentTime - 1000) {
                chat.lastUpdated = currentTime;
            }
        });
        
        // Save to cloud if signed in, localStorage if not
        // Check multiple auth sources to ensure we detect signed-in state
        const isAuthenticated = (
            (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) ||
            (typeof window.firebaseAuth !== 'undefined' && window.firebaseAuth && window.firebaseAuth.currentUser) ||
            (typeof window.authFunctions !== 'undefined' && window.authFunctions && window.authFunctions.getCurrentUser && window.authFunctions.getCurrentUser())
        );
        
        console.log('🔍 Auth check:', {
            chatStorage: typeof window.chatStorage !== 'undefined' && window.chatStorage ? window.chatStorage.getCurrentUser() : 'undefined',
            firebaseAuth: typeof window.firebaseAuth !== 'undefined' && window.firebaseAuth ? window.firebaseAuth.currentUser : 'undefined',
            authFunctions: typeof window.authFunctions !== 'undefined' && window.authFunctions ? window.authFunctions.getCurrentUser() : 'undefined'
        });
        
        if (isAuthenticated) {
            console.log(`☁️ User signed in - saving ${chatHistory.length} chats to Firebase...`);
            
            // Check if we're in development and warn about CORS
            if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
                console.warn('⚠️ Running in development mode - CORS issues may occur with Firebase API');
            }
            
            // Save chats in parallel with retry logic
            const savePromises = chatHistory.map(async (chat) => {
                const maxRetries = 3;
                let retryCount = 0;
                
                while (retryCount < maxRetries) {
                    try {
                        const result = await window.chatStorage.saveChat(chat);
                        if (result.success) {
                            return { success: true, chatId: chat.id };
                        } else if (result.error && result.error.includes('token')) {
                            // Token expired, try to refresh
                            console.log('Token expired for chat', chat.id, 'attempting refresh...');
                            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                            retryCount++;
                        } else {
                            console.warn(`Failed to save chat ${chat.id}:`, result.error);
                            return { success: false, chatId: chat.id, error: result.error };
                        }
                    } catch (error) {
                        console.warn(`Error saving chat ${chat.id}, attempt ${retryCount + 1}:`, error);
                        retryCount++;
                        if (retryCount < maxRetries) {
                            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                        }
                    }
                }
                return { success: false, chatId: chat.id, error: 'Max retries exceeded' };
            });
            
            const results = await Promise.allSettled(savePromises);
            const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            
            console.log(`✅ Successfully saved ${successCount}/${chatHistory.length} chats to Firebase`);
            
            // Check for any failures and log them
            const failures = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));
            if (failures.length > 0) {
                console.warn(`${failures.length} chats failed to save to Firebase`);
            }
        } else {
            // User not signed in - save to localStorage
            localStorage.setItem('chatgpt_history_dev', JSON.stringify(chatHistory));
            console.log(`💾 User not signed in - saved ${chatHistory.length} chats to localStorage`);
        }
    } catch (e) {
        console.error('Error saving chat history:', e);
        
        // In development, use localStorage as fallback on any Firebase error
        if (isLocalDevelopment()) {
            console.log('💾 Firebase failed, using localStorage fallback for development');
            try {
                localStorage.setItem('chatgpt_history_dev', JSON.stringify(chatHistory));
                console.log('✅ Saved to localStorage (development fallback)');
            } catch (devError) {
                console.warn('Failed to save to localStorage:', devError);
            }
        }
        
        // Special handling for CORS errors
        if (e.message && (e.message.includes('CORS') || e.message.includes('Failed to fetch'))) {
            console.warn('💡 Network error - this is expected in development. Chats saved locally.');
        }
    } finally {
        savingInProgress = false;
    }
}






// Confirmation modal utility functions
let confirmationCallback = null;

function showConfirmationModal(title, message, icon, callback) {
    const modal = document.getElementById('confirmationModal');
    const titleElement = document.getElementById('confirmationTitle');
    const messageElement = document.getElementById('confirmationMessage');
    const iconElement = document.getElementById('confirmationIcon');
    
    if (modal && titleElement && messageElement && iconElement) {
        titleElement.textContent = title;
        messageElement.textContent = message;
        iconElement.textContent = icon;
        confirmationCallback = callback;
        
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeConfirmationModal() {
    const modal = document.getElementById('confirmationModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        confirmationCallback = null;
    }
}

function confirmAction() {
    if (confirmationCallback) {
        confirmationCallback();
    }
}


// Process and format text with LaTeX rendering
// Formatting assistant function to clean up AI responses
function formatAIResponse(text) {
    if (!text) return '';
    
    // Step 1: Normalize line breaks and clean up
    let formatted = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Step 2: Fix heading formatting - ensure proper spacing
    formatted = formatted.replace(/^(#{1,6}\s*)(.*?)$/gm, (match, hashes, content) => {
        return `\n${hashes}${content.trim()}\n`;
    });
    
    // Step 3: Fix list formatting - ensure proper spacing
    formatted = formatted.replace(/^(\s*[-•*]\s+)/gm, '\n$1');
    formatted = formatted.replace(/^(\s*\d+\.\s+)/gm, '\n$1');
    
    // Step 4: Ensure proper spacing around code blocks
    formatted = formatted.replace(/(```[\s\S]*?```)/g, '\n$1\n');
    
    // Step 5: Fix bullet point formatting consistency
    formatted = formatted.replace(/^(\s*)[-•*](\s+)/gm, '$1- ');
    
    // Step 6: Add subtle emojis for common patterns (only if not already present)
    const emojiPatterns = [
        { pattern: /^(#{1,3}\s+)(Tips?|Tip:|Best Practices?|Best Practice:|Recommendations?:?)/gim, emoji: '💡 ' },
        { pattern: /^(#{1,3}\s+)(Examples?|Example:|Samples?:?)/gim, emoji: '📝 ' },
        { pattern: /^(#{1,3}\s+)(Summary|Conclusion|Overview:?)/gim, emoji: '📋 ' },
        { pattern: /^(#{1,3}\s+)(Error|Errors?|Issues?|Problems?|Troubleshooting:?)/gim, emoji: '⚠️ ' },
        { pattern: /^(#{1,3}\s+)(Success|Complete|Done|Solution:?)/gim, emoji: '✅ ' },
        { pattern: /^(#{1,3}\s+)(Steps?|Process|Procedure|Instructions?:?)/gim, emoji: '🔄 ' },
        { pattern: /^(#{1,3}\s+)(Code|Implementation|Development:?)/gim, emoji: '💻 ' },
        { pattern: /^(#{1,3}\s+)(Note|Important:?)/gim, emoji: '📌 ' },
        { pattern: /^(#{1,3}\s+)(Questions?|FAQ|Q&A:?)/gim, emoji: '❓ ' },
        { pattern: /^(#{1,3}\s+)(References?|Links?:?)/gim, emoji: '🔗 ' },
        { pattern: /^(#{1,3}\s+)(Quotes?|Highlights?:?)/gim, emoji: '✨ ' },
        { pattern: /^(#{1,3}\s+)(Warnings?|Caution:?)/gim, emoji: '🚨 ' },
        { pattern: /^(#{1,3}\s+)(Information|Info:?)/gim, emoji: 'ℹ️ ' },
        { pattern: /^(#{1,3}\s+)(Updates?|Changelog:?)/gim, emoji: '🆕 ' }
    ];
    
    emojiPatterns.forEach(({ pattern, emoji }) => {
        formatted = formatted.replace(pattern, (match, hashes, content) => {
            // Only add emoji if it's not already there
            if (!content.match(/^[🎯💡📝📋⚠️✅�🔄💻📌]/)) {
                return `${hashes}${emoji}${content}`;
            }
            return match;
        });
    });
    
    // Step 7: Remove unwanted separator lines (like ---, ===, etc.)
    formatted = formatted.replace(/^\s*[-=_]{3,}\s*$/gm, ''); // Remove lines with only dashes, equals, or underscores
    
    // Step 8: Clean up excessive line breaks
    formatted = formatted.replace(/\n{4,}/g, '\n\n\n'); // Max 3 consecutive line breaks
    formatted = formatted.replace(/^\n+/, ''); // Remove leading line breaks
    formatted = formatted.replace(/\n+$/, ''); // Remove trailing line breaks
    
    // Step 9: Ensure proper spacing between sections
    formatted = formatted.replace(/(\n#{1,6}[^\n]+\n)([^\n#])/g, '$1\n$2');
    
    // Step 10: Clean up extra whitespace
    formatted = formatted.replace(/[ \t]+/g, ' '); // Normalize spaces
    formatted = formatted.replace(/^ +| +$/gm, ''); // Trim each line
    
    return formatted;
}

// Syntax highlighting function
function applySyntaxHighlighting(code, language = '') {
    // Detect language if not specified
    if (!language) {
        language = detectLanguage(code);
    }
    
    language = language.toLowerCase();
    
    // Apply syntax highlighting based on language
    switch (language) {
        case 'javascript':
        case 'js':
            return highlightJavaScript(code);
        case 'python':
        case 'py':
            return highlightPython(code);
        case 'html':
            return highlightHTML(code);
        case 'css':
            return highlightCSS(code);
        case 'json':
            return highlightJSON(code);
        case 'bash':
        case 'shell':
        case 'sh':
            return highlightShell(code);
        case 'sql':
            return highlightSQL(code);
        case 'typescript':
        case 'ts':
            return highlightTypeScript(code);
        case 'c':
        case 'cpp':
        case 'c++':
        case 'cc':
            return highlightC(code);
        case 'java':
            return highlightJava(code);
        case 'go':
        case 'golang':
            return highlightGo(code);
        case 'rust':
        case 'rs':
            return highlightRust(code);
        case 'php':
            return highlightPHP(code);
        case 'ruby':
        case 'rb':
            return highlightRuby(code);
        case 'swift':
            return highlightSwift(code);
        case 'kotlin':
        case 'kt':
            return highlightKotlin(code);
        case 'csharp':
        case 'cs':
        case 'c#':
            return highlightCSharp(code);
        case 'dart':
        case 'flutter':
            return highlightDart(code);
        default:
            return highlightGeneric(code);
    }
}

// Language detection function
function detectLanguage(code) {
    const trimmed = code.trim();
    
    // JavaScript/TypeScript patterns
    if (trimmed.includes('function') || trimmed.includes('const ') || trimmed.includes('let ') || 
        trimmed.includes('var ') || trimmed.includes('=>') || trimmed.includes('console.log')) {
        return trimmed.includes('interface ') || trimmed.includes(': string') || trimmed.includes(': number') 
            ? 'typescript' : 'javascript';
    }
    
    // Python patterns
    if (trimmed.includes('def ') || trimmed.includes('import ') || trimmed.includes('print(') || 
        trimmed.includes('if __name__') || /^\s*#.*python/i.test(trimmed)) {
        return 'python';
    }
    
    // HTML patterns
    if (trimmed.includes('<html') || trimmed.includes('<!DOCTYPE') || 
        /<\/?[a-z][\s\S]*>/i.test(trimmed)) {
        return 'html';
    }
    
    // CSS patterns
    if (trimmed.includes('{') && trimmed.includes('}') && trimmed.includes(':') && 
        (trimmed.includes('color') || trimmed.includes('margin') || trimmed.includes('padding'))) {
        return 'css';
    }
    
    // JSON patterns
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            JSON.parse(trimmed);
            return 'json';
        } catch (e) {
            // Not valid JSON
        }
    }
    
    // Shell/Bash patterns
    if (trimmed.includes('#!/bin/') || trimmed.includes('$ ') || 
        /^(cd|ls|mkdir|cp|mv|rm|grep|find|cat)\s+/m.test(trimmed)) {
        return 'shell';
    }
    
    // SQL patterns
    if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(trimmed)) {
        return 'sql';
    }
    
    return 'generic';
}

// JavaScript syntax highlighting  
function highlightJavaScript(code) {
    // Simple approach: escape HTML first, then highlight
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    
    // Auto-indent JavaScript code
    const indented = autoIndentCode(escaped);
    
    return indented
        .replace(/\b(function|const|let|var|if|else|for|while|do|switch|case|break|continue|return|try|catch|finally|throw|async|await|class|extends|import|export|default|from)\b/g, '<span class="keyword">$1</span>')
        .replace(/\b(true|false|null|undefined|this|new|typeof|instanceof)\b/g, '<span class="keyword">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>')
        .replace(/&quot;([^&])*?&quot;/g, '<span class="string">$&</span>')
        .replace(/&#x27;([^&])*?&#x27;/g, '<span class="string">$&</span>')
        .replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>')
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>')
        .replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g, '<span class="function">$1</span>');
}

// Python syntax highlighting
function highlightPython(code) {
    // First escape HTML entities
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    
    // Auto-indent Python code
    const indented = autoIndentPython(escaped);
    
    return indented
        .replace(/\b(def|class|if|elif|else|for|while|try|except|finally|with|as|import|from|return|yield|break|continue|pass|raise|assert|global|nonlocal|lambda|and|or|not|in|is)\b/g, '<span class="keyword">$1</span>')
        .replace(/\b(True|False|None)\b/g, '<span class="keyword">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>')
        .replace(/&quot;([^&]|&(?!quot;))*?&quot;/g, '<span class="string">$&</span>')
        .replace(/&#x27;([^&]|&(?!#x27;))*?&#x27;/g, '<span class="string">$&</span>')
        .replace(/(#.*$)/gm, '<span class="comment">$1</span>')
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="function">$1</span>');
}

// HTML syntax highlighting
function highlightHTML(code) {
    return code
        .replace(/(&lt;\/?[a-zA-Z][^&gt;]*&gt;)/g, '<span class="tag">$1</span>')
        .replace(/(<\/?[a-zA-Z][^>]*>)/g, '<span class="tag">$1</span>')
        .replace(/\s([a-zA-Z-]+)=/g, ' <span class="attribute">$1</span>=')
        .replace(/(["'])((?:\\.|(?!\1)[^\\])*?)\1/g, '<span class="string">$1$2$1</span>');
}

// CSS syntax highlighting
function highlightCSS(code) {
    return code
        .replace(/([.#]?[a-zA-Z][a-zA-Z0-9-]*)\s*\{/g, '<span class="class">$1</span> {')
        .replace(/([a-zA-Z-]+)\s*:/g, '<span class="property">$1</span>:')
        .replace(/:\s*([^;}\n]+)/g, ': <span class="value">$1</span>')
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>');
}

// JSON syntax highlighting
function highlightJSON(code) {
    return code
        .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
        .replace(/:\s*"([^"]*)"/g, ': <span class="json-string">"$1"</span>')
        .replace(/:\s*(\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
        .replace(/:\s*(true|false|null)/g, ': <span class="json-boolean">$1</span>');
}

// Shell/Bash syntax highlighting
function highlightShell(code) {
    return code
        .replace(/^(\$\s*)/gm, '<span class="shell-command">$1</span>')
        .replace(/\s(-{1,2}[a-zA-Z-]+)/g, ' <span class="shell-flag">$1</span>')
        .replace(/(#.*$)/gm, '<span class="comment">$1</span>');
}

// SQL syntax highlighting
function highlightSQL(code) {
    return code
        .replace(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE|JOIN|INNER|LEFT|RIGHT|OUTER|ON|GROUP|ORDER|BY|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|AS|AND|OR|NOT|IN|EXISTS|LIKE|BETWEEN|IS|NULL|TRUE|FALSE)\b/gi, '<span class="sql-keyword">$1</span>')
        .replace(/(["'])((?:\\.|(?!\1)[^\\])*?)\1/g, '<span class="sql-string">$1$2$1</span>')
        .replace(/\b(COUNT|SUM|AVG|MIN|MAX|ROUND|UPPER|LOWER|LENGTH|SUBSTRING)\s*\(/gi, '<span class="sql-function">$1</span>(');
}

// TypeScript syntax highlighting
function highlightTypeScript(code) {
    return code
        .replace(/\b(interface|type|enum|namespace|module|declare|public|private|protected|readonly|static|abstract|implements|extends)\b/g, '<span class="keyword">$1</span>')
        .replace(/:\s*([a-zA-Z][a-zA-Z0-9<>|\[\]]*)/g, ': <span class="type">$1</span>')
        + highlightJavaScript(code); // Apply JS highlighting as well
}

// C/C++ syntax highlighting
function highlightC(code) {
    // First escape HTML entities
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    
    // Auto-indent C code
    const indented = autoIndentCode(escaped);
    
        return indented
          .replace(/^(#\s*(?:include|define|ifdef|ifndef|endif|if|else|elif|pragma|undef|line|error|warning))\b/gm, '<span class="keyword">$1</span>')
          .replace(/\b(auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|bool|true|false|NULL)\b/g, '<span class="keyword">$1</span>')
          .replace(/\b(\d+\.?\d*[fFlL]?)\b/g, '<span class="number">$1</span>')
          .replace(/&quot;([^&]|&(?!quot;))*?&quot;/g, '<span class="string">$&</span>')
          .replace(/&#x27;([^&]|&(?!#x27;))*?&#x27;/g, '<span class="string">$&</span>')
          .replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>')
          .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>')
          .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="function">$1</span>');
}

// Auto-indentation helper for brace-based languages (Java, C, JavaScript, etc.)
function autoIndentCode(code) {
    const lines = code.split('\n');
    let indentLevel = 0;
    const indentedLines = lines.map(line => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return line; // Keep empty lines as-is
        
        // Decrease indent for closing braces
        if (trimmedLine.startsWith('}')) {
            indentLevel = Math.max(0, indentLevel - 1);
        }
        
        // Add proper indentation
        const indentedLine = '    '.repeat(indentLevel) + trimmedLine;
        
        // Increase indent for opening braces
        if (trimmedLine.endsWith('{')) {
            indentLevel++;
        }
        
        return indentedLine;
    });
    
    return indentedLines.join('\n');
}

// Auto-indentation helper for Python (colon-based indentation)
function autoIndentPython(code) {
    const lines = code.split('\n');
    let indentLevel = 0;
    const indentedLines = lines.map((line, index) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return line; // Keep empty lines as-is
        
        // Check if previous line ended with colon (increase indent)
        if (index > 0) {
            const prevTrimmed = lines[index - 1].trim();
            if (prevTrimmed.endsWith(':')) {
                indentLevel++;
            }
        }
        
        // Decrease indent for dedenting keywords
        if (trimmedLine.startsWith('except') || trimmedLine.startsWith('elif') || 
            trimmedLine.startsWith('else') || trimmedLine.startsWith('finally')) {
            indentLevel = Math.max(0, indentLevel - 1);
        }
        
        // Add proper indentation
        const indentedLine = '    '.repeat(indentLevel) + trimmedLine;
        
        return indentedLine;
    });
    
    return indentedLines.join('\n');
}

// Java syntax highlighting
function highlightJava(code) {
    // First escape HTML entities
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    
    // Auto-indent Java code
    const properlyIndented = autoIndentCode(escaped);
    
    return properlyIndented
        .replace(/\b(abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while|true|false|null)\b/g, '<span class="keyword">$1</span>')
        .replace(/\b(\d+\.?\d*[fFlLdD]?)\b/g, '<span class="number">$1</span>')
        .replace(/&quot;([^&]|&(?!quot;))*?&quot;/g, '<span class="string">$&</span>')
        .replace(/&#x27;([^&]|&(?!#x27;))*?&#x27;/g, '<span class="string">$&</span>')
        .replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>')
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>')
        .replace(/(@\w+)/g, '<span class="keyword">$1</span>')
        .replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g, '<span class="type">$1</span>')
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="function">$1</span>');
}

// Go syntax highlighting
function highlightGo(code) {
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    
    return escaped
        .replace(/\b(break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|true|false|nil|iota)\b/g, '<span class="keyword">$1</span>')
        .replace(/\b(bool|byte|complex64|complex128|error|float32|float64|int|int8|int16|int32|int64|rune|string|uint|uint8|uint16|uint32|uint64|uintptr)\b/g, '<span class="type">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>')
        .replace(/&quot;([^&]|&(?!quot;))*?&quot;/g, '<span class="string">$&</span>')
        .replace(/&#x27;([^&]|&(?!#x27;))*?&#x27;/g, '<span class="string">$&</span>')
        .replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>')
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>')
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="function">$1</span>');
}

// Rust syntax highlighting
function highlightRust(code) {
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    
    return escaped
        .replace(/\b(as|async|await|break|const|continue|crate|dyn|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while)\b/g, '<span class="keyword">$1</span>')
        .replace(/\b(bool|char|str|i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64)\b/g, '<span class="type">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>')
        .replace(/&quot;([^&]|&(?!quot;))*?&quot;/g, '<span class="string">$&</span>')
        .replace(/&#x27;([^&]|&(?!#x27;))*?&#x27;/g, '<span class="string">$&</span>')
        .replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>')
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>')
        .replace(/(#\[.*?\])/g, '<span class="keyword">$1</span>')
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="function">$1</span>');
}

// PHP syntax highlighting
function highlightPHP(code) {
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    
    return escaped
        .replace(/(&lt;\?php|\?&gt;)/g, '<span class="keyword">$1</span>')
        .replace(/\b(abstract|and|array|as|break|callable|case|catch|class|clone|const|continue|declare|default|die|do|echo|else|elseif|empty|enddeclare|endfor|endforeach|endif|endswitch|endwhile|eval|exit|extends|final|finally|for|foreach|function|global|goto|if|implements|include|include_once|instanceof|insteadof|interface|isset|list|namespace|new|or|print|private|protected|public|require|require_once|return|static|switch|throw|trait|try|unset|use|var|while|xor|true|false|null)\b/g, '<span class="keyword">$1</span>')
        .replace(/(\$[a-zA-Z_][a-zA-Z0-9_]*)/g, '<span class="variable">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>')
        .replace(/&quot;([^&]|&(?!quot;))*?&quot;/g, '<span class="string">$&</span>')
        .replace(/&#x27;([^&]|&(?!#x27;))*?&#x27;/g, '<span class="string">$&</span>')
        .replace(/(\/\/.*$|#.*$)/gm, '<span class="comment">$1</span>')
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>')
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="function">$1</span>');
}

// Ruby syntax highlighting
function highlightRuby(code) {
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    
    return escaped
        .replace(/\b(alias|and|begin|break|case|class|def|defined|do|else|elsif|end|ensure|false|for|if|in|module|next|nil|not|or|redo|rescue|retry|return|self|super|then|true|undef|unless|until|when|while|yield)\b/g, '<span class="keyword">$1</span>')
        .replace(/(@[a-zA-Z_][a-zA-Z0-9_]*|@@[a-zA-Z_][a-zA-Z0-9_]*)/g, '<span class="variable">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>')
        .replace(/&quot;([^&]|&(?!quot;))*?&quot;/g, '<span class="string">$&</span>')
        .replace(/&#x27;([^&]|&(?!#x27;))*?&#x27;/g, '<span class="string">$&</span>')
        .replace(/(#.*$)/gm, '<span class="comment">$1</span>')
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="function">$1</span>');
}

// Swift syntax highlighting
function highlightSwift(code) {
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    
    return escaped
        .replace(/\b(associatedtype|class|deinit|enum|extension|fileprivate|func|import|init|inout|internal|let|open|operator|private|protocol|public|static|struct|subscript|typealias|var|break|case|continue|default|defer|do|else|fallthrough|for|guard|if|in|repeat|return|switch|where|while|as|catch|false|is|nil|rethrows|super|self|Self|throw|throws|true|try)\b/g, '<span class="keyword">$1</span>')
        .replace(/\b(Any|AnyObject|Bool|Character|Double|Float|Int|String|Void)\b/g, '<span class="type">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>')
        .replace(/&quot;([^&]|&(?!quot;))*?&quot;/g, '<span class="string">$&</span>')
        .replace(/&#x27;([^&]|&(?!#x27;))*?&#x27;/g, '<span class="string">$&</span>')
        .replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>')
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>')
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="function">$1</span>');
}

// Kotlin syntax highlighting
function highlightKotlin(code) {
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    
    return escaped
        .replace(/\b(abstract|actual|annotation|as|break|by|catch|class|companion|const|constructor|continue|crossinline|data|do|dynamic|else|enum|expect|external|false|final|finally|for|fun|get|if|import|in|infix|init|inline|inner|interface|internal|is|lateinit|noinline|null|object|open|operator|out|override|package|private|protected|public|reified|return|sealed|set|super|suspend|tailrec|this|throw|true|try|typealias|typeof|val|var|vararg|when|where|while)\b/g, '<span class="keyword">$1</span>')
        .replace(/\b(Any|Boolean|Byte|Char|Double|Float|Int|Long|Nothing|Short|String|Unit)\b/g, '<span class="type">$1</span>')
        .replace(/\b(\d+\.?\d*[fFlL]?)\b/g, '<span class="number">$1</span>')
        .replace(/&quot;([^&]|&(?!quot;))*?&quot;/g, '<span class="string">$&</span>')
        .replace(/&#x27;([^&]|&(?!#x27;))*?&#x27;/g, '<span class="string">$&</span>')
        .replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>')
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>')
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="function">$1</span>');
}

// C# syntax highlighting
function highlightCSharp(code) {
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    
    return escaped
        .replace(/\b(abstract|as|base|bool|break|byte|case|catch|char|checked|class|const|continue|decimal|default|delegate|do|double|else|enum|event|explicit|extern|false|finally|fixed|float|for|foreach|goto|if|implicit|in|int|interface|internal|is|lock|long|namespace|new|null|object|operator|out|override|params|private|protected|public|readonly|ref|return|sbyte|sealed|short|sizeof|stackalloc|static|string|struct|switch|this|throw|true|try|typeof|uint|ulong|unchecked|unsafe|ushort|using|virtual|void|volatile|while)\b/g, '<span class="keyword">$1</span>')
        .replace(/\b(bool|byte|char|decimal|double|float|int|long|object|sbyte|short|string|uint|ulong|ushort|void)\b/g, '<span class="type">$1</span>')
        .replace(/\b(\d+\.?\d*[fFlLdDmM]?)\b/g, '<span class="number">$1</span>')
        .replace(/&quot;([^&]|&(?!quot;))*?&quot;/g, '<span class="string">$&</span>')
        .replace(/&#x27;([^&]|&(?!#x27;))*?&#x27;/g, '<span class="string">$&</span>')
        .replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>')
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>')
        .replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g, '<span class="type">$1</span>')
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="function">$1</span>');
}

// Dart/Flutter syntax highlighting
function highlightDart(code) {
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    
    return escaped
        // Dart keywords
        .replace(/\b(abstract|as|assert|async|await|break|case|catch|class|const|continue|covariant|default|deferred|do|dynamic|else|enum|export|extends|extension|external|factory|false|final|finally|for|Function|get|hide|if|implements|import|in|interface|is|late|library|mixin|new|null|on|operator|part|required|rethrow|return|set|show|static|super|switch|sync|this|throw|true|try|typedef|var|void|while|with|yield)\b/g, '<span class="keyword">$1</span>')
        // Built-in types
        .replace(/\b(bool|double|int|num|Object|String|List|Map|Set|Iterable|Future|Stream|Duration|DateTime|Uri)\b/g, '<span class="type">$1</span>')
        // Flutter-specific widgets and classes
        .replace(/\b(Widget|StatelessWidget|StatefulWidget|State|BuildContext|MaterialApp|Scaffold|AppBar|Container|Column|Row|Stack|Positioned|Center|Padding|Margin|Text|TextStyle|Icon|IconButton|RaisedButton|FlatButton|ElevatedButton|TextButton|OutlinedButton|FloatingActionButton|ListView|GridView|SingleChildScrollView|CustomScrollView|Slivers|SliverList|SliverGrid|Navigator|Route|MaterialPageRoute|AnimationController|Animation|Tween|Curve|Colors|Theme|ThemeData|MediaQuery|SafeArea|Hero|GestureDetector|InkWell|Dismissible|Draggable|DragTarget|Transform|Opacity|ClipRRect|ClipOval|ClipPath|CustomPaint|CustomPainter|Canvas|Paint|Path|Size|Offset|Rect|RRect|BorderRadius|BoxDecoration|LinearGradient|RadialGradient|SweepGradient|BoxShadow|Border|BorderSide|EdgeInsets|MainAxisAlignment|CrossAxisAlignment|MainAxisSize|TextAlign|TextDirection|FontWeight|FontStyle|TextDecoration|TextOverflow|Alignment|AlignmentGeometry|WrapAlignment|WrapCrossAlignment|Flex|Flexible|Expanded|SizedBox|AspectRatio|FittedBox|LayoutBuilder|Builder|Consumer|Provider|ChangeNotifier|ValueNotifier|StreamBuilder|FutureBuilder|AnimatedBuilder|AnimatedContainer|AnimatedOpacity|AnimatedPositioned|AnimatedCrossFade|AnimatedSwitcher|AnimatedList|SlideTransition|FadeTransition|ScaleTransition|RotationTransition|SizeTransition|PositionedTransition)\b/g, '<span class="type">$1</span>')
        // Numbers
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>')
        // Strings
        .replace(/&quot;([^&]|&(?!quot;))*?&quot;/g, '<span class="string">$&</span>')
        .replace(/&#x27;([^&]|&(?!#x27;))*?&#x27;/g, '<span class="string">$&</span>')
        // Comments
        .replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>')
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>')
        // Annotations
        .replace(/(@\w+)/g, '<span class="keyword">$1</span>')
        // Functions
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="function">$1</span>');
}

// Generic syntax highlighting
function highlightGeneric(code) {
    return code
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>')
        .replace(/(&quot;)([^&]|&(?!quot;))*?(&quot;)/g, '<span class="string">$1$2$3</span>')
        .replace(/(&#39;)([^&]|&(?!#39;))*?(&#39;)/g, '<span class="string">$1$2$3</span>')
        .replace(/(\/\/.*$|#.*$)/gm, '<span class="comment">$1</span>')
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>');
}

function processMessageText(text) {
    if (!text) return '';
    
    // Replace LaTeX symbols with Unicode equivalents before processing
    text = text.replace(/\\pentagon/g, '⬟');
    text = text.replace(/\\triangle/g, '△');
    text = text.replace(/\\square/g, '□');
    text = text.replace(/\\diamond/g, '◇');
    text = text.replace(/\\nabla/g, '∇');
    
    // Apply formatting rules to AI responses before processing
    text = formatAIResponse(text);
    
    // First, handle code blocks to preserve them
    const codeBlocks = [];
    console.log('Processing text for code blocks:', text.substring(0, 200));
    
    // Try multiple code block patterns
    text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, language, code) => {
        console.log('Found triple backtick code block!');
        const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
        const cleanCode = code.replace(/^\n+/, '').replace(/\n+$/, '');
        console.log('Original code:', JSON.stringify(code));
        console.log('Language:', language);
        const highlightedCode = applySyntaxHighlighting(cleanCode, language);
        codeBlocks.push(`<div class="code-block-wrapper"><pre><code>${highlightedCode}</code></pre><button class="copy-btn" onclick="copyToClipboard(this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg></button></div>`);
        return placeholder;
    });
    
    // Also try to handle code without language specifier  
    text = text.replace(/```\n?([\s\S]*?)```/g, (match, code) => {
        console.log('Found plain code block!');
        const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
        const cleanCode = code.replace(/^\n+/, '').replace(/\n+$/, '');
        console.log('Plain code:', JSON.stringify(code));
        
        // Try to auto-detect language based on content
        let detectedLanguage = 'text';
        if (cleanCode.includes('public class') || cleanCode.includes('System.out') || cleanCode.includes('public static void main')) {
            detectedLanguage = 'java';
        } else if (cleanCode.includes('function') || cleanCode.includes('const ') || cleanCode.includes('let ')) {
            detectedLanguage = 'javascript';
        } else if (cleanCode.includes('def ') || cleanCode.includes('import ') || cleanCode.includes('print(')) {
            detectedLanguage = 'python';
        }
        
        console.log('Auto-detected language:', detectedLanguage);
        const highlightedCode = applySyntaxHighlighting(cleanCode, detectedLanguage);
        codeBlocks.push(`<div class="code-block-wrapper"><pre><code>${highlightedCode}</code></pre><button class="copy-btn" onclick="copyToClipboard(this)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg></button></div>`);
        return placeholder;
    });
    
    // Handle inline code - escape HTML entities in inline code
    text = text.replace(/`([^`]+)`/g, (match, code) => {
        const escaped = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        return `<code>${escaped}</code>`;
    });
    
    // Convert **bold** to <strong>
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Convert *italic* to <em>
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Convert URLs to clickable links
    // Match URLs that start with http://, https://, or www.
    text = text.replace(/(https?:\/\/[^\s<>"]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    text = text.replace(/(^|[^\/])(www\.[^\s<>"]+)/g, '$1<a href="http://$2" target="_blank" rel="noopener noreferrer">$2</a>');
    
    // Split into paragraphs by double newlines
    const sections = text.split(/\n\s*\n/);
    
    const processedSections = sections.map(section => {
        section = section.trim();
        if (!section) return '';
        
        const lines = section.split('\n').map(line => line.trim()).filter(line => line);
        
        // Check for table patterns first (lines with | separators)
        const tableLines = lines.filter(line => line.includes('|') && line.split('|').length > 2);
        
        if (tableLines.length >= 2) {
            // This looks like a table - format it as HTML table
            const tableRows = lines.filter(line => line.includes('|')).map(line => {
                // Clean up the line and split by |
                const cells = line.split('|').map(cell => cell.trim()).filter(cell => cell);
                return cells;
            });
            
            if (tableRows.length > 0) {
                let tableHTML = '<table class="message-table">';
                
                // First row is usually the header
                if (tableRows[0]) {
                    tableHTML += '<thead><tr>';
                    tableRows[0].forEach(cell => {
                        tableHTML += `<th>${cell}</th>`;
                    });
                    tableHTML += '</tr></thead>';
                }
                
                // Rest are data rows
                if (tableRows.length > 1) {
                    tableHTML += '<tbody>';
                    for (let i = 1; i < tableRows.length; i++) {
                        // Skip separator rows like |---|---|---|
                        if (tableRows[i].every(cell => cell.match(/^-+$/))) continue;
                        
                        tableHTML += '<tr>';
                        tableRows[i].forEach(cell => {
                            tableHTML += `<td>${cell}</td>`;
                        });
                        tableHTML += '</tr>';
                    }
                    tableHTML += '</tbody>';
                }
                
                tableHTML += '</table>';
                return tableHTML;
            }
        }
        
        // Only treat as lists if there are MULTIPLE consecutive list-like lines
        // or if it's clearly intended as a list (starts with explicit bullets)
        const bulletLines = lines.filter(line => line.match(/^[-•*]\s+/));
        const numberedLines = lines.filter(line => line.match(/^\d+\.\s+/));
        
        // Only create lists if:
        // 1. Multiple bullet points, OR
        // 2. Multiple numbered items starting with 1., OR  
        // 3. Clear sequential numbering (1., 2., 3., etc.)
        const shouldCreateList = (
            bulletLines.length > 1 || 
            (numberedLines.length > 1 && lines[0].match(/^1\.\s+/)) ||
            (numberedLines.length >= 2 && numberedLines.some((line, idx) => line.match(new RegExp(`^${idx + 1}\\.\\s+`))))
        );
        
        if (shouldCreateList) {
            // Process as a list
            const listItems = lines.map(line => {
                if (line.match(/^[-•*]\s+/)) {
                    return `<li>${line.replace(/^[-•*]\s+/, '')}</li>`;
                } else if (line.match(/^\d+\.\s+/)) {
                    return `<li>${line.replace(/^\d+\.\s+/, '')}</li>`;
                } else {
                    // Non-list line in a list section, treat as continuation
                    return line;
                }
            });
            
            const hasNumbered = numberedLines.length > 0;
            const listTag = hasNumbered ? 'ol' : 'ul';
            
            return `<${listTag}>${listItems.join('')}</${listTag}>`;
        } else {
            // Process as regular paragraph(s) - don't convert single numbered items
            const paragraphText = lines.join(' ');
            
            // Check for headers
            if (paragraphText.match(/^### /)) {
                return `<h3>${paragraphText.replace(/^### /, '')}</h3>`;
            } else if (paragraphText.match(/^## /)) {
                return `<h2>${paragraphText.replace(/^## /, '')}</h2>`;
            } else if (paragraphText.match(/^# /)) {
                return `<h1>${paragraphText.replace(/^# /, '')}</h1>`;
            } else if (paragraphText.match(/^> /)) {
                return `<blockquote>${paragraphText.replace(/^> /, '')}</blockquote>`;
            } else {
                return `<p>${paragraphText}</p>`;
            }
        }
    }).filter(section => section);
    
    text = processedSections.join('');
    
    // Restore code blocks
    codeBlocks.forEach((block, index) => {
        text = text.replace(`__CODE_BLOCK_${index}__`, block);
    });
    
    return text;
}

// Render LaTeX in a specific element
function renderMathInElement(element) {
    if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([element]).catch((err) => {
            console.log('MathJax rendering error:', err);
        });
    }
}

// Generate a unique chat ID
function generateChatId() {
    return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// URL management functions
function updateChatUrl(chatId) {
    if (chatId) {
        // Use hash directly instead of pushState for better compatibility
        window.location.hash = `#chat/${chatId}`;
    } else {
        // New chat or no chat - clear hash
        window.location.hash = '';
    }
}

function getChatIdFromUrl() {
    const hash = window.location.hash;
    console.log('Current URL hash:', hash);
    if (hash.startsWith('#chat/')) {
        const chatId = hash.substring(6); // Remove '#chat/' prefix
        console.log('Extracted chat ID:', chatId);
        return chatId;
    }
    console.log('No chat ID found in URL');
    return null;
}

function handleUrlChange() {
    const urlChatId = getChatIdFromUrl();
    console.log('URL change detected. URL chat ID:', urlChatId, 'Current chat ID:', currentChatId);
    
    if (urlChatId && urlChatId !== currentChatId) {
        console.log('Loading chat from URL');
        // Load the chat from URL
        loadChatFromId(urlChatId);
    } else if (!urlChatId && currentChatId) {
        console.log('Starting new chat from URL');
        // URL shows no chat but we have a current chat - start new chat
        startNewChat();
    }
}

function loadChatFromId(chatId) {
    console.log('Loading chat from ID:', chatId);
    console.log('Available chats:', chatHistory.length);
    const chat = chatHistory.find(c => c.id === chatId);
    
    if (chat) {
        console.log('Found chat:', chat.title);
        // Load the found chat using existing loadChat function
        loadChat(chatId);
    } else {
        // Chat not found, start new chat and update URL
        console.warn(`Chat with ID ${chatId} not found in ${chatHistory.length} chats`);
        startNewChat();
    }
}

// Get chat title from first message
function getChatTitle(messages) {
    if (messages.length === 0) return 'New Chat';
    
    // If we have enough conversation (4+ messages), try to generate a smart title
    if (messages.length >= 4) {
        generateSmartTitle(messages);
        // Return a temporary title while we generate the smart one
        const firstUserMessage = messages.find(msg => msg.role === 'user');
        if (firstUserMessage) {
            let content = '';
            if (typeof firstUserMessage.content === 'string') {
                content = firstUserMessage.content;
            } else if (Array.isArray(firstUserMessage.content)) {
                const textContent = firstUserMessage.content.find(c => c.type === 'text');
                content = textContent ? textContent.text : 'Image conversation';
            }
            return content.length > 30 ? content.substring(0, 30) + '...' : content;
        }
    }
    
    // Default behavior for short conversations
    const firstUserMessage = messages.find(msg => msg.role === 'user');
    if (firstUserMessage) {
        let content = '';
        if (typeof firstUserMessage.content === 'string') {
            content = firstUserMessage.content;
        } else if (Array.isArray(firstUserMessage.content)) {
            const textContent = firstUserMessage.content.find(c => c.type === 'text');
            content = textContent ? textContent.text : 'Image conversation';
        }
        return content.length > 30 ? content.substring(0, 30) + '...' : content;
    }
    return 'New Chat';
}

// Generate smart title using AI summarization
async function generateSmartTitle(messages) {
    try {
        const apiKey = getApiKey();
        if (!apiKey || apiKey === 'YOUR_API_KEY' || apiKey === 'your-api-key-here') {
            return;
        }

        // Create a conversation summary for the title generation
        const conversationSummary = messages
            .filter(msg => msg.role === 'user' || msg.role === 'assistant')
            .slice(0, 6) // Use first 6 messages for context
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

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4.1-2025-04-14',
                messages: [{
                    role: 'user',
                    content: titlePrompt
                }],
                max_completion_tokens: 20,
                temperature: 0.3
            })
        });

        if (response.ok) {
            const data = await response.json();
            const smartTitle = data.choices[0].message.content.trim();
            
            // Update the current chat title if it exists
            if (currentChatId) {
                const chatIndex = chatHistory.findIndex(chat => chat.id === currentChatId);
                if (chatIndex !== -1) {
                    chatHistory[chatIndex].title = smartTitle;
                    debouncedSave();
                    updateHistoryDisplay();
                }
            }
        }
    } catch (error) {
        console.log('Smart title generation failed:', error);
        // Fail silently, keep the default title
    }
}

// Wrapper for HTML onclick handlers
function deleteFolder(folderId) {
    console.log('🗑️ deleteFolder called for:', folderId);
    deleteFolderAsync(folderId).catch(error => {
        console.error('Error deleting folder:', error);
        alert('Failed to delete folder: ' + error.message);
    });
}

// Save current chat
async function saveCurrentChat() {
    if (conversationHistory.length === 0) {
        console.log('No conversation history to save');
        return;
    }
    
    console.log('Saving current chat with', conversationHistory.length, 'messages');
    
    const currentTime = Date.now();
    // Collect current overlay data
    const currentOverlays = collectCurrentOverlays();
    
    const chatData = {
        id: currentChatId || generateChatId(),
        title: getChatTitle(conversationHistory),
        messages: [...conversationHistory],
        model: currentModel,
        timestamp: currentTime,
        lastUpdated: currentTime,
        date: new Date().toLocaleDateString(),
        overlays: currentOverlays
    };
    
    // Add userId if user is authenticated
    if (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) {
        chatData.userId = window.chatStorage.getCurrentUser().uid;
        console.log('User authenticated, adding userId to chat');
    } else {
        console.log('User not authenticated, chat will be local only');
    }
    
    // Find existing chat or add new one
    const existingIndex = chatHistory.findIndex(chat => chat.id === chatData.id);
    if (existingIndex !== -1) {
        chatHistory[existingIndex] = chatData;
    } else {
        chatHistory.unshift(chatData); // Add to beginning
        // currentChatId should already be set, but ensure it matches
        if (!currentChatId) {
            currentChatId = chatData.id;
        }
        
        // Update URL for new chat
        updateChatUrl(currentChatId);
        
        // If starting in a folder, add chat to that folder
        if (currentFolderId) {
            const folder = chatFolders.find(f => f.id === currentFolderId);
            if (folder && !folder.chats.includes(chatData.id)) {
                folder.chats.unshift(chatData.id);
                await saveChatFolders();
            }
        }
    }
    
    // Update history display to show the new chat
    updateHistoryDisplay();
    
    // Keep only last 50 chats
    if (chatHistory.length > 50) {
        chatHistory = chatHistory.slice(0, 50);
    }
    
    console.log('✅ Chat added to history');
    debouncedSave();
    updateHistoryDisplay();
}

// Load a chat from history
async function loadChat(chatId) {
    const chat = chatHistory.find(c => c.id === chatId);
    if (!chat) return;
    
    // Save current chat with its overlays before switching
    if (currentChatId && currentChatId !== chatId) {
        console.log('Saving current chat before switching to new chat');
        await saveCurrentChat();
    }
    
    // Clear overlays from previous chat FIRST
    clearAllOverlays();
    
    // Note: We don't cancel pending requests when switching chats anymore
    // Each chat maintains its own request token, so responses will appear in the correct chat
    
    currentChatId = chatId;
    conversationHistory = [...chat.messages];
    
    // Update URL when loading a chat
    updateChatUrl(currentChatId);
    currentModel = chat.model || 'gpt-4.1-2025-04-14';
    
    // Determine which folder this chat belongs to
    currentFolderId = null;
    for (const folder of chatFolders) {
        if (folder.chats.includes(chatId)) {
            currentFolderId = folder.id;
            break;
        }
    }
    
    
    // Update model selector
    selectModel(currentModel);
    
    // Clear current messages and load chat
    const messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = '';
    
    // Display all messages from the chat
    chat.messages.forEach(message => {
        if (message.role === 'user') {
            let text = '';
            let image = null;
            
            if (typeof message.content === 'string') {
                text = message.content;
            } else if (Array.isArray(message.content)) {
                const textContent = message.content.find(c => c.type === 'text');
                const imageContent = message.content.find(c => c.type === 'image_url');
                
                text = textContent ? textContent.text : '';
                if (imageContent) {
                    image = {
                        dataUrl: imageContent.image_url.url,
                        name: 'Image'
                    };
                }
            }
            
            addMessage(text, 'user', 'normal', image);
        } else if (message.role === 'assistant') {
            addMessage(message.content, 'ai');
        }
    });
    
    // Render LaTeX in all AI messages after loading
    setTimeout(() => {
        const aiMessages = document.querySelectorAll('.ai-message .message-text');
        aiMessages.forEach(messageElement => {
            renderMathInElement(messageElement);
        });
    }, 100);
    
    // Restore overlays if they exist in the chat data
    if (chat.overlays && chat.overlays.length > 0) {
        setTimeout(() => {
            restoreChatOverlays(chat.overlays);
        }, 200); // Delay to ensure DOM is ready
    }
    
    // Update active state in history
    updateHistoryDisplay();
}

// Delete a chat from history (async implementation)
async function deleteChatAsync(chatId) {
    const chatToDelete = chatHistory.find(chat => chat.id === chatId);
    
    // First, delete from Firebase if user is authenticated
    if (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) {
        const currentUser = window.chatStorage.getCurrentUser();
        console.log('🗑️ Deleting chat from Firebase:', chatId, 'User:', currentUser.email);
        
        try {
            const result = await window.chatStorage.deleteChat(chatId);
            console.log('🔍 Firebase delete result:', result);
            
            if (result.success) {
                console.log('✅ Chat deleted from Firebase successfully');
            } else {
                console.error('❌ Failed to delete chat from Firebase:', result.error);
                console.log('🔧 Will still delete locally but chat may remain on other devices');
            }
        } catch (error) {
            console.error('❌ Error deleting chat from Firebase:', error);
            console.log('🔧 Will still delete locally but chat may remain on other devices');
        }
    } else {
        console.log('❌ User not authenticated, only deleting locally');
        console.log('🔧 Chat will remain on other devices and in cloud storage');
    }
    
    // Then delete from local storage
    chatHistory = chatHistory.filter(chat => chat.id !== chatId);
    
    // Update localStorage if in development
    if (isLocalDevelopment()) {
        try {
            localStorage.setItem('chatgpt_history_dev', JSON.stringify(chatHistory));
            console.log('✅ Updated localStorage after delete');
        } catch (devError) {
            console.warn('Failed to update localStorage:', devError);
        }
    }
    
    updateHistoryDisplay();
    
    // If deleted chat was current, start new chat
    if (currentChatId === chatId) {
        startNewChat();
    }
}

// Manual sync function for debugging
async function syncChatsWithFirebase() {
    console.log('Manual sync requested...');
    if (typeof window.chatStorage !== 'undefined' && window.chatStorage) {
        // First save all current chats to Firebase
        debouncedSave();
        
        // Then reload from Firebase
        await loadChatHistory();
        updateHistoryDisplay();
        
        console.log('Manual sync completed');
    } else {
        console.error('Firebase not available for sync');
    }
}

// Make sync function available globally for testing
window.syncChatsWithFirebase = syncChatsWithFirebase;

// Test Firebase connection and permissions
async function testFirebaseConnection() {
    console.log('Testing Firebase connection...');
    
    if (typeof window.chatStorage === 'undefined') {
        console.error('Firebase chatStorage not available');
        return;
    }
    
    if (typeof window.authFunctions === 'undefined') {
        console.error('Firebase authFunctions not available');
        return;
    }
    
    const currentUser = window.authFunctions.getCurrentUser();
    console.log('Current authenticated user:', currentUser);
    
    if (!currentUser) {
        console.log('No user signed in - please sign in first');
        return;
    }
    
    // Try to save a test chat
    const testChat = {
        id: 'test_' + Date.now(),
        title: 'Test Chat',
        messages: [{role: 'user', content: 'test'}],
        timestamp: Date.now(),
        model: 'test'
    };
    
    console.log('Attempting to save test chat...');
    const saveResult = await window.chatStorage.saveChat(testChat);
    console.log('Save result:', saveResult);
    
    if (saveResult.success) {
        console.log('✅ Save successful! Now testing read...');
        const readResult = await window.chatStorage.getUserChats();
        console.log('Read result:', readResult);
        
        if (readResult.success) {
            console.log('✅ Read successful! Firebase is working correctly.');
            console.log(`Found ${readResult.chats.length} chats`);
        } else {
            console.log('❌ Read failed:', readResult.error);
        }
    } else {
        console.log('❌ Save failed:', saveResult.error);
    }
}

// Make test function available globally
window.testFirebaseConnection = testFirebaseConnection;

// Wrapper for HTML onclick handlers  
function deleteChat(chatId) {
    deleteChatAsync(chatId).catch(error => {
        console.error('Error deleting chat:', error);
    });
}

// Clear all chat history
async function clearAllHistory() {
    if (confirm('Are you sure you want to delete all chat history? This cannot be undone.')) {
        chatHistory = [];
        // Only reset the chat count
        debouncedSave();
            updateHistoryDisplay();
            startNewChat();
    }
}

// Start a new chat
function startNewChat(preserveFolder = false) {
    // Clear any pending requests when starting a new chat (since currentChatId will be null)
    console.log('🗑️ Starting new chat, existing requests for other chats will be preserved');
    
    currentChatId = null;
    if (!preserveFolder) {
        currentFolderId = null; // Reset folder when starting new chat normally
    }
    clearChat();
    clearAllOverlays(); // Clear overlays when starting new chat
    updateHistoryDisplay();
    
    // Update URL to reflect new chat
    updateChatUrl(null);
}

// Update history display
function updateHistoryDisplay() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    
    let html = '';
    
    // Show folders section (always visible to allow folder creation)
    html += `
        <div class="folders-section">
            <div class="section-header">
                <span>Folders</span>
                <button class="create-folder-btn" onclick="createFolder()" title="Create new folder">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                </button>
            </div>
            <div class="folders-list">
    `;
        
        // Display folders
        chatFolders.forEach(folder => {
            const folderChats = folder.chats.map(chatId => 
                chatHistory.find(chat => chat.id === chatId)
            ).filter(chat => chat); // Remove any null/undefined chats
            
            html += `
                <div class="folder-item ${folder.expanded ? 'expanded' : ''}">
                    <div class="folder-header" onclick="toggleFolder('${folder.id}')">
                        <div class="folder-info">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="folder-icon">
                                <polyline points="6,9 12,15 18,9" class="expand-icon"/>
                            </svg>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="folder-icon-main">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                            </svg>
                            <span class="folder-name">${folder.name}</span>
                            <span class="folder-count">(${folderChats.length})</span>
                        </div>
                        <div class="folder-actions" onclick="event.stopPropagation()">
                            <button class="folder-action-btn" onclick="startNewChatInFolder('${folder.id}')" title="New chat in folder">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="12" y1="5" x2="12" y2="19"/>
                                    <line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                            </button>
                            <button class="folder-action-btn" onclick="renameFolder('${folder.id}')" title="Rename folder">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                            </button>
                            <button class="folder-action-btn delete" onclick="deleteFolder('${folder.id}')" title="Delete folder">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                </svg>
                            </button>
                        </div>
                    </div>
            `;
            
            // Display chats in folder
            if (folder.expanded && folderChats.length > 0) {
                html += '<div class="folder-chats">';
                folderChats.forEach(chat => {
                    html += `
                        <div class="history-item folder-chat ${chat.id === currentChatId ? 'active' : ''}" onclick="loadChat('${chat.id}')">
                            <div class="history-content">
                                <div class="history-title">${chat.title}</div>
                                <div class="history-date">${chat.date}</div>
                            </div>
                            <div class="history-actions">
                                <button class="history-action-btn move" onclick="event.stopPropagation(); showMoveMenu('${chat.id}')" title="Move chat">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                                        <polyline points="17,21 17,13 7,13 7,21"/>
                                        <polyline points="7,3 7,8 15,8"/>
                                    </svg>
                                </button>
                                <button class="history-action-btn delete" onclick="event.stopPropagation(); deleteChat('${chat.id}')" title="Delete chat">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
            }
            
            html += '</div>';
        });
        
        html += '</div></div>';
    
    // Get chats not in any folder
    const chatsInFolders = chatFolders.flatMap(folder => folder.chats);
    const unorganizedChats = chatHistory.filter(chat => !chatsInFolders.includes(chat.id));
    
    // Show previous chats section
    if (unorganizedChats.length > 0) {
        html += `
            <div class="previous-chats-section">
                <div class="section-header">
                    <span>Previous Chats</span>
                </div>
                <div class="previous-chats-list">
        `;
        
        unorganizedChats.forEach(chat => {
            html += `
                <div class="history-item ${chat.id === currentChatId ? 'active' : ''}" onclick="loadChat('${chat.id}')">
                    <div class="history-content">
                        <div class="history-title">${chat.title}</div>
                        <div class="history-date">${chat.date}</div>
                    </div>
                    <div class="history-actions">
                        <button class="history-action-btn move" onclick="event.stopPropagation(); showMoveMenu('${chat.id}')" title="Move to folder">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                            </svg>
                        </button>
                        <button class="history-action-btn delete" onclick="event.stopPropagation(); deleteChat('${chat.id}')" title="Delete chat">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        });
        
        html += '</div></div>';
    }
    
    if (html === '') {
        html = '<div class="empty-history">No chat history yet</div>';
    }
    
    historyList.innerHTML = html;
}

// Show move menu for chat
function showMoveMenu(chatId) {
    currentMovingChatId = chatId;
    
    // Create folder options
    const folderOptions = document.getElementById('folderOptions');
    folderOptions.innerHTML = '';
    
    // Add "Remove from folder" option
    const removeOption = document.createElement('div');
    removeOption.className = 'folder-option remove-option';
    removeOption.innerHTML = `
        <span class="folder-option-icon">🗂️</span>
        <span class="folder-option-name">Remove from folder</span>
    `;
    removeOption.onclick = () => moveChatToFolderModal(null);
    folderOptions.appendChild(removeOption);
    
    // Add existing folders
    chatFolders.forEach(folder => {
        const folderOption = document.createElement('div');
        folderOption.className = 'folder-option';
        folderOption.innerHTML = `
            <span class="folder-option-icon">📁</span>
            <span class="folder-option-name">${folder.name}</span>
        `;
        folderOption.onclick = () => moveChatToFolderModal(folder.id);
        folderOptions.appendChild(folderOption);
    });
    
    // Show modal
    document.getElementById('moveChatModal').style.display = 'flex';
}

// Close move chat modal
function closeMoveChat() {
    document.getElementById('moveChatModal').style.display = 'none';
    currentMovingChatId = null;
}

// Handle moving chat to folder from modal
function moveChatToFolderModal(folderId) {
    if (currentMovingChatId) {
        moveChatToFolder(currentMovingChatId, folderId);
        closeMoveChat();
    }
}

// Find the sidebar initialization and ensure folder button is always visible

// Around line where sidebar is rendered, update to always show the add folder button
function updateChatHistory() {
    const chatHistoryContainer = document.querySelector('.chat-history-container');
    if (!chatHistoryContainer) return;

    const chats = Object.values(chatHistory).sort((a, b) => {
        // Use lastUpdated if available, otherwise fall back to timestamp
        const aTime = a.lastUpdated || a.timestamp || 0;
        const bTime = b.lastUpdated || b.timestamp || 0;
        return bTime - aTime; // Newest first (descending order)
    });
    
    // Always show the add folder button, regardless of chat count
    const addFolderButton = document.querySelector('.add-folder-btn');
    if (addFolderButton) {
        addFolderButton.style.display = 'block'; // Always visible
    }

    if (chats.length === 0) {
        chatHistoryContainer.innerHTML = '<div class="no-chats">No chat history yet</div>';
        return;
    }

    // Rest of the chat history rendering...
}

// Global variable to store the session API key
let sessionApiKey = null;

// API Key Management Functions
async function promptForApiKey() {
    // First check localStorage
    const savedKey = localStorage.getItem('chatgpt_api_key');
    
    if (savedKey && savedKey !== 'prompt-for-key') {
        sessionApiKey = savedKey;
        console.log('✅ Using saved API key from localStorage');
        return true;
    }
    
    // If no local key, try to load from user account
    console.log('🔄 No local API key found, attempting to load from user account...');
    const loadedFromAccount = await loadSavedApiKey();
    
    if (loadedFromAccount) {
        console.log('✅ API key loaded from user account');
        return true;
    }
    
    // No API key found anywhere - user can set it in settings
    console.log('ℹ️ No API key found. User can set it in Settings.');
    return false;
}

function clearSavedApiKey() {
    closeSettingsModal(); // Close the settings modal first
    showConfirmationModal(
        '🗑️ Clear Saved API Key',
        'Are you sure you want to clear your saved API key?\n\nYou will need to enter it again on your next visit.',
        '🗑️',
        function() {
            localStorage.removeItem('chatgpt_api_key');
            sessionApiKey = null;
            updateApiKeyStatus();
            closeConfirmationModal();
            alert('✅ Saved API key has been cleared. You will be prompted for a new key on next visit.');
        }
    );
}

function updateApiKey() {
    closeSettingsModal(); // Close the settings modal first
    closeSidebar(); // Close sidebar if open on mobile
    
    // Show the API key modal
    const modal = document.getElementById('apiKeyModal');
    const input = document.getElementById('apiKeyInput');
    
    if (modal && input) {
        // Pre-fill current API key if available
        input.value = sessionApiKey || '';
        modal.style.display = 'flex';
        input.focus();
        document.body.style.overflow = 'hidden';
    }
}

function closeApiKeyModal() {
    const modal = document.getElementById('apiKeyModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

async function saveApiKey() {
    const input = document.getElementById('apiKeyInput');
    const newKey = input.value.trim();
    
    if (!newKey) {
        alert('❌ Please enter an API key');
        return;
    }
    
    if (!newKey.startsWith('sk-')) {
        if (!confirm('⚠️ The API key should start with "sk-". Are you sure this is correct?\n\nClick OK to continue anyway, or Cancel to re-enter.')) {
            return;
        }
    }
    
    sessionApiKey = newKey;
    localStorage.setItem('chatgpt_api_key', sessionApiKey);
    
    // If user is signed in, save to their account
    if (window.firebaseClient && window.firebaseClient.getCurrentUser()) {
        try {
            const result = await window.firebaseClient.saveApiKey(newKey);
            if (result.success) {
                console.log('✅ API key saved to user account');
            } else {
                console.warn('⚠️ Failed to save API key to account:', result.error);
            }
        } catch (error) {
            console.warn('⚠️ Error saving API key to account:', error);
        }
    }
    
    updateApiKeyStatus();
    
    // Refresh the welcome screen if it's showing the no-API-key message
    const welcomeScreen = document.querySelector('.welcome-screen');
    if (welcomeScreen && welcomeScreen.innerHTML.includes('add your OpenAI API key')) {
        location.reload(); // Simple reload to reset the app with the new API key
    }
    
    closeApiKeyModal();
    alert('✅ API key updated and saved successfully!');
}

function getApiKey() {
    // Return the session API key if available
    if (sessionApiKey && sessionApiKey !== 'prompt-for-key') {
        return sessionApiKey;
    }
    
    // Check localStorage
    const localKey = localStorage.getItem('chatgpt_api_key');
    if (localKey && localKey !== 'prompt-for-key') {
        sessionApiKey = localKey;
        return localKey;
    }
    
    // Fallback to config (though it should be 'prompt-for-key')
    const configKey = window.CONFIG?.apiKey;
    if (configKey && configKey !== 'prompt-for-key' && configKey !== 'YOUR_API_KEY') {
        return configKey;
    }
    
    return 'YOUR_API_KEY';
}

// Load API key from user account
async function loadSavedApiKey() {
    console.log('🔑 Attempting to load API key from user account...');
    
    // Wait for Firebase authentication to complete
    const authenticatedUser = await waitForFirebaseAuth();
    if (!authenticatedUser) {
        console.log('❌ No authenticated user found, cannot load API key');
        return false;
    }
    
    if (window.firebaseClient && window.firebaseClient.getCurrentUser()) {
        try {
            console.log('🔐 User authenticated, fetching API key...');
            const result = await window.firebaseClient.getApiKey();
            console.log('📥 API key fetch result:', result.success ? 'Success' : 'Failed', result.error || '');
            
            if (result.success && result.apiKey) {
                sessionApiKey = result.apiKey;
                localStorage.setItem('chatgpt_api_key', result.apiKey);
                console.log('✅ API key loaded from user account and stored locally');
                updateApiKeyStatus();
                
                // Force update the welcome screen if it's showing API key prompt
                const welcomeScreen = document.querySelector('.welcome-screen');
                if (welcomeScreen && welcomeScreen.innerHTML.includes('add your OpenAI API key')) {
                    console.log('🔄 Refreshing welcome screen with loaded API key');
                    location.reload();
                }
                
                return true;
            } else {
                console.log('📝 No API key found in user account');
            }
        } catch (error) {
            console.warn('⚠️ Error loading API key from account:', error);
        }
    } else {
        console.log('❌ Firebase client not available or user not authenticated');
    }
    return false;
}

// Force refresh API key from account (useful when localStorage is out of sync)
async function refreshApiKeyFromAccount() {
    console.log('🔄 Force refreshing API key from user account...');
    
    // Wait for Firebase authentication to complete
    const authenticatedUser = await waitForFirebaseAuth();
    if (!authenticatedUser) {
        console.log('❌ User not authenticated, cannot refresh API key');
        return false;
    }
    
    try {
        const result = await window.firebaseClient.getApiKey();
        console.log('📥 API key refresh result:', result.success ? 'Success' : 'Failed', result.error || '');
        
        if (result.success && result.apiKey) {
            // Clear any stale localStorage data first
            localStorage.removeItem('chatgpt_api_key');
            
            // Set fresh data
            sessionApiKey = result.apiKey;
            localStorage.setItem('chatgpt_api_key', result.apiKey);
            console.log('✅ API key refreshed from user account');
            updateApiKeyStatus();
            return true;
        } else {
            console.log('📝 No API key found in user account during refresh');
        }
    } catch (error) {
        console.warn('⚠️ Error refreshing API key from account:', error);
    }
    
    return false;
}

// Wait for Firebase authentication to complete
async function waitForFirebaseAuth() {
    console.log('⏳ Waiting for Firebase authentication to complete...');
    
    let retries = 0;
    const maxRetries = 30; // 15 seconds
    
    while (retries < maxRetries) {
        // Check if Firebase is loaded
        if (window.firebaseClient && typeof window.firebaseClient.getCurrentUser === 'function') {
            const currentUser = window.firebaseClient.getCurrentUser();
            if (currentUser) {
                console.log(`✅ Firebase authentication complete: ${currentUser.email}`);
                return currentUser;
            }
        }
        
        // Also check Firebase auth directly
        if (typeof firebase !== 'undefined' && firebase.auth) {
            const user = firebase.auth().currentUser;
            if (user) {
                console.log(`✅ Firebase auth direct check found user: ${user.email}`);
                return user;
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        retries++;
    }
    
    console.log('❌ Firebase authentication timeout - no user found');
    return null;
}

// Make functions globally available
window.loadSavedApiKey = loadSavedApiKey;
window.refreshApiKeyFromAccount = refreshApiKeyFromAccount;
window.waitForFirebaseAuth = waitForFirebaseAuth;

// Update API key status indicator
function updateApiKeyStatus() {
    const logo = document.querySelector('.logo span');
    const isApiKeySaved = localStorage.getItem('chatgpt_api_key') !== null;
    
    if (logo && sessionApiKey) {
        if (isApiKeySaved) {
            logo.title = '🔑 API key saved and ready';
            console.log('✅ API key is saved and active');
        } else {
            logo.title = '🔑 API key active (session only)';
            console.log('✅ API key is active for this session');
        }
    }
}

function getConfig() {
    return window.CONFIG || {
        model: currentModel,
        maxTokens: 1000,
        temperature: 0.7
    };
}

// Model switching functions
function toggleModelSelector() {
    console.log('toggleModelSelector called');
    
    // Simplified mobile detection
    const isMobile = window.innerWidth <= 768;
    
    console.log('isMobile:', isMobile);
    console.log('window.innerWidth:', window.innerWidth);
    
    if (isMobile) {
        // On mobile, tap to cycle through models instead of showing dropdown
        console.log('Mobile tap-to-switch: cycling to next model');
        cycleToNextModel();
    } else {
        // Use input dropdown on desktop
        const inputDropdown = document.getElementById('modelDropdown');
        const inputButton = document.querySelector('.input-wrapper .model-selector-btn');
        
        if (inputDropdown && inputButton) {
            inputDropdown.classList.toggle('active');
            inputButton.classList.toggle('active');
            console.log('Desktop input dropdown toggled, active:', inputDropdown.classList.contains('active'));
        } else {
            console.error('Desktop input dropdown elements not found');
        }
    }
}

function selectModel(model) {
    currentModel = model;
    const displayName = getModelDisplayName(model);
    
    // Update both header and input model displays with animation
    const currentModelHeader = document.getElementById('currentModelHeader');
    const currentModelInput = document.getElementById('currentModel');
    const headerButton = document.querySelector('.chat-header .model-selector-btn');
    const inputButton = document.querySelector('.input-wrapper .model-selector-btn');
    
    // Add animation class and animate the change
    if (currentModelHeader && headerButton) {
        headerButton.classList.add('changing');
        setTimeout(() => {
            currentModelHeader.textContent = displayName;
            headerButton.classList.remove('changing');
        }, 150);
    }
    
    if (currentModelInput) {
        currentModelInput.textContent = displayName;
    }
    
    // Close both dropdowns
    const headerDropdown = document.getElementById('modelDropdownHeader');
    const inputDropdown = document.getElementById('modelDropdown');
    
    if (headerDropdown) {
        headerDropdown.classList.remove('active');
    }
    if (inputDropdown) {
        inputDropdown.classList.remove('active');
    }
    if (headerButton) {
        headerButton.classList.remove('active');
    }
    if (inputButton) {
        inputButton.classList.remove('active');
    }
    
    // Update selected state for all model options
    document.querySelectorAll('.model-option').forEach(option => {
        option.classList.remove('selected');
        if (option.dataset.model === model) {
            option.classList.add('selected');
        }
    });
    
    // Update input placeholder based on model
    updateInputPlaceholder(model);
    
    // Show/hide image generation settings
    updateImageGenerationUI(model);
    
    console.log('Model selected:', model);
}

// Update input placeholder based on selected model
function updateInputPlaceholder(model) {
    const messageInput = document.getElementById('messageInput');
    if (!messageInput) return;
    
    const placeholders = {
        'gpt-image-1': 'Describe the image you want to generate...',
        'gpt-4.1-2025-04-14': 'Message GPT-4.1...',
        'gpt-4o-search-preview-2025-03-11': 'Message GPT-4o Search Preview...'
    };
    
    messageInput.placeholder = placeholders[model] || 'Message ChatGPT...';
}

// Update UI based on selected model (show/hide image generation features)
function updateImageGenerationUI(model) {
    const isImageModel = model === 'gpt-image-1';
    
    // Show/hide image settings button
    let imageSettingsBtn = document.getElementById('imageSettingsBtn');
    if (isImageModel && !imageSettingsBtn) {
        // Create image settings button if it doesn't exist
        createImageSettingsButton();
    } else if (!isImageModel && imageSettingsBtn) {
        // Remove image settings button if switching away from image model
        imageSettingsBtn.remove();
    }
    
    // Update welcome screen message
    updateWelcomeMessage(model);
}

// Update welcome screen message based on model
function updateWelcomeMessage(model) {
    const welcomeScreen = document.querySelector('.welcome-screen h2');
    if (!welcomeScreen) return;
    
    const messages = {
        'gpt-image-1': 'What image would you like me to create?',
        'gpt-4.1-2025-04-14': 'How can I assist you today?',
    };
    
    welcomeScreen.textContent = messages[model] || 'How can I help you today?';
}

// Create image generation settings button
function createImageSettingsButton() {
    const inputActions = document.querySelector('.input-actions');
    if (!inputActions) return;
    
    const settingsBtn = document.createElement('button');
    settingsBtn.id = 'imageSettingsBtn';
    settingsBtn.className = 'image-settings-btn';
    settingsBtn.title = 'Image Generation Settings';
    settingsBtn.onclick = showImageSettings;
    settingsBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
    `;
    
    // Insert before the voice button
    const voiceBtn = document.getElementById('voiceButton');
    inputActions.insertBefore(settingsBtn, voiceBtn);
}

// Show image generation settings modal
function showImageSettings() {
    // Create modal if it doesn't exist
    let modal = document.getElementById('imageSettingsModal');
    if (!modal) {
        createImageSettingsModal();
        modal = document.getElementById('imageSettingsModal');
    }
    
    // Update current settings in the modal
    updateImageSettingsModal();
    
    // Show modal
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

// Close image settings modal
function closeImageSettings() {
    const modal = document.getElementById('imageSettingsModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

// Create image settings modal
function createImageSettingsModal() {
    const modalHTML = `
        <div id="imageSettingsModal" class="modal" style="display: none;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>🎨 Image Generation Settings</h3>
                    <button class="modal-close" onclick="closeImageSettings()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="image-settings-options">
                        <div class="setting-group">
                            <label for="qualitySetting">Quality:</label>
                            <select id="qualitySetting" class="setting-select">
                                <option value="auto">Auto (Recommended)</option>
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                            </select>
                        </div>
                        
                        <div class="setting-group">
                            <label for="sizeSetting">Size:</label>
                            <select id="sizeSetting" class="setting-select">
                                <option value="auto">Auto (Recommended)</option>
                                <option value="1024x1024">Square (1024x1024)</option>
                                <option value="1024x1536">Portrait (1024x1536)</option>
                                <option value="1536x1024">Landscape (1536x1024)</option>
                            </select>
                        </div>
                        
                        <div class="setting-group">
                            <label for="backgroundSetting">Background Control:</label>
                            <select id="backgroundSetting" class="setting-select">
                                <option value="auto">Auto (Recommended)</option>
                                <option value="opaque">Opaque</option>
                                <option value="transparent">Transparent</option>
                            </select>
                        </div>
                        
                        <div class="setting-group">
                            <label for="formatSetting">Output Format:</label>
                            <select id="formatSetting" class="setting-select">
                                <option value="png">PNG (Default)</option>
                                <option value="webp">WebP</option>
                                <option value="jpeg">JPEG</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="modal-actions">
                        <button class="modal-btn secondary" onclick="resetImageSettings()">Reset to Default</button>
                        <button class="modal-btn primary" onclick="saveImageSettings()">Save Settings</button>
                    </div>
                </div>
            </div>
            <div class="modal-backdrop" onclick="closeImageSettings()"></div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}



// Update image settings modal with current values
function updateImageSettingsModal() {
    document.getElementById('qualitySetting').value = imageSettings.quality;
    document.getElementById('sizeSetting').value = imageSettings.size;
    document.getElementById('backgroundSetting').value = imageSettings.background;
    document.getElementById('formatSetting').value = imageSettings.outputFormat;
    
}

// Save image settings
function saveImageSettings() {
    imageSettings.quality = document.getElementById('qualitySetting').value;
    imageSettings.size = document.getElementById('sizeSetting').value;
    imageSettings.background = document.getElementById('backgroundSetting').value;
    imageSettings.outputFormat = document.getElementById('formatSetting').value;
    
    // Save to localStorage
    localStorage.setItem('chatgpt_image_settings', JSON.stringify(imageSettings));
    
    closeImageSettings();
    
    // Show confirmation
    const successMsg = addMessage('✅ Image generation settings saved!', 'ai', 'normal');
    setTimeout(() => removeMessage(successMsg), 2000);
}

// Reset image settings to default
function resetImageSettings() {
    imageSettings = {
        quality: 'auto',
        size: 'auto',
        background: 'auto',
        outputFormat: 'png'
    };
    
    updateImageSettingsModal();
    localStorage.removeItem('chatgpt_image_settings');
    
    // Show confirmation
    const successMsg = addMessage('🔄 Image settings reset to default!', 'ai', 'normal');
    setTimeout(() => removeMessage(successMsg), 2000);
}

// Load image settings from localStorage
function loadImageSettings() {
    const saved = localStorage.getItem('chatgpt_image_settings');
    if (saved) {
        try {
            imageSettings = { ...imageSettings, ...JSON.parse(saved) };
        } catch (e) {
            console.warn('Failed to load image settings:', e);
        }
    }
}

function getModelDisplayName(model) {
    const names = {
        'gpt-4.1-2025-04-14': 'GPT-4.1',
        'gpt-image-1': 'Image Gen',
        'gpt-4o-search-preview-2025-03-11': 'GPT-4o Search Preview'
    };
    return names[model] || model;
}

function getModelTemperature(model) {
    const temperatures = {
        'gpt-4.1-2025-04-14': 0.7,
        'gpt-image-1': 0.7,
        'gpt-4o-search-preview-2025-03-11': 0.7
    };
    return temperatures[model] || 0.7; // Default fallback
}

// Available models for cycling
const availableModels = ['gpt-4.1-2025-04-14', 'gpt-image-1', 'gpt-4o-search-preview-2025-03-11'];

// Function to cycle to next model
function cycleToNextModel() {
    const currentIndex = availableModels.indexOf(currentModel);
    const nextIndex = (currentIndex + 1) % availableModels.length;
    const nextModel = availableModels[nextIndex];
    selectModel(nextModel);
}

// Sidebar functions
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');
    
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('active');
}

function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');
    
    sidebar.classList.remove('open');
    backdrop.classList.remove('active');
}

// Settings menu function
function showSettingsMenu() {
    // Close sidebar if open on mobile
    closeSidebar();
    
    const isApiKeySaved = localStorage.getItem('chatgpt_api_key') !== null;
    
    // Show/hide the clear API key option based on whether a key is saved
    const clearApiKeyBtn = document.getElementById('clearApiKeyBtn');
    if (clearApiKeyBtn) {
        clearApiKeyBtn.style.display = isApiKeySaved ? 'flex' : 'none';
    }
    
    // Show the modal
    const modal = document.getElementById('settingsModal');
    if (modal) {
        console.log('Modal found, showing...'); // Debug log
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    } else {
        console.error('Settings modal not found!'); // Debug log
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        console.log('Closing modal...'); // Debug log
        modal.style.display = 'none';
        document.body.style.overflow = 'auto'; // Restore scrolling
    } else {
        console.error('Modal not found when trying to close!'); // Debug log
    }
}

// Close modal with Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        // Check for any open modal and close it
        const modals = ['settingsModal', 'apiKeyModal', 'confirmationModal', 'renameFolderModal', 'moveChatModal'];
        
        for (const modalId of modals) {
            const modal = document.getElementById(modalId);
            if (modal && modal.style.display === 'flex') {
                console.log(`Closing ${modalId} with Escape key`);
                
                // Call the appropriate close function
                switch(modalId) {
                    case 'settingsModal':
                        closeSettingsModal();
                        break;
                    case 'apiKeyModal':
                        closeApiKeyModal();
                        break;
                    case 'confirmationModal':
                        closeConfirmationModal();
                        break;
                    case 'renameFolderModal':
                        closeRenameFolderModal();
                        break;
                    case 'moveChatModal':
                        closeMoveChat();
                        break;
                }
                break; // Only close the first open modal
            }
        }
    }
});

// Also add a global shortcut to force close in case of issues (Ctrl+Shift+M)
document.addEventListener('keydown', function(event) {
    if (event.ctrlKey && event.shiftKey && event.key === 'M') {
        console.log('Force closing modal with Ctrl+Shift+M'); // Debug log
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    }
});


async function sendMessageAsync() {
    console.log('📤 sendMessageAsync() called');
    
    // Ensure we have a chat ID before starting the request
    if (!currentChatId) {
        currentChatId = generateChatId();
        console.log('🆕 Generated new chat ID:', currentChatId);
        updateChatUrl(currentChatId);
    }
    
    // Generate a unique token for this request to prevent race conditions
    const requestToken = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const requestChatId = currentChatId;
    activeRequestTokens.set(requestChatId, requestToken);
    
    console.log('🔒 Request started for chat:', requestChatId, 'with token:', requestToken);
    
    const input = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    
    if (!input) {
        console.error('Message input element not found!');
        return;
    }
    
    if (!sendButton) {
        console.error('Send button element not found!');
        return;
    }
    
    let message = input.value.trim();
    let displayMessage = message; // What to show in the chat
    let hasSelectedContext = false;
    
    // If there's a selected text context, combine it with the user's input
    if (selectedTextContext) {
        console.log('Found selectedTextContext:', selectedTextContext);
        const userPrompt = message || '';
        const combinedMessage = selectedTextContext.prefix + selectedTextContext.text;
        hasSelectedContext = true;
        
        // If user added additional context, append it
        if (userPrompt) {
            message = combinedMessage + '\n\nAdditional context: ' + userPrompt;
            // Create a formatted display message with quoted context
            displayMessage = `<div class="quoted-context">${selectedTextContext.text}</div>${userPrompt}`;
        } else {
            message = combinedMessage;
            // Show only the selected text as quoted context
            displayMessage = `<div class="quoted-context">${selectedTextContext.text}</div>`;
        }
        
        console.log('Combined message:', message);
        console.log('Display message:', displayMessage);
    } else {
        console.log('No selectedTextContext found');
    }

    if (!message && selectedImages.length === 0 && selectedFiles.length === 0) return;

    const apiKey = getApiKey();

    // Validate API key
    if (apiKey === 'YOUR_API_KEY' || apiKey === 'your-api-key-here' || !apiKey) {
        addMessage('⚠️ Please set your OpenAI API key in the config.js file.', 'ai', 'error');
        return;
    }

    // Check if model supports vision when images are selected
    if (selectedImages.length > 0 && !currentModel.includes('gpt-4') && !currentModel.includes('gpt-image-1') && !currentModel.includes('gpt-4o-search-preview')) {
        addMessage('⚠️ Image analysis requires vision-capable models. Please switch to GPT-4.1-2025-04-14, gpt-image-1, or gpt-4o-search-preview-2025-03-11.', 'ai', 'error');
        return;
    }

    // Special handling for gpt-image-1 model
    if (currentModel === 'gpt-image-1') {
        // For gpt-image-1, treat text input as image generation prompt
        if (message.trim()) {
            await handleImageGeneration(message.trim());
            return;
        } else if (selectedImages.length > 0) {
            // Image editing mode with gpt-image-1
            await handleImageEditing(message.trim() || 'Edit this image', selectedImages);
            return;
        } else {
            addMessage('⚠️ gpt-image-1 requires either a text prompt for image generation or images for editing.', 'ai', 'error');
            return;
        }
    }

    // Hide welcome screen
    const welcomeScreen = document.querySelector('.welcome-screen');
    if (welcomeScreen) {
        welcomeScreen.style.display = 'none';
    }

    // Disable input and button during request
    input.disabled = true;
    sendButton.disabled = true;

    // Update display message for files if no display message
    if (!displayMessage && (selectedImages.length > 0 || selectedFiles.length > 0)) {
        const hasImages = selectedImages.length > 0;
        const hasPDFs = selectedFiles.some(f => !f.isAudio);
        const hasAudio = selectedFiles.some(f => f.isAudio);
        
        if (hasImages && hasPDFs) {
            displayMessage = 'Analyze these images and PDFs';
        } else if (hasImages) {
            displayMessage = selectedImages.length === 1 ? 'Analyze this image' : 'Analyze these images';
        } else if (hasPDFs) {
            displayMessage = selectedFiles.filter(f => !f.isAudio).length === 1 ? 'Analyze this PDF' : 'Analyze these PDFs';
        } else if (hasAudio) {
            displayMessage = selectedFiles.filter(f => f.isAudio).length === 1 ? 'Transcribe this audio file' : 'Transcribe these audio files';
        }
    }
    
    // For now, pass the first image and file for backward compatibility
    // TODO: Update addMessage to handle multiple files
    const firstImage = selectedImages.length > 0 ? selectedImages[0] : null;
    const firstFile = selectedFiles.length > 0 ? selectedFiles[0] : null;
    
    addMessage(displayMessage, 'user', 'normal', firstImage, firstFile);
    input.value = '';
    input.style.height = 'auto';
    
    // Only hide the UI, don't clear the context yet
    hideSelectionPreviewUI();

    // Handle audio file transcription - process all audio files
    const audioFiles = selectedFiles.filter(f => f.isAudio);
    if (audioFiles.length > 0) {
        // Store audio files before clearing
        const audioFilesToProcess = audioFiles.map(f => f.file);
        clearSelectedFiles();
        
        // Show processing message
        const processingId = addMessage(`🎵 Transcribing ${audioFilesToProcess.length} audio file(s)...`, 'ai', 'typing');
        
        try {
            const transcriptions = [];
            
            // Process each audio file
            for (let i = 0; i < audioFilesToProcess.length; i++) {
                const transcription = await transcribeAudioFile(audioFilesToProcess[i]);
                if (transcription) {
                    transcriptions.push(`Audio ${i + 1}: ${transcription}`);
                }
            }
            
            // Remove processing message
            removeMessage(processingId);
            
            if (transcriptions.length > 0) {
                const allTranscriptions = transcriptions.join('\n\n');
                
                // Add transcribed text to conversation
                conversationHistory.push({
                    role: 'user',
                    content: `Audio transcription(s): ${allTranscriptions}`
                });
                
                // Prepare message content with transcription
                const fullMessage = message ? 
                    `${message}\n\nAudio transcription(s):\n${allTranscriptions}` : 
                    `Please analyze these audio transcriptions:\n\n${allTranscriptions}`;
                
                // Update conversation history
                conversationHistory[conversationHistory.length - 1].content = fullMessage;
                
                // Show transcribed content
                addMessage(`📝 Transcription(s): ${allTranscriptions}`, 'ai');
                
                // Continue with normal chat flow if user added a message
                if (message) {
                    const typingId = addMessage('', 'ai', 'typing');
                    
                    const response = await fetch(API_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify({
                            model: currentModel,
                            messages: buildMessagesWithSystem(conversationHistory),
                            max_completion_tokens: 1000,
                            ...(currentModel !== 'gpt-4o-search-preview-2025-03-11' && { temperature: getModelTemperature(currentModel) })
                        })
                    });

                    removeMessage(typingId);

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
                    }

                    const data = await response.json();
                    let aiMessage = data.choices[0].message.content;
                    
                    // Apply formatting rules to AI response
                    aiMessage = formatAIResponse(aiMessage);


                    conversationHistory.push({
                        role: 'assistant',
                        content: aiMessage
                    });

                    addMessage(aiMessage, 'ai');
                    await saveCurrentChat();
                }
            }
        } catch (error) {
            removeMessage(processingId);
            console.error('Error transcribing audio:', error);
            addMessage(`❌ Error transcribing audio: ${error.message}`, 'ai', 'error');
        } finally {
            input.disabled = false;
            sendButton.disabled = false;
            input.focus();
        }
        return;
    }

    // Prepare message content
    let messageContent;
    
    if (selectedImages.length > 0) {
        // Handle multiple images
        messageContent = [
            {
                type: "text",
                text: message || (selectedImages.length === 1 ? "What do you see in this image?" : "What do you see in these images?")
            }
        ];
        
        // Add all images to the content
        selectedImages.forEach(image => {
            messageContent.push({
                type: "image_url",
                image_url: {
                    url: image.dataUrl
                }
            });
        });
        
        // Add PDF content if any
        const pdfFiles = selectedFiles.filter(f => !f.isAudio);
        if (pdfFiles.length > 0) {
            let pdfContent = "\n\nPDF Content(s):\n";
            pdfFiles.forEach((file, index) => {
                pdfContent += `\nPDF ${index + 1} (${file.name}):\n${file.text}\n`;
            });
            messageContent[0].text += pdfContent;
        }
    } else if (selectedFiles.length > 0) {
        // Handle files without images
        const pdfFiles = selectedFiles.filter(f => !f.isAudio);
        if (pdfFiles.length > 0) {
            messageContent = message || "Please analyze this PDF content:";
            let pdfContent = "\n\nPDF Content(s):\n";
            pdfFiles.forEach((file, index) => {
                pdfContent += `\nPDF ${index + 1} (${file.name}):\n${file.text}\n`;
            });
            messageContent += pdfContent;
        } else {
            messageContent = message;
        }
    } else {
        messageContent = message;
    }

    // Add user message to conversation history
    conversationHistory.push({
        role: 'user',
        content: messageContent
    });

    // Clear selected files and context after adding to conversation
    clearSelectedFiles();
    // clearSelectionContext(); // Function doesn't exist, commenting out

    // Show typing indicator
    const typingId = addMessage('', 'ai', 'typing');

    try {
        // Build messages array for API call
        let messages;
        if (currentModel === 'gpt-image-1') {
            messages = conversationHistory;
        } else {
            messages = buildMessagesWithSystem(conversationHistory);
        }

        // Make API call
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: currentModel,
                messages: messages,
                max_completion_tokens: 10000,
                ...(currentModel !== 'gpt-4o-search-preview-2025-03-11' && { temperature: getModelTemperature(currentModel) })
            })
        });

        // Remove typing indicator
        removeMessage(typingId);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        let aiMessage = data.choices[0].message.content;
        
        // Apply formatting rules to AI response
        aiMessage = formatAIResponse(aiMessage);

        // Add AI response to conversation history
        conversationHistory.push({
            role: 'assistant',
            content: aiMessage
        });

        // Display the AI response
        addMessage(aiMessage, 'ai');
        
        // Save the updated chat
        await saveCurrentChat();

    } catch (error) {
        // Remove typing indicator on error
        removeMessage(typingId);
        console.error('Error sending message:', error);
        addMessage(`❌ Error: ${error.message}`, 'ai', 'error');
    } finally {
        // Re-enable input and button
        input.disabled = false;
        sendButton.disabled = false;
        input.focus();
    }
}

// Add user message to conversation history for all models
async function continueMessageProcessing() {
    const userMessage = {
        role: 'user',
        content: messageContent
    };
    conversationHistory.push(userMessage);
    
    // Store the user message for this request token so we can ensure it's saved later
    const requestUserMessage = { ...userMessage };

    // Auto-save after user message is added
    await saveCurrentChat();

    // Build messages array for API call
    let messages;
    if (currentModel === 'gpt-image-1') {
        // For image model, use full conversationHistory (should not include systemPrompt)
        messages = conversationHistory;
    } else {
        // For text models, use systemPrompt + full conversation history
        messages = buildMessagesWithSystem(conversationHistory);
    }

    // Clear selected files after sending
    clearSelectedFiles();

    // Show typing indicator
    const typingId = addMessage('', 'ai', 'typing');

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: currentModel,
                messages: messages,
                max_completion_tokens: 10000,
                ...(currentModel !== 'gpt-4o-search-preview-2025-03-11' && { temperature: getModelTemperature(currentModel) })
            })
        });

        // Remove typing indicator
        removeMessage(typingId);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        let aiMessage = data.choices[0].message.content;
        
        // Apply formatting rules to AI response
        aiMessage = formatAIResponse(aiMessage);


        // Check if this is a valid request for the original chat
        const currentActiveToken = activeRequestTokens.get(requestChatId);
        if (currentActiveToken && currentActiveToken !== requestToken) {
            console.warn('🚨 Invalid token! Expected:', currentActiveToken, 'got:', requestToken);
            console.log('❌ Discarding response - token mismatch');
            removeMessage(typingId);
            return;
        }
        
        // Clear the request token since we're processing the response
        activeRequestTokens.delete(requestChatId);

        // Find the chat where this response belongs and ensure it has the complete conversation
        const targetChat = chatHistory.find(chat => chat.id === requestChatId);
        if (targetChat) {
            // Ensure the user message is in the target chat (in case save didn't complete before chat switch)
            const lastMessage = targetChat.messages[targetChat.messages.length - 1];
            
            if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== requestUserMessage.content) {
                console.log('🔧 Adding missing user message to target chat');
                targetChat.messages.push(requestUserMessage);
            }
            
            // Add response to the correct chat's messages
            targetChat.messages.push({
                role: 'assistant',
                content: aiMessage
            });
            
            // Update chat timestamp and save
            targetChat.lastUpdated = Date.now();
            console.log('✅ Response added to chat:', requestChatId);
            
            // Save the updated chat
            saveChatHistory();
        }

        // Only update UI if user is currently viewing this chat
        if (currentChatId === requestChatId) {
            // Add to current conversation and display
            conversationHistory.push({
                role: 'assistant',
                content: aiMessage
            });
            addMessage(aiMessage, 'ai');
            console.log('✅ Response displayed in current chat');
        } else {
            // Just remove typing indicator, don't display response
            removeMessage(typingId);
            console.log('✅ Response saved to chat', requestChatId, 'but not displayed (user in different chat)');
        }

        // Auto-save the target chat after successful response
        if (targetChat) {
            try {
                // Update the chat in chatHistory and trigger save
                const chatIndex = chatHistory.findIndex(chat => chat.id === requestChatId);
                if (chatIndex !== -1) {
                    chatHistory[chatIndex] = {
                        ...targetChat,
                        lastUpdated: Date.now()
                    };
                    debouncedSave(); // Save to Firebase
                    console.log('✅ Target chat saved successfully');
                }
            } catch (saveError) {
                console.warn('⚠️ Failed to save target chat:', saveError);
            }
        }

    } catch (error) {
        console.error('Error:', error);
        removeMessage(typingId);
        
        // Only show error in the same chat where the request was made
        const currentActiveToken = activeRequestTokens.get(requestChatId);
        if (currentChatId === requestChatId && currentActiveToken === requestToken) {
            addMessage(`❌ Error: ${error.message}`, 'ai', 'error');
            activeRequestTokens.delete(requestChatId); // Clear the token
        } else {
            console.log('❌ Error occurred but user switched chats or request cancelled, not showing error message');
        }
    } finally {
        // Re-enable input and button
        input.disabled = false;
        sendButton.disabled = false;
        input.focus();
        
        // Clear selected text context in all cases (success or error)
        if (selectedTextContext) {
            console.log('Clearing selectedTextContext in finally block');
            selectedTextContext = null;
        }
    }
}

// Wrapper for HTML onclick handlers
function sendMessage() {
    console.log('🚀 Send button clicked!');
    sendMessageAsync().catch(error => {
        console.error('Error sending message:', error);
    });
}

function addMessage(text, sender, type = 'normal', image = null, file = null) {
    const messagesContainer = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    messageDiv.id = messageId;
    messageDiv.className = `message ${sender}-message`;
    
    
    if (type === 'error') {
        messageDiv.className = 'error-message';
        messageDiv.innerHTML = `<div class="message-text">${text}</div>`;
    } else if (type === 'typing') {
        messageDiv.className = 'message ai-message typing-message';
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
    } else {
        let contentHtml = '';
        
        if (image) {
            contentHtml += `<img src="${image.dataUrl}" alt="${image.name}" class="message-image" onclick="window.open('${image.dataUrl}', '_blank')">`;
        }
        
        if (file && file.type === 'application/pdf') {
            contentHtml += `
                <div class="message-file">
                    <div class="message-file-icon">PDF</div>
                    <div class="message-file-info">
                        <div class="message-file-name">${file.name}</div>
                        <div class="message-file-size">${formatFileSize(file.size)}</div>
                        ${file.pages ? `<div class="message-file-pages">${file.pages} pages</div>` : ''}
                    </div>
                </div>
            `;
        } else if (file && file.isAudio) {
            contentHtml += `
                <div class="message-file">
                    <div class="message-file-icon audio">MP3</div>
                    <div class="message-file-info">
                        <div class="message-file-name">${file.name}</div>
                        <div class="message-file-size">${formatFileSize(file.size)}</div>
                        <div class="message-file-pages">Audio file</div>
                    </div>
                </div>
            `;
        }
        
        if (text) {
            // Check if text contains quoted context HTML - if so, use as-is, otherwise process
            if (text.includes('<div class="quoted-context">')) {
                contentHtml += `<div class="message-text">${text}</div>`;
            } else {
                const processedText = processMessageText(text);
                contentHtml += `<div class="message-text">${processedText}</div>`;
            }
        }
        

        messageDiv.innerHTML = `
            <div class="message-content" style="overflow: visible !important;">${contentHtml}</div>
        `;
        
        // Store the message text for the copy function
        if (sender === 'ai' && type === 'normal' && text) {
            messageDiv.dataset.messageText = text;
        }
    }
    
    // Add action buttons directly inside the message content for AI messages (desktop only)
    if (sender === 'ai' && type === 'normal' && text && window.innerWidth > 768) {
        addMessageActions(messageDiv, text);
    }
    
    messagesContainer.appendChild(messageDiv);
    
    // Render LaTeX if this is an AI message with text
    if (sender === 'ai' && text && type === 'normal') {
        const messageTextElement = messageDiv.querySelector('.message-text');
        if (messageTextElement) {
            renderMathInElement(messageTextElement);
        }
    }
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    return messageId;
}

// Text Selection Tooltip Feature
let selectionTooltip = null;
let selectionTimeout = null;
let selectedTextContext = null; // Store selected text context
let previewBubble = null;

// Initialize text selection listener
document.addEventListener('DOMContentLoaded', function() {
    initializeSelectionTooltip();
    
    // Add online/offline event listeners for chat sync
    window.addEventListener('online', () => {
        console.log('📶 Back online, syncing chats...');
        syncChatsWithFirebase();
    });
    
    window.addEventListener('offline', () => {
        console.log('📴 Gone offline, will sync when back online');
    });
    
    // Auto-save chats when page is about to unload (Firebase only)
    window.addEventListener('beforeunload', async () => {
        if (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) {
            // Use sendBeacon for reliable delivery during page unload
            if (chatHistory.length > 0) {
                try {
                    // Save to Firebase only - no localStorage
                    await saveChatHistory();
                } catch (e) {
                    console.warn('Failed to save chat history on unload:', e);
                }
            }
        }
    });
});

function initializeSelectionTooltip() {
    document.addEventListener('mouseup', handleTextSelection);
    document.addEventListener('touchend', handleTextSelection);
    document.addEventListener('scroll', hideSelectionTooltip);
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.selection-tooltip')) {
            hideSelectionTooltip();
        }
    });
    
    // Add window resize listener to reposition overlay
    window.addEventListener('resize', repositionOverlayOnResize);
    
    // Restore saved overlay on page load
    restoreSavedOverlay();
}

function restoreSavedOverlay() {
    // Multiple overlays mode - don't auto-restore old single overlay
    // Users can create new overlays as needed
    console.log('Multiple overlay mode active - auto-restore disabled');
}


function handleTextSelection(e) {
    // Small delay to ensure selection is stable
    setTimeout(() => {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        if (selectedText.length > 0) {
            showSelectionTooltip(selection);
        } else {
            hideSelectionTooltip();
        }
    }, 50);
}

function showSelectionTooltip(selection) {
    const selectedText = selection.toString().trim();
    if (selectedText.length < 3) return; // Don't show for very short selections
    
    hideSelectionTooltip(); // Remove any existing tooltip
    
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    // Create tooltip element
    selectionTooltip = document.createElement('div');
    selectionTooltip.className = 'selection-tooltip';
    selectionTooltip.innerHTML = `
        <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2; margin-right: 6px;">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        Ask ChatGPT
    `;
    
    // Style the tooltip
    selectionTooltip.style.cssText = `
        position: fixed;
        background: rgba(0, 0, 0, 0.85);
        color: white;
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        cursor: pointer;
        z-index: 1000;
        opacity: 0;
        transform: scale(0.9);
        transition: all 0.2s ease;
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        white-space: nowrap;
        user-select: none;
    `;
    
    // Position tooltip
    const isMobile = window.innerWidth <= 768;
    let tooltipX, tooltipY;
    
    if (isMobile) {
        // Position below selection on mobile
        tooltipX = Math.max(10, Math.min(window.innerWidth - 150, rect.left + rect.width / 2 - 75));
        tooltipY = rect.bottom + 10;
    } else {
        // Position above selection on desktop
        tooltipX = Math.max(10, Math.min(window.innerWidth - 150, rect.left + rect.width / 2 - 75));
        tooltipY = rect.top - 45;
        
        // If tooltip would be above viewport, position below
        if (tooltipY < 10) {
            tooltipY = rect.bottom + 10;
        }
    }
    
    selectionTooltip.style.left = tooltipX + 'px';
    selectionTooltip.style.top = tooltipY + 'px';
    
    // Add click handler
    selectionTooltip.addEventListener('click', () => {
        console.log('Ask ChatGPT tooltip clicked with selectedText:', selectedText);
        askAboutSelection(selectedText);
        hideSelectionTooltip();
    });
    
    // Add to DOM and animate in
    document.body.appendChild(selectionTooltip);
    
    // Trigger animation
    setTimeout(() => {
        selectionTooltip.style.opacity = '1';
        selectionTooltip.style.transform = 'scale(1)';
    }, 10);
}

function hideSelectionTooltip() {
    clearTimeout(selectionTimeout);
    if (selectionTooltip) {
        selectionTooltip.style.opacity = '0';
        selectionTooltip.style.transform = 'scale(0.9)';
        setTimeout(() => {
            if (selectionTooltip && selectionTooltip.parentNode) {
                selectionTooltip.parentNode.removeChild(selectionTooltip);
            }
            selectionTooltip = null;
        }, 200);
    }
}

// Store selection data globally for the overlay
let currentSelectionData = null;

function askAboutSelection(selectedText) {
    const selection = window.getSelection();
    let selectionRect = null;
    
    // Get the position of the selection before clearing it
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        selectionRect = range.getBoundingClientRect();
    }
    
    // Clear current selection
    window.getSelection().removeAllRanges();
    
    // Determine appropriate prefix based on text length and content
    let prefix = 'Explain this: ';
    if (selectedText.length > 200) {
        prefix = 'Summarize this: ';
    } else if (selectedText.includes('?')) {
        prefix = 'Help me understand this: ';
    } else if (selectedText.match(/^\d+[\d\s\+\-\*\/\(\)\.]*$/)) {
        prefix = 'Calculate this: ';
    }
    
    // Store selection data for later use
    currentSelectionData = {
        text: selectedText,
        prefix: prefix,
        rect: selectionRect
    };
    
    // Show overlay with input form and get the overlay ID
    const overlayId = showSelectionResponseOverlay(selectedText, prefix, selectionRect);
    
    // Focus on the textarea after a brief delay and add keyboard support
    setTimeout(() => {
        const textarea = document.getElementById('additionalContext_' + overlayCounter);
        if (textarea) {
            textarea.focus();
            
            // Add auto-resize functionality
            const autoResize = () => {
                textarea.style.height = 'auto';
                textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
            };
            
            textarea.addEventListener('input', autoResize);
            
            // Add keyboard support
            textarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    // Enter to send (unless Shift is held)
                    e.preventDefault();
                    sendSelectionQuery(overlayId);
                } else if (e.key === 'Enter' && e.shiftKey) {
                    // Shift+Enter for new line - let default behavior happen
                    setTimeout(autoResize, 0); // Resize after new line is added
                } else if (e.key === 'Escape') {
                    // Escape to cancel
                    e.preventDefault();
                    hideSelectionResponseOverlay();
                }
            });
        }
    }, 300);
}

async function sendSelectionQueryAsync(overlayId) {
    if (!currentSelectionData) return;
    
    const overlay = document.getElementById(overlayId);
    if (!overlay) return;
    
    const textareaId = overlay.querySelector('textarea').id;
    const additionalContext = document.getElementById(textareaId).value.trim();
    
    // Build the query with better context
    let query = `I selected this text from our conversation: "${currentSelectionData.text}"`;
    
    if (additionalContext) {
        query += `\n\n${additionalContext}`;
    } else {
        // Use default based on prefix but make it more contextual
        if (currentSelectionData.prefix.includes('Summarize')) {
            query += '\n\nCan you summarize this part in the context of our discussion?';
        } else if (currentSelectionData.prefix.includes('Calculate')) {
            query += '\n\nCan you explain or calculate this in detail?';
        } else if (currentSelectionData.prefix.includes('understand')) {
            query += '\n\nCan you help me understand this better in the context of our conversation?';
        } else {
            query += '\n\nCan you explain this part in more detail, considering our full conversation context?';
        }
    }
    
    // Hide the input form and show loading
    showSelectionLoading(overlayId);
    
    // Make API call
    try {
        const response = await getSelectionResponse(query);
        updateSelectionOverlayResponse(overlayId, response);
    } catch (error) {
        updateSelectionOverlayResponse(overlayId, `Error: ${error.message}`, true);
    }
}

// Wrapper for HTML onclick handlers
function sendSelectionQuery(overlayId) {
    sendSelectionQueryAsync(overlayId).catch(error => {
        console.error('Error sending selection query:', error);
    });
}

function showSelectionLoading(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (!overlay) return;
    
    const querySection = overlay.querySelector('.selection-query-section');
    const responseArea = overlay.querySelector('.selection-response-area');
    
    if (querySection) querySection.style.display = 'none';
    if (responseArea) {
        responseArea.style.display = 'block';
        responseArea.innerHTML = `
            <div class="response-content">
                <div style="display: flex; align-items: center; gap: 8px; padding: 12px; color: #999; font-size: 14px;">
                    <div class="spinner"></div>
                    <span>Getting response...</span>
                </div>
            </div>
        `;
    }
}

// Counter for unique overlay IDs
let overlayCounter = 0;

function showSelectionResponseOverlay(selectedText, prefix, selectionRect) {
    console.log('showSelectionResponseOverlay called with:', { selectedText, prefix, selectionRect });
    
    // Create a new overlay with unique ID
    overlayCounter++;
    const overlayId = 'selectionResponseOverlay_' + overlayCounter;
    
    // Create new overlay
    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.className = 'selection-response-overlay persistent-overlay';
    
    overlay.innerHTML = `
        <div class="selection-response-content" data-selected-text="${selectedText.replace(/"/g, '&quot;')}">
            <div class="overlay-header">
                <div class="overlay-drag-handle" title="Drag to move">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 12h18M3 6h18M3 18h18"/>
                    </svg>
                    <span class="overlay-title">Analyzing selection...</span>
                </div>
                <div class="overlay-controls">
                    <button class="overlay-minimize" onclick="minimizeSelectionOverlay('${overlayId}')" title="Minimize">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M6 9l6 6 6-6"/>
                        </svg>
                    </button>
                    <button class="overlay-close" onclick="closeSelectionOverlay('${overlayId}')" title="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="bubble-content">
                <div class="selection-query-section">
                    <div class="selected-text-display">${selectedText}</div>
                    <div class="quick-input">
                        <textarea 
                            id="additionalContext_${overlayCounter}" 
                            placeholder="Ask about this..."
                            rows="1"
                            onkeydown="handleOverlayKeyPress(event, '${overlayId}')"
                        ></textarea>
                        <button class="quick-send" onclick="sendSelectionQuery('${overlayId}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="selection-response-area" style="display: none;">
                    <div class="response-content"></div>
                </div>
            </div>
            <div class="overlay-resize-handle" title="Drag to resize"></div>
        </div>
    `;
    
    // Append to messages container instead of body for better positioning
    const messagesContainer = document.getElementById('messages');
    if (messagesContainer) {
        messagesContainer.appendChild(overlay);
    } else {
        document.body.appendChild(overlay);
    }
    
    // Set z-index to ensure newer overlays appear on top
    overlay.style.zIndex = 1005 + overlayCounter;
    
    // Initialize overlay position and functionality
    initializeOverlayDrag(overlay);
    setupOverlayResize(overlay);
    
    // Load saved position and state
    loadOverlayPosition(overlay);
    restoreOverlayState(overlay);
    
    // Position the overlay relative to the selection only if not restoring saved position
    if (selectionRect && !localStorage.getItem('selectionOverlayPosition_' + overlayId)) {
        positionBubbleRelativeToSelection(content, selectionRect);
    } else {
        console.log('Using saved/default position for overlay:', overlayId);
    }
    
    // Animate in
    setTimeout(() => {
        overlay.classList.add('show');
    }, 10);
    
    // Handle escape key and click outside
    document.addEventListener('keydown', handleOverlayEscape);
    overlay.addEventListener('click', handleOverlayClickOutside);
    
    // Add resize functionality for desktop
    setupOverlayResize(overlay);
    
    // Auto-save chat when new overlay is created
    if (currentChatId) {
        setTimeout(() => saveCurrentChat(), 500); // Delay to ensure overlay is fully initialized
    }
    
    // Return the overlay ID for further operations
    return overlayId;
}

function positionBubbleRelativeToSelection(content, selectionRect) {
    console.log('Positioning bubble with rect:', selectionRect);
    
    const bubbleWidth = 320;
    const margin = 20;
    
    // Calculate initial position - try right side first, with staggered offset for multiple overlays
    const staggerOffset = (overlayCounter - 1) * 40; // 40px offset per overlay
    let bubbleLeft = selectionRect.right + margin + staggerOffset;
    let bubbleTop = selectionRect.top + staggerOffset;
    
    // Check if it fits in viewport horizontally
    if (bubbleLeft + bubbleWidth > window.innerWidth - margin) {
        // Try left side
        bubbleLeft = selectionRect.left - bubbleWidth - margin;
        
        if (bubbleLeft < margin) {
            // No room on sides - position above or below
            bubbleLeft = Math.max(margin, Math.min(selectionRect.left - bubbleWidth/2, window.innerWidth - bubbleWidth - margin));
            
            // Check if there's more room above or below
            const roomAbove = selectionRect.top;
            const roomBelow = window.innerHeight - selectionRect.bottom;
            
            if (roomBelow > roomAbove) {
                bubbleTop = selectionRect.bottom + margin;
            } else {
                bubbleTop = selectionRect.top - margin;
            }
        }
    }
    
    // Apply initial positioning to measure actual size
    content.style.position = 'fixed';
    
    // Ensure the initial position is constrained to viewport
    const constrainedPosition = constrainToViewport(bubbleLeft, bubbleTop, bubbleWidth, 200);
    
    content.style.left = constrainedPosition.left + 'px';
    content.style.top = constrainedPosition.top + 'px';
    content.style.margin = '0';
    content.style.transform = 'scale(1) translateY(0) !important';
    
    // Now get actual dimensions
    const bubbleHeight = content.offsetHeight;
    const actualBubbleWidth = content.offsetWidth;
    
    // Ensure bubble doesn't go off screen vertically
    if (bubbleTop + bubbleHeight > window.innerHeight - margin) {
        bubbleTop = window.innerHeight - bubbleHeight - margin;
    }
    if (bubbleTop < margin) {
        bubbleTop = margin;
    }
    
    // Reapply corrected positioning
    content.style.top = bubbleTop + 'px';
    
    console.log('Calculated position:', { bubbleLeft, bubbleTop, bubbleHeight, actualBubbleWidth });
}

// Function to reposition when content changes (like when response is loaded)
function repositionBubbleAfterContentChange() {
    if (!currentSelectionData?.rect) return;
    
    const overlay = document.getElementById('selectionResponseOverlay');
    if (!overlay) return;
    
    const content = overlay.querySelector('.selection-response-content');
    if (!content) return;
    
    // Re-run positioning with updated content size
    positionBubbleRelativeToSelection(content, currentSelectionData.rect);
}

async function updateSelectionOverlayResponse(overlayId, response, isError = false) {
    const overlay = document.getElementById(overlayId);
    if (!overlay) return;
    
    const responseArea = overlay.querySelector('.selection-response-area');
    const titleElement = overlay.querySelector('.overlay-title');
    const footer = overlay.querySelector('.selection-response-footer');
    
    // First update with the response
    if (responseArea) {
        responseArea.style.display = 'block';
        responseArea.innerHTML = `<div class="response-content">${formatAIResponse(response)}</div>`;
    }
    
    // Generate a concise summary using GPT
    try {
        const summaryPrompt = `Give a 3-4 word title that captures the main topic: ${response}`;
        const summaryResponse = await getSelectionResponse(summaryPrompt);
        
        // Update the overlay title with the summary
        if (titleElement) {
            let summary = summaryResponse.trim();
            // Remove any markdown or quotes that GPT might add
            summary = summary.replace(/[*`"']/g, '').trim();
            // Ensure it's not too long
            if (summary.length > 50) {
                summary = summary.substring(0, 47) + '...';
            }
            titleElement.textContent = summary;
        }
    } catch (error) {
        console.error('Error generating summary:', error);
        // Fallback to a simple truncated version if summary generation fails
        if (titleElement) {
            const shortTitle = response.split(' ').slice(0, 5).join(' ') + '...';
            titleElement.textContent = shortTitle;
        }
    }
    
    // Show the original query and response
    const queryDiv = document.createElement('div');
    queryDiv.className = 'selection-final-query';
    
    const textareaId = overlay.querySelector('textarea').id;
    const additionalContext = document.getElementById(textareaId)?.value.trim();
    
    // Frontend display: Quoted text at top, then user's question below
    let displayHTML = `<div class="selected-text-quote">${currentSelectionData.text}</div>`;
    
    if (additionalContext) {
        displayHTML += `<div class="user-question">${additionalContext}</div>`;
    } else {
        // Use the default question based on the prefix
        let defaultQuestion = 'Can you explain this?';
        if (currentSelectionData.prefix.includes('Summarize')) {
            defaultQuestion = 'Can you summarize this?';
        } else if (currentSelectionData.prefix.includes('Calculate')) {
            defaultQuestion = 'Can you calculate this?';
        } else if (currentSelectionData.prefix.includes('understand')) {
            defaultQuestion = 'Can you help me understand this?';
        }
        displayHTML += `<div class="user-question">${defaultQuestion}</div>`;
    }
    
    queryDiv.innerHTML = displayHTML;
    
    const responseDiv = document.createElement('div');
    responseDiv.className = 'selection-response-text message-text';
    
    if (isError) {
        responseDiv.style.color = '#ef4444';
        responseDiv.textContent = response;
    } else {
        // Format the response with the same formatting as chat messages
        responseDiv.innerHTML = processMessageText(response);
    }
    
    if (responseArea) {
        const responseContent = responseArea.querySelector('.response-content');
        if (responseContent) {
            responseContent.innerHTML = '';
            responseContent.appendChild(responseDiv);
        } else {
            responseArea.innerHTML = '';
            responseArea.appendChild(responseDiv);
        }
    }
    
    // Reposition after content changes to ensure it stays on screen
    setTimeout(() => repositionBubbleAfterContentChange(), 100);
    
    // Save the overlay state including the new response
    const overlayElement = document.getElementById(overlayId);
    if (overlayElement) {
        saveOverlayState(overlayElement);
        
        // Auto-save chat when overlay response is added
        if (currentChatId) {
            setTimeout(() => saveCurrentChat(), 200);
        }
    }
    
    // No footer needed - close button is in top-right corner
}

function hideSelectionResponseOverlay() {
    const overlay = document.getElementById('selectionResponseOverlay');
    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 300);
    }
    
    document.removeEventListener('keydown', handleOverlayEscape);
}

function handleOverlayEscape(event) {
    if (event.key === 'Escape') {
        hideSelectionResponseOverlay();
    }
}

function handleOverlayClickOutside(event) {
    if (event.target === event.currentTarget) {
        hideSelectionResponseOverlay();
    }
}

function handleOverlayKeyPress(event, overlayId) {
    const textarea = event.target;
    
    // Handle Enter key
    if (event.key === 'Enter') {
        // If Shift is held, allow new line
        if (event.shiftKey) {
            return;
        }
        
        // Prevent default Enter behavior
        event.preventDefault();
        
        // Don't send if the textarea is empty
        if (textarea.value.trim() === '') {
            return;
        }
        
        // Send the message
        sendSelectionQuery(overlayId);
        
        // Clear the textarea
        textarea.value = '';
        
        // Reset the height
        textarea.style.height = 'auto';
    }
    
    // Auto-resize the textarea
    setTimeout(() => {
        textarea.style.height = 'auto';
        textarea.style.height = (textarea.scrollHeight) + 'px';
    }, 0);
}

function setupOverlayResize(overlay) {
    const content = overlay.querySelector('.selection-response-content');
    const resizeHandle = overlay.querySelector('.overlay-resize-handle');
    
    if (!content || !resizeHandle || window.innerWidth <= 768) {
        return; // Skip on mobile
    }
    
    let isResizing = false;
    let startX, startY, startWidth, startHeight;
    let currentWidth, currentHeight;
    let resizeTimeout;
    
    // Add visual feedback for resize handle
    resizeHandle.addEventListener('mouseover', () => {
        resizeHandle.style.opacity = '1';
    });
    
    resizeHandle.addEventListener('mouseout', () => {
        if (!isResizing) {
            resizeHandle.style.opacity = '0.6';
        }
    });
    
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = parseInt(document.defaultView.getComputedStyle(content).width, 10);
        startHeight = parseInt(document.defaultView.getComputedStyle(content).height, 10);
        currentWidth = startWidth;
        currentHeight = startHeight;
        
        e.preventDefault();
        e.stopPropagation();
        
        // Add resize feedback
        content.style.transition = 'none';
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'nw-resize';
        resizeHandle.style.opacity = '1';
        
        // Add resize indicator
        let resizeIndicator = document.createElement('div');
        resizeIndicator.className = 'resize-indicator';
        resizeIndicator.style.position = 'fixed';
        resizeIndicator.style.background = 'rgba(var(--accent-primary-rgb), 0.9)';
        resizeIndicator.style.color = 'white';
        resizeIndicator.style.padding = '4px 8px';
        resizeIndicator.style.borderRadius = '4px';
        resizeIndicator.style.fontSize = '12px';
        resizeIndicator.style.zIndex = '10000';
        resizeIndicator.style.pointerEvents = 'none';
        document.body.appendChild(resizeIndicator);
        
        // Update size indicator
        function updateSizeIndicator(width, height) {
            resizeIndicator.textContent = `${width}px × ${height}px`;
            resizeIndicator.style.left = (e.clientX + 15) + 'px';
            resizeIndicator.style.top = (e.clientY + 15) + 'px';
        }
        updateSizeIndicator(startWidth, startHeight);
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        // Calculate new dimensions
        const width = startWidth + e.clientX - startX;
        const height = startHeight + e.clientY - startY;
        
        // Apply constraints with smooth snapping
        const minWidth = 280;
        const maxWidth = Math.min(800, window.innerWidth - 40);
        const minHeight = 200;
        const maxHeight = Math.min(600, window.innerHeight - 40);
        
        // Snap to min/max with a 20px threshold
        const snapThreshold = 20;
        let constrainedWidth = width;
        let constrainedHeight = height;
        
        if (Math.abs(width - minWidth) < snapThreshold) constrainedWidth = minWidth;
        if (Math.abs(width - maxWidth) < snapThreshold) constrainedWidth = maxWidth;
        if (Math.abs(height - minHeight) < snapThreshold) constrainedHeight = minHeight;
        if (Math.abs(height - maxHeight) < snapThreshold) constrainedHeight = maxHeight;
        
        // Ensure within bounds
        constrainedWidth = Math.max(minWidth, Math.min(constrainedWidth, maxWidth));
        constrainedHeight = Math.max(minHeight, Math.min(constrainedHeight, maxHeight));
        
        // Only update if size changed
        if (constrainedWidth !== currentWidth || constrainedHeight !== currentHeight) {
            currentWidth = constrainedWidth;
            currentHeight = constrainedHeight;
            
            content.style.width = constrainedWidth + 'px';
            content.style.height = constrainedHeight + 'px';
            content.style.maxWidth = 'none';
            content.style.maxHeight = 'none';
            
            // Update size indicator
            const indicator = document.querySelector('.resize-indicator');
            if (indicator) {
                indicator.textContent = `${constrainedWidth}px × ${constrainedHeight}px`;
                indicator.style.left = (e.clientX + 15) + 'px';
                indicator.style.top = (e.clientY + 15) + 'px';
            }
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            resizeHandle.style.opacity = '0.6';
            
            // Remove size indicator
            const indicator = document.querySelector('.resize-indicator');
            if (indicator) {
                indicator.remove();
            }
            
            // Save the new size
            saveOverlayState(overlay);
            
            // Restore transition
            setTimeout(() => {
                content.style.transition = '';
            }, 100);
        }
    });
}

async function getSelectionResponse(message) {
    const apiKey = getApiKey();
    
    // Validate API key
    if (apiKey === 'YOUR_API_KEY' || apiKey === 'your-api-key-here' || !apiKey) {
        throw new Error('Please set your OpenAI API key in the config.js file.');
    }
    
    // Build messages with full conversation context and system prompt
    let messages = buildMessagesWithSystem(conversationHistory);
    
    // Add the selection query as the latest message
    messages.push({
        role: 'user',
        content: message
    });
    
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: currentModel || 'gpt-4.1-2025-04-14',
            messages: messages,
            max_completion_tokens: 2000,
            temperature: 0.7
        })
    });
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
}

function showSelectionPreview(selectedText, prefix) {
    // Remove any existing preview UI only (don't clear context)
    hideSelectionPreviewUI();
    
    // Create preview bubble
    previewBubble = document.createElement('div');
    previewBubble.className = 'selection-preview-bubble';
    
    // Truncate text if too long for display
    let displayText = selectedText;
    if (displayText.length > 100) {
        displayText = displayText.substring(0, 100) + '...';
    }
    
    previewBubble.innerHTML = `
        <div class="preview-content">
            <div class="preview-prefix">${prefix}</div>
            <div class="preview-text">"${displayText}"</div>
        </div>
        <button class="preview-remove-btn" onclick="hideSelectionPreview()" aria-label="Remove selected text">
            <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2;">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </button>
    `;
    
    // Style the preview bubble
    previewBubble.style.cssText = `
        position: relative;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        background: rgba(59, 130, 246, 0.1);
        border: 1px solid rgba(59, 130, 246, 0.3);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 8px;
        font-size: 13px;
        line-height: 1.4;
        opacity: 0;
        transform: translateY(-10px);
        transition: all 0.2s ease;
    `;
    
    // Style the content
    const style = document.createElement('style');
    style.textContent = `
        .preview-content {
            flex: 1;
            margin-right: 8px;
        }
        .preview-prefix {
            font-weight: 600;
            color: #3b82f6;
            margin-bottom: 4px;
        }
        .preview-text {
            color: #6b7280;
            font-style: italic;
            word-break: break-word;
        }
        .preview-remove-btn {
            background: none;
            border: none;
            color: #9ca3af;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s ease;
            flex-shrink: 0;
        }
        .preview-remove-btn:hover {
            background: rgba(239, 68, 68, 0.1);
            color: #ef4444;
        }
    `;
    document.head.appendChild(style);
    
    // Insert before the input wrapper
    const inputContainer = document.querySelector('.input-container');
    if (inputContainer) {
        inputContainer.insertBefore(previewBubble, inputContainer.firstChild);
        
        // Animate in
        setTimeout(() => {
            previewBubble.style.opacity = '1';
            previewBubble.style.transform = 'translateY(0)';
        }, 10);
    }
}

function hideSelectionPreviewUI() {
    // Only hide the UI, don't clear the context
    if (previewBubble) {
        previewBubble.style.opacity = '0';
        previewBubble.style.transform = 'translateY(-10px)';
        setTimeout(() => {
            if (previewBubble && previewBubble.parentNode) {
                previewBubble.parentNode.removeChild(previewBubble);
            }
            previewBubble = null;
        }, 200);
    }
}

function hideSelectionPreview() {
    console.log('Clearing selectedTextContext');
    selectedTextContext = null;
    hideSelectionPreviewUI();
}

// Add Copy and Rewrite buttons to AI messages
function addMessageActions(messageDiv, messageText) {
    const messageContent = messageDiv.querySelector('.message-content');
    if (!messageContent) {
        return;
    }
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    
    // Store the message text on the message div for safe access
    messageDiv.dataset.messageText = messageText;
    
    const copyButton = document.createElement('button');
    copyButton.className = 'message-action-btn copy-btn';
    copyButton.setAttribute('aria-label', 'Copy message to clipboard');
    copyButton.innerHTML = `
        <svg viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="m5 15-2-2v-6a2 2 0 0 1 2-2h6l2 2"></path>
        </svg>
    `;
    copyButton.addEventListener('click', () => copyMessageToClipboard(copyButton, messageDiv));
    
    const rewriteButton = document.createElement('button');
    rewriteButton.className = 'message-action-btn rewrite-btn';
    rewriteButton.setAttribute('aria-label', 'Ask AI to rewrite this message');
    rewriteButton.innerHTML = `
        <svg viewBox="0 0 24 24">
            <path d="m3 16 4 4 4-4"></path>
            <path d="M7 20V4"></path>
            <path d="M20 8l-4-4-4 4"></path>
            <path d="M17 4v16"></path>
        </svg>
        Rewrite
    `;
    rewriteButton.addEventListener('click', () => rewriteMessage(messageDiv));
    
    actionsDiv.appendChild(copyButton);
    actionsDiv.appendChild(rewriteButton);
    messageContent.appendChild(actionsDiv);
}

// Mobile-friendly copy functionality
function addMobileCopyFunctionality(messageDiv, messageText) {
    const messageContent = messageDiv.querySelector('.message-content');
    if (!messageContent) return;
    
    let longPressTimer;
    let longPressTriggered = false;
    
    // Store the message text
    messageDiv.dataset.messageText = messageText;
    
    // Long press to copy
    messageContent.addEventListener('touchstart', (e) => {
        longPressTriggered = false;
        longPressTimer = setTimeout(() => {
            longPressTriggered = true;
            // Haptic feedback if available
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
            
            // Copy to clipboard
            copyToClipboardMobile(messageText, messageContent);
        }, 800); // 800ms long press
    });
    
    messageContent.addEventListener('touchend', () => {
        clearTimeout(longPressTimer);
    });
    
    messageContent.addEventListener('touchmove', () => {
        clearTimeout(longPressTimer);
    });
}

// Mobile clipboard copy with feedback
async function copyToClipboardMobile(text, element) {
    try {
        await navigator.clipboard.writeText(text);
        showMobileCopyFeedback(element, 'Copied!');
    } catch (err) {
        console.error('Failed to copy: ', err);
        showMobileCopyFeedback(element, 'Copy failed');
    }
}

// Show mobile copy feedback
function showMobileCopyFeedback(element, message) {
    const feedback = document.createElement('div');
    feedback.textContent = message;
    feedback.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        pointer-events: none;
    `;
    
    document.body.appendChild(feedback);
    
    setTimeout(() => {
        if (feedback.parentNode) {
            feedback.parentNode.removeChild(feedback);
        }
    }, 2000);
}

// Copy message content to clipboard
async function copyMessageToClipboard(button, messageDiv) {
    try {
        const messageText = messageDiv.dataset.messageText;
        if (!messageText) {
            showCopyTooltip(button, 'No text to copy');
            return;
        }
        
        await navigator.clipboard.writeText(messageText);
        showCopyTooltip(button, 'Copied!');
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showCopyTooltip(button, 'Copy failed');
    }
}

// Show tooltip feedback for copy action
function showCopyTooltip(button, message) {
    // Remove existing tooltip
    const existingTooltip = button.querySelector('.tooltip');
    if (existingTooltip) {
        existingTooltip.remove();
    }
    
    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.textContent = message;
    
    // Position tooltip relative to button
    button.style.position = 'relative';
    button.appendChild(tooltip);
    
    // Show tooltip
    setTimeout(() => {
        tooltip.classList.add('show');
    }, 10);
    
    // Hide tooltip after delay
    setTimeout(() => {
        tooltip.classList.remove('show');
        setTimeout(() => {
            if (tooltip.parentNode) {
                tooltip.remove();
            }
        }, 200);
    }, 2000);
}

// Rewrite message by automatically submitting a rewrite request
function rewriteMessage(messageDiv) {
    const messageText = messageDiv.dataset.messageText;
    if (!messageText || conversationHistory.length === 0) {
        return;
    }
    
    // Remove the AI message from the DOM
    messageDiv.remove();
    
    // Remove the associated buttons (they come right after the message)
    const messagesContainer = document.getElementById('messages');
    const nextElement = messagesContainer.querySelector('.ai-message-buttons:last-child');
    if (nextElement) {
        nextElement.remove();
    }
    
    // Remove the last AI response from conversation history
    // Find the last assistant message and remove it
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
        if (conversationHistory[i].role === 'assistant') {
            conversationHistory.splice(i, 1);
            break;
        }
    }
    
    // Regenerate the AI response using existing conversation history
    regenerateLastResponse();
}

async function regenerateLastResponse() {
    if (conversationHistory.length === 0) {
        return;
    }
    
    const apiKey = getApiKey();
    
    // Validate API key
    if (apiKey === 'YOUR_API_KEY' || apiKey === 'your-api-key-here' || !apiKey) {
        addMessage('⚠️ Please set your OpenAI API key to regenerate responses.', 'ai', 'error');
        return;
    }
    
    // Show typing indicator
    const typingId = addMessage('', 'ai', 'typing');
    
    try {
        // Build messages array for API call
        let messages;
        if (currentModel === 'gpt-image-1') {
            messages = conversationHistory;
        } else {
            messages = buildMessagesWithSystem(conversationHistory);
        }
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: currentModel,
                messages: messages,
                max_completion_tokens: 10000,
                ...(currentModel !== 'gpt-4o-search-preview-2025-03-11' && { temperature: getModelTemperature(currentModel) })
            })
        });

        // Remove typing indicator
        removeMessage(typingId);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const aiMessage = data.choices[0].message.content;
        

        // Add new AI response to conversation history
        conversationHistory.push({
            role: 'assistant',
            content: aiMessage
        });

        // Display the new AI response
        addMessage(aiMessage, 'ai');
        
        // Save the updated chat
        await saveCurrentChat();

    } catch (error) {
        // Remove typing indicator on error
        removeMessage(typingId);
        console.error('Error regenerating response:', error);
        addMessage(`❌ Error regenerating response: ${error.message}`, 'ai', 'error');
    }
}

function removeMessage(messageId) {
    const messageDiv = document.getElementById(messageId);
    if (messageDiv) {
        messageDiv.remove();
    }
}

function clearChat() {
    const messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = `
        <div class="welcome-screen">
            <div class="welcome-icon">✨</div>
            <h2>How can I help you today?</h2>
        </div>
    `;
    conversationHistory = [];
    clearSelectedFiles();
}

// File handling functions
function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    
    // Process each file
    files.forEach(file => processFile(file));
}

async function processFile(file) {
    // Validate file type
    const isImage = file.type.startsWith('image/');
    const isPDF = file.type === 'application/pdf';
    const isAudio = file.type.startsWith('audio/') || 
                   file.name.toLowerCase().endsWith('.mp3') ||
                   file.name.toLowerCase().endsWith('.wav') ||
                   file.name.toLowerCase().endsWith('.m4a') ||
                   file.name.toLowerCase().endsWith('.aac');
    
    if (!isImage && !isPDF && !isAudio) {
        addMessage('❌ Please select a valid image, PDF, or audio file.', 'ai', 'error');
        return;
    }

    // Validate file size (max 25MB for audio, 20MB for others)
    const maxSize = isAudio ? 25 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > maxSize) {
        const sizeLimit = isAudio ? '25MB' : '20MB';
        addMessage(`❌ File is too large. Please select a file under ${sizeLimit}.`, 'ai', 'error');
        return;
    }

    if (isImage) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const imageData = {
                name: file.name,
                size: file.size,
                dataUrl: e.target.result
            };
            
            // Add to selected images array
            selectedImages.push(imageData);
            showFilePreview();
        };
        reader.readAsDataURL(file);
    } else if (isPDF) {
        try {
            // Set up PDF.js worker
            if (typeof pdfjsLib !== 'undefined') {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                
                let text = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    text += `Page ${i}:\n${pageText}\n\n`;
                }
                
                const fileData = {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    text: text.trim(),
                    pages: pdf.numPages
                };
                
                // Add to selected files array
                selectedFiles.push(fileData);
                showFilePreview();
            } else {
                addMessage('❌ PDF processing is not available. Please refresh the page and try again.', 'ai', 'error');
            }
        } catch (error) {
            console.error('Error processing PDF:', error);
            addMessage('❌ Error processing PDF file. Please try again.', 'ai', 'error');
        }
    } else if (isAudio) {
        try {
            // Store audio file for transcription
            const audioData = {
                name: file.name,
                size: file.size,
                type: file.type || 'audio/mpeg',
                file: file, // Store the actual file for transcription
                isAudio: true
            };
            
            // Add to selected files array
            selectedFiles.push(audioData);
            showFilePreview();
        } catch (error) {
            console.error('Error processing audio file:', error);
            addMessage('❌ Error processing audio file. Please try again.', 'ai', 'error');
        }
    }
}

async function processImageFile(file) {
    // This is kept for backward compatibility with existing paste/drag functions
    await processFile(file);
}

function handlePaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
                processFile(file);
                
                // Show feedback that image was pasted
                const input = document.getElementById('messageInput');
                if (input && !input.value.trim()) {
                    input.placeholder = 'Image pasted! Add a message or press Enter to send...';
                    setTimeout(() => {
                        input.placeholder = 'Message ChatGPT...';
                    }, 3000);
                }
            }
            break;
        }
    }
}

function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    
    // Add visual feedback for drag over
    const mainContent = document.querySelector('.main-content');
    mainContent.classList.add('drag-over');
}

function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    
    // Remove visual feedback when drag leaves
    const mainContent = document.querySelector('.main-content');
    if (!mainContent.contains(event.relatedTarget)) {
        mainContent.classList.remove('drag-over');
    }
}

function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    
    // Remove visual feedback
    const mainContent = document.querySelector('.main-content');
    mainContent.classList.remove('drag-over');
    
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    
    // Process all valid files
    let validFiles = 0;
    let fileTypes = [];
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isImage = file.type.startsWith('image/');
        const isPDF = file.type === 'application/pdf';
        const isAudio = file.type.startsWith('audio/') || 
                       file.name.toLowerCase().endsWith('.mp3') ||
                       file.name.toLowerCase().endsWith('.wav') ||
                       file.name.toLowerCase().endsWith('.m4a') ||
                       file.name.toLowerCase().endsWith('.aac');
        
        if (isImage || isPDF || isAudio) {
            processFile(file);
            validFiles++;
            
            if (isImage && !fileTypes.includes('Images')) fileTypes.push('Images');
            if (isPDF && !fileTypes.includes('PDFs')) fileTypes.push('PDFs');
            if (isAudio && !fileTypes.includes('Audio files')) fileTypes.push('Audio files');
        }
    }
    
    // Show feedback that files were dropped
    if (validFiles > 0) {
        const input = document.getElementById('messageInput');
        if (input && !input.value.trim()) {
            const fileTypeText = fileTypes.join(', ');
            input.placeholder = `${validFiles} file(s) dropped (${fileTypeText})! Add a message or press Enter to send...`;
            setTimeout(() => {
                input.placeholder = 'Message ChatGPT...';
            }, 3000);
        }
    }
}

function showFilePreview() {
    const preview = document.getElementById('filePreview');
    if (selectedImages.length === 0 && selectedFiles.length === 0) {
        preview.classList.remove('active');
        return;
    }

    let previewHTML = '<div class="preview-container">';
    
    // Show all selected images
    selectedImages.forEach((image, index) => {
        previewHTML += `
            <div class="preview-item">
                <img src="${image.dataUrl}" alt="${image.name}" class="preview-image">
                <div class="preview-info">
                    <div class="preview-name">${image.name}</div>
                    <div class="preview-size">${formatFileSize(image.size)}</div>
                </div>
                <button onclick="removeFile('image', ${index})" class="remove-file">×</button>
            </div>
        `;
    });
    
    // Show all selected files
    selectedFiles.forEach((file, index) => {
        if (file.isAudio) {
            previewHTML += `
                <div class="preview-item">
                    <div class="preview-audio">MP3</div>
                    <div class="preview-info">
                        <div class="preview-name">${file.name}</div>
                        <div class="preview-size">${formatFileSize(file.size)}</div>
                        <div class="preview-size">Audio file for transcription</div>
                    </div>
                    <button onclick="removeFile('file', ${index})" class="remove-file">×</button>
                </div>
            `;
        } else {
            previewHTML += `
                <div class="preview-item">
                    <div class="preview-pdf">PDF</div>
                    <div class="preview-info">
                        <div class="preview-name">${file.name}</div>
                        <div class="preview-size">${formatFileSize(file.size)}</div>
                        ${file.pages ? `<div class="preview-size">${file.pages} pages</div>` : ''}
                    </div>
                    <button onclick="removeFile('file', ${index})" class="remove-file">×</button>
                </div>
            `;
        }
    });
    
    previewHTML += '</div>';
    
    // Add clear all button if there are multiple files
    if (selectedImages.length + selectedFiles.length > 1) {
        previewHTML += '<button onclick="clearSelectedFiles()" class="clear-all-files">Clear All</button>';
    }
    
    preview.innerHTML = previewHTML;
    preview.classList.add('active');
}

function clearSelectedFiles() {
    selectedImages = [];
    selectedFiles = [];
    const preview = document.getElementById('filePreview');
    preview.classList.remove('active');
    document.getElementById('fileInput').value = '';
}

function removeFile(type, index) {
    if (type === 'image') {
        selectedImages.splice(index, 1);
    } else if (type === 'file') {
        selectedFiles.splice(index, 1);
    }
    
    // Update preview or hide if no files left
    if (selectedImages.length === 0 && selectedFiles.length === 0) {
        const preview = document.getElementById('filePreview');
        preview.classList.remove('active');
        document.getElementById('fileInput').value = '';
    } else {
        showFilePreview();
    }
}

// Keep for backward compatibility
function showImagePreview() {
    showFilePreview();
}

function clearSelectedImage() {
    clearSelectedFiles();
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Voice recording functions
// OpenAI Whisper Audio Recording Functions
async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    const voiceButton = document.getElementById('voiceButton');
    voiceButton.classList.add('requesting');
    voiceButton.title = 'Requesting microphone access...';
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        voiceButton.classList.remove('requesting');
        
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            await transcribeWithWhisper(audioBlob);
            
            // Stop all tracks to release microphone
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        isRecording = true;
        updateVoiceButton();
        
        // Show feedback in input placeholder
        const input = document.getElementById('messageInput');
        input.placeholder = '🎤 Recording... Click the microphone to stop and transcribe';
        
    } catch (error) {
        console.error('Error accessing microphone:', error);
        voiceButton.classList.remove('requesting');
        updateVoiceButton();
        
        let errorMessage = '❌ Could not access microphone. ';
        if (error.name === 'NotAllowedError') {
            errorMessage += 'Please allow microphone permissions in your browser settings.';
        } else if (error.name === 'NotFoundError') {
            errorMessage += 'No microphone found. Please check your device.';
        } else {
            errorMessage += 'Please check your permissions and try again.';
        }
        addMessage(errorMessage, 'ai', 'error');
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        updateVoiceButton();
        
        // Reset input placeholder
        const input = document.getElementById('messageInput');
        input.placeholder = 'Message ChatGPT...';
    }
}

async function transcribeWithWhisper(audioBlob) {
    const voiceButton = document.getElementById('voiceButton');
    const messageInput = document.getElementById('messageInput');
    
    voiceButton.classList.add('processing');
    voiceButton.title = 'Transcribing with Whisper...';
    
    // Show processing state in placeholder
    messageInput.placeholder = '🤖 Transcribing with OpenAI Whisper...';
    
    try {
        const apiKey = getApiKey();
        
        if (apiKey === 'YOUR_API_KEY' || apiKey === 'your-api-key-here' || !apiKey || apiKey === 'prompt-for-key') {
            addMessage('⚠️ Please set your OpenAI API key to use speech transcription.', 'ai', 'error');
            return;
        }
        
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.wav');
        formData.append('model', 'whisper-1');
        formData.append('language', 'en'); // Can be made configurable
        formData.append('response_format', 'json');
        
        console.log('🎤 Sending audio to OpenAI Whisper...');
        
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Whisper API Error: ${errorData.error?.message || response.statusText}`);
        }
        
        const data = await response.json();
        const transcribedText = data.text.trim();
        
        console.log('✅ Whisper transcription successful:', transcribedText);
        
        if (transcribedText) {
            const currentText = messageInput.value.trim();
            
            // Append transcribed text to existing input
            if (currentText) {
                messageInput.value = currentText + ' ' + transcribedText;
            } else {
                messageInput.value = transcribedText;
            }
            
            // Auto-resize textarea
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
            
            // Focus input for user to edit or send
            messageInput.focus();
            
            // Show success feedback
            messageInput.placeholder = '✅ Whisper transcription complete! Edit or press Enter to send...';
            setTimeout(() => {
                messageInput.placeholder = 'Message ChatGPT... (paste/drag images, PDFs, or audio)';
            }, 3000);
            
        } else {
            addMessage('⚠️ No speech detected in the recording. Please try again.', 'ai', 'error');
        }
        
    } catch (error) {
        console.error('Error transcribing with Whisper:', error);
        addMessage(`❌ Whisper transcription error: ${error.message}`, 'ai', 'error');
        
        // Reset placeholder on error
        messageInput.placeholder = 'Message ChatGPT... (paste/drag images, PDFs, or audio)';
    } finally {
        voiceButton.classList.remove('processing');
        voiceButton.title = 'Voice input';
    }
}

function updateVoiceButton() {
    const voiceButton = document.getElementById('voiceButton');
    
    if (isRecording) {
        voiceButton.classList.add('recording');
        voiceButton.title = 'Stop recording';
        voiceButton.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="6" y="6" width="12" height="12" rx="2"/>
            </svg>
        `;
    } else if (voiceButton.classList.contains('processing')) {
        voiceButton.title = 'Transcribing...';
        voiceButton.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
        `;
    } else {
        voiceButton.classList.remove('recording', 'requesting');
        voiceButton.title = 'Voice input (OpenAI Whisper)';
        voiceButton.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
        `;
    }
}

async function transcribeAudioFile(audioFile) {
    try {
        const apiKey = getApiKey();
        
        if (apiKey === 'YOUR_API_KEY' || apiKey === 'your-api-key-here' || !apiKey) {
            throw new Error('Please set your OpenAI API key in the config.js file.');
        }
        
        const formData = new FormData();
        formData.append('file', audioFile);
        formData.append('model', 'gpt-4o-transcribe');
        formData.append('language', 'en'); // Can be made configurable
        
        const response = await fetch(WHISPER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`GPT-4o Transcribe API Error: ${errorData.error?.message || response.statusText}`);
        }
        
        const data = await response.json();
        return data.text.trim();
        
    } catch (error) {
        console.error('Error transcribing audio file:', error);
        throw error;
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', async function() {
    const fileInput = document.getElementById('fileInput');
    const messageInput = document.getElementById('messageInput');
    const mainContent = document.querySelector('.main-content');

    // Load inline commands (now async)
    loadInlineCommands().catch(error => {
        console.warn('Failed to load inline commands during initialization:', error);
    });

    // Set up authentication state change listener for command syncing
    let lastAuthState = null;
    setInterval(() => {
        const currentAuthState = window.chatStorage && window.chatStorage.getCurrentUser() ? 'authenticated' : 'unauthenticated';
        if (lastAuthState !== null && lastAuthState !== currentAuthState) {
            console.log(`🔄 Auth state changed from ${lastAuthState} to ${currentAuthState}`);
            syncCommandsOnAuthChange().catch(error => {
                console.warn('Failed to sync commands on auth change:', error);
            });
        }
        lastAuthState = currentAuthState;
    }, 2000); // Check every 2 seconds

    // Start periodic cache cleanup
    setInterval(() => {
        storageOptimizer.cleanupCache();
    }, 5 * 60 * 1000); // Every 5 minutes

    // Add input event listener for inline commands
    if (messageInput) {
        messageInput.addEventListener('keydown', function(e) {
            // Handle hint navigation
            if (e.key === 'ArrowDown') {
                if (navigateHints('down')) {
                    e.preventDefault();
                    return;
                }
            } else if (e.key === 'ArrowUp') {
                if (navigateHints('up')) {
                    e.preventDefault();
                    return;
                }
            } else if (e.key === 'Tab') {
                if (selectCurrentHint()) {
                    e.preventDefault();
                    return;
                }
            } else if (e.key === 'Escape') {
                hideCommandHints();
                return;
            }
            
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                
                // Check if we have a selected hint
                if (selectCurrentHint()) {
                    return;
                }
                
                const input = messageInput.value.trim();
                
                // Check if it's an inline command
                if (processInlineCommand(input)) {
                    messageInput.value = ''; // Clear input after command
                    hideCommandHints();
                    return;
                }
                
                // Otherwise, send as normal message
                hideCommandHints();
                sendMessage();
            }
        });

        // Add input event listener for showing hints
        messageInput.addEventListener('input', function(e) {
            const value = messageInput.value;
            
            if (value.startsWith('/')) {
                showCommandHints(value);
            } else {
                hideCommandHints();
            }
        });

        // Hide hints when clicking outside
        document.addEventListener('click', function(e) {
            if (!messageInput.contains(e.target) && 
                (!commandHintsDropdown || !commandHintsDropdown.contains(e.target))) {
                hideCommandHints();
            }
        });

        // Hide hints when input loses focus
        messageInput.addEventListener('blur', function(e) {
            // Delay hiding to allow clicking on hints
            setTimeout(() => {
                if (!messageInput.matches(':focus')) {
                    hideCommandHints();
                }
            }, 150);
        });
    }

    // Check for API key
    const hasApiKey = await promptForApiKey();
    
    // Always initialize the app, but show a message if no API key
    await initializeApp();
    
    // Wait for Firebase modules to load, then set up auth listener
    let firebaseRetryCount = 0;
    const maxFirebaseRetries = 10;
    
    async function setupFirebaseAuthListener() {
        if (typeof window.authFunctions !== 'undefined' && window.authFunctions) {
            window.authFunctions.onAuthStateChanged(async (user) => {
                if (user) {
                    console.log('User signed in:', user.email);
                    console.log('Reloading chats from Firebase...');
                    await loadChatHistory();
                    updateHistoryDisplay();
                    // Load saved API key from user account
                    await loadSavedApiKey();
                    
                    // Initialize URL routing after chat history is loaded
                    initializeUrlRoutingAfterLoad();
                } else {
                    console.log('User signed out, clearing chat data');
                    chatHistory = [];
                    chatFolders = [];
                    updateHistoryDisplay();
                    
                    // Still initialize URL routing for new chats
                    initializeUrlRoutingAfterLoad();
                }
            });
            console.log('Firebase auth listener established');
            
            // Also check current auth state immediately for already signed-in users
            const currentUser = window.authFunctions.getCurrentUser();
            if (currentUser) {
                console.log('User already authenticated on page load:', currentUser.email);
                await loadChatHistory();
                updateHistoryDisplay();
                // Load saved API key from user account
                await loadSavedApiKey();
                
                // Initialize URL routing after chat history is loaded
                initializeUrlRoutingAfterLoad();
            }
        } else {
            firebaseRetryCount++;
            if (firebaseRetryCount < maxFirebaseRetries) {
                console.log(`Waiting for Firebase... (${firebaseRetryCount}/${maxFirebaseRetries})`);
                setTimeout(setupFirebaseAuthListener, 500);
            } else {
                console.log('Firebase not available - authentication required for chat storage');
                // App requires authentication for chat and folder storage
                // Load empty state to show login requirement
                await loadChatHistory();
                updateHistoryDisplay();
                
                // Initialize URL routing even without Firebase
                initializeUrlRoutingAfterLoad();
            }
        }
    }
    
    // Start trying to set up Firebase
    setTimeout(setupFirebaseAuthListener, 500);
    
    if (!hasApiKey) {
        // Show a helpful message in the welcome screen
        updateWelcomeScreenForNoApiKey();
    }
});

// Initialize URL routing
function initializeUrlRouting() {
    console.log('Initializing URL routing');
    
    // Handle hash changes (back/forward navigation and direct URL access)
    window.addEventListener('hashchange', function(event) {
        console.log('Hash changed:', window.location.hash);
        handleUrlChange();
    });
    
    // Also handle popstate for broader compatibility
    window.addEventListener('popstate', function(event) {
        handleUrlChange();
    });
    
    // Check URL on page load
    const urlChatId = getChatIdFromUrl();
    console.log('URL on page load:', window.location.href, 'Chat ID:', urlChatId);
    
    if (urlChatId) {
        // Load chat from URL after ensuring chat history is loaded
        setTimeout(() => {
            console.log('Attempting to load chat from URL after delay');
            handleUrlChange();
        }, 200);
    }
}

// Initialize URL routing after chat history is loaded
function initializeUrlRoutingAfterLoad() {
    console.log('Initializing URL routing after chat history loaded');
    
    // Only set up event listeners once
    if (!window.urlRoutingInitialized) {
        // Handle hash changes (back/forward navigation and direct URL access)
        window.addEventListener('hashchange', function(event) {
            console.log('Hash changed:', window.location.hash);
            handleUrlChange();
        });
        
        // Also handle popstate for broader compatibility
        window.addEventListener('popstate', function(event) {
            handleUrlChange();
        });
        
        window.urlRoutingInitialized = true;
        console.log('URL routing event listeners set up');
    }
    
    // Check URL immediately since chat history is now available
    const urlChatId = getChatIdFromUrl();
    console.log('Checking URL after load:', window.location.href, 'Chat ID:', urlChatId);
    console.log('Available chats:', chatHistory.length);
    
    if (urlChatId) {
        console.log('Loading chat from URL immediately:', urlChatId);
        handleUrlChange();
    } else if (currentChatId) {
        console.log('No chat ID in URL, but current chat exists. Updating URL to match:', currentChatId);
        updateChatUrl(currentChatId);
    } else {
        console.log('No chat ID in URL and no current chat, staying on welcome screen');
    }
}

// Debug function - you can call this in console to test
window.testUrlRouting = function() {
    console.log('=== URL Routing Debug ===');
    console.log('Current URL:', window.location.href);
    console.log('Hash:', window.location.hash);
    console.log('Chat ID from URL:', getChatIdFromUrl());
    console.log('Current chat ID:', currentChatId);
    console.log('Chat history length:', chatHistory.length);
    console.log('Available chat IDs:', chatHistory.map(c => c.id));
};

function updateWelcomeScreenForNoApiKey() {
    const welcomeScreen = document.querySelector('.welcome-screen');
    if (welcomeScreen) {
        welcomeScreen.innerHTML = `
            <div class="welcome-icon">🔑</div>
            <h2>Welcome to newGPT!</h2>
            <p style="color: #8e8ea0; margin: 16px 0; font-size: 16px;">
                To get started, please add your OpenAI API key in the Settings.
            </p>
            <button onclick="showSettingsMenu()" style="
                background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
                border: none;
                border-radius: 8px;
                color: white;
                padding: 12px 24px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.3s ease;
                margin-top: 8px;
            " onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
                ⚙️ Open Settings
            </button>
        `;
    }
}

async function initializeApp() {
    const fileInput = document.getElementById('fileInput');
    const messageInput = document.getElementById('messageInput');
    const mainContent = document.querySelector('.main-content');
    
    // Update UI to show API key status
    updateApiKeyStatus();

    // Chat history will be loaded after Firebase auth is established
    
    
    // Load image generation settings
    loadImageSettings();
    
    
    // Ensure input is enabled on page load
    if (messageInput) {
        messageInput.disabled = false;
        messageInput.value = '';
        console.log('Message input initialized');
    } else {
        console.error('Message input element not found!');
    }

    // File input handler
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }

    // Paste event listener for images
    document.addEventListener('paste', handlePaste);

    // Drag and drop event listeners
    if (mainContent) {
        mainContent.addEventListener('dragover', handleDragOver);
        mainContent.addEventListener('dragleave', handleDragLeave);
        mainContent.addEventListener('drop', handleDrop);
    }

    // Prevent default drag behaviors on the whole document
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());

    // Model selector event listeners - wait for elements to be available
    setTimeout(() => {
        document.querySelectorAll('.model-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const model = option.dataset.model;
                console.log('Model option clicked:', model);
                selectModel(model);
            });
        });
    }, 100);

    // Close model dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.model-selector-input')) {
            // Close both dropdowns
            const headerDropdown = document.getElementById('modelDropdownHeader');
            const inputDropdown = document.getElementById('modelDropdown');
            const headerButton = document.querySelector('.chat-header .model-selector-btn');
            const inputButton = document.querySelector('.input-wrapper .model-selector-btn');
            
            if (headerDropdown) headerDropdown.classList.remove('active');
            if (inputDropdown) inputDropdown.classList.remove('active');
            if (headerButton) headerButton.classList.remove('active');
            if (inputButton) inputButton.classList.remove('active');
        }
    });

    // Auto-resize textarea
    if (messageInput) {
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 200) + 'px';
        });

        // Allow Enter key to send message (but not Shift+Enter for new lines)
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
            
            // Stop recording if ESC is pressed while recording
            if (e.key === 'Escape' && isRecording) {
                e.preventDefault();
                stopRecording();
            }
        });
    }

    // Initialize current model display
    selectModel(currentModel);

    // Auto-save current chat when page is about to unload
    window.addEventListener('beforeunload', () => {
        if (isRecording) stopRecording();
        if (conversationHistory.length > 0 && typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) {
            // Save current chat to Firebase only if authenticated
            const currentTime = Date.now();
            const chatData = {
                id: currentChatId || generateChatId(),
                title: getChatTitle(conversationHistory),
                messages: [...conversationHistory],
                model: currentModel,
                        timestamp: currentTime,
                lastUpdated: currentTime,
                date: new Date().toLocaleDateString()
            };
            
            // Update or add to chat history
            const existingIndex = chatHistory.findIndex(chat => chat.id === chatData.id);
            if (existingIndex !== -1) {
                chatHistory[existingIndex] = chatData;
            } else {
                chatHistory.unshift(chatData);
                currentChatId = chatData.id;
            }
            
            // Save to Firebase only
            try {
                window.chatStorage.saveChat(chatData);
            } catch (e) {
                console.error('Error saving chat to Firebase on unload:', e);
            }
        }
    });

    // Close sidebar on ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSidebar();
    });

    // Close sidebar when resizing to desktop
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) closeSidebar();
    });

    // Close sidebar when clicking on main content on mobile
    if (mainContent) {
        mainContent.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                const sidebar = document.querySelector('.sidebar');
                if (sidebar.classList.contains('open') && !e.target.closest('.sidebar-toggle')) {
                    closeSidebar();
                }
            }
        });
    }
}

// Image generation settings
let imageSettings = {
    quality: 'auto',
    size: 'auto',
    background: 'auto',
    outputFormat: 'png'
};

// Image generation function for gpt-image-1
async function handleImageGeneration(prompt) {
    const input = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    
    // Disable input and button during request
    input.disabled = true;
    sendButton.disabled = true;

    // Hide welcome screen
    const welcomeScreen = document.querySelector('.welcome-screen');
    if (welcomeScreen) {
        welcomeScreen.style.display = 'none';
    }

    // Add user message
    addMessage(prompt, 'user', 'normal');
    
    // Clear input
    input.value = '';
    input.style.height = 'auto';

    // Show generating indicator
    const generatingId = addMessage('🎨 Generating image...', 'ai', 'typing');

    try {
        const apiKey = getApiKey();
        
        // Enhance prompt based on settings
        let enhancedPrompt = prompt;
        
        // Add quality modifiers to prompt
        if (imageSettings.quality === 'high') {
            enhancedPrompt += ', high quality, detailed, professional';
        } else if (imageSettings.quality === 'medium') {
            enhancedPrompt += ', good quality, clear';
        } else if (imageSettings.quality === 'low') {
            enhancedPrompt += ', simple, basic style';
        }
        
        // Add background preferences to prompt
        if (imageSettings.background === 'transparent') {
            enhancedPrompt += ', transparent background, PNG format';
        } else if (imageSettings.background === 'opaque') {
            enhancedPrompt += ', solid background, no transparency';
        }
        
        // Add aspect ratio hints to prompt based on size
        if (imageSettings.size === '1024x1536') {
            enhancedPrompt += ', portrait orientation, vertical composition';
        } else if (imageSettings.size === '1536x1024') {
            enhancedPrompt += ', landscape orientation, horizontal composition';
        } else if (imageSettings.size === '1024x1024') {
            enhancedPrompt += ', square composition';
        }
        
        // Prepare request body with correct parameters for gpt-image-1
        const requestBody = {
            model: 'gpt-image-1', // Use the real gpt-image-1 model
            prompt: enhancedPrompt,
            n: 1
            // Note: gpt-image-1 may not support response_format parameter
        };
        
        // Add size if not auto (only if supported by the model)
        if (imageSettings.size !== 'auto') {
            requestBody.size = imageSettings.size;
        }
        
        // Note: quality parameter may not be supported by gpt-image-1
        // Quality is handled through prompt enhancement instead
        
        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        // Remove generating indicator
        removeMessage(generatingId);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'Image generation failed');
        }

        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            const imageData = data.data[0];
            
            // Handle different response formats
            if (imageData.b64_json) {
                // Base64 format (if supported)
                displayGeneratedImage(imageData.b64_json, prompt);
            } else if (imageData.url) {
                // URL format - convert to base64 for our display function
                await convertUrlToBase64AndDisplay(imageData.url, prompt);
            } else {
                throw new Error('Unknown image response format');
            }
            
            
            // Save the conversation
            conversationHistory.push({
                role: 'user',
                content: prompt
            });
            conversationHistory.push({
                role: 'assistant',
                content: `Generated image: ${prompt}`
            });
            
            await saveCurrentChat();
        }

    } catch (error) {
        removeMessage(generatingId);
        console.error('Image generation error:', error);
        addMessage(`❌ Image generation failed: ${error.message}`, 'ai', 'error');
    } finally {
        input.disabled = false;
        sendButton.disabled = false;
    }
}

// Image editing function for gpt-image-1
async function handleImageEditing(prompt, images) {
    const input = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    
    // Disable input and button during request
    input.disabled = true;
    sendButton.disabled = true;

    // Hide welcome screen
    const welcomeScreen = document.querySelector('.welcome-screen');
    if (welcomeScreen) {
        welcomeScreen.style.display = 'none';
    }

    // Add user message with images
    addMessage(prompt || 'Edit this image', 'user', 'normal', images[0]);
    
    // Clear input and files
    input.value = '';
    input.style.height = 'auto';
    clearSelectedFiles();

    // Show editing indicator
    const editingId = addMessage('🎨 Editing image...', 'ai', 'typing');

    try {
        const apiKey = getApiKey();
        
        // Convert image to form data
        const formData = new FormData();
        formData.append('prompt', prompt || 'Edit this image');
        formData.append('model', 'gpt-image-1'); // Use the real gpt-image-1 model
        formData.append('n', '1');
        // Note: response_format may not be supported by gpt-image-1
        
        // Add size if not auto (only if supported by the model)
        if (imageSettings.size !== 'auto') {
            formData.append('size', imageSettings.size);
        }
        
        // Add the image file
        const imageFile = images[0];
        if (imageFile instanceof File) {
            formData.append('image', imageFile);
        } else {
            // Convert base64 to file if needed
            const response = await fetch(imageFile);
            const blob = await response.blob();
            formData.append('image', blob, 'image.png');
        }

        const response = await fetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        // Remove editing indicator
        removeMessage(editingId);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'Image editing failed');
        }

        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            const imageData = data.data[0];
            
            // Handle different response formats
            if (imageData.b64_json) {
                // Base64 format (if supported)
                displayGeneratedImage(imageData.b64_json, `Edited: ${prompt}`);
            } else if (imageData.url) {
                // URL format - convert to base64 for our display function
                await convertUrlToBase64AndDisplay(imageData.url, `Edited: ${prompt}`);
            } else {
                throw new Error('Unknown image response format');
            }
            
            
            // Save the conversation
            conversationHistory.push({
                role: 'user',
                content: [
                    { type: 'text', text: prompt || 'Edit this image' },
                    { type: 'image_url', image_url: { url: imageFile } }
                ]
            });
            conversationHistory.push({
                role: 'assistant',
                content: `Edited image: ${prompt}`
            });
            
            await saveCurrentChat();
        }

    } catch (error) {
        removeMessage(editingId);
        console.error('Image editing error:', error);
        addMessage(`❌ Image editing failed: ${error.message}`, 'ai', 'error');
    } finally {
        input.disabled = false;
        sendButton.disabled = false;
    }
}

// Convert URL to base64 for display
async function convertUrlToBase64AndDisplay(imageUrl, description) {
    try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64Data = reader.result.split(',')[1]; // Remove data:image/png;base64, prefix
                displayGeneratedImage(base64Data, description);
                resolve();
            };
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('Failed to convert URL to base64:', error);
        // Fallback: display image directly with URL
        displayGeneratedImageFromUrl(imageUrl, description);
    }
}

// Display image directly from URL (fallback method)
function displayGeneratedImageFromUrl(imageUrl, description) {
    const messagesContainer = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    messageDiv.id = messageId;
    messageDiv.className = 'message ai-message';
    
    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="message-text">
                <div class="generated-image-container">
                    <img src="${imageUrl}" alt="${description}" class="generated-image">
                    <div class="image-description">${description}</div>
                    <div class="image-settings-info">
                        <small>Quality: ${imageSettings.quality} • Size: ${imageSettings.size} • Format: URL</small>
                    </div>
                    <div class="image-actions">
                        <button onclick="downloadImageFromUrl('${imageUrl}', '${description}')" class="image-action-btn">
                            📥 Download
                        </button>
                        <button onclick="copyImageUrlToClipboard('${imageUrl}')" class="image-action-btn">
                            📋 Copy URL
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Convert image format based on settings
async function convertImageFormat(base64Data, targetFormat) {
    if (targetFormat === 'png') {
        return { data: base64Data, mimeType: 'image/png' };
    }
    
    try {
        // Create canvas to convert format
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        return new Promise((resolve) => {
            img.onload = () => {
                canvas.width = img.width;
                canvas.height = img.height;
                
                // For JPEG, fill with white background (no transparency)
                if (targetFormat === 'jpeg') {
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
                
                ctx.drawImage(img, 0, 0);
                
                const quality = imageSettings.quality === 'high' ? 0.9 : 
                               imageSettings.quality === 'medium' ? 0.7 : 0.5;
                
                const convertedData = canvas.toDataURL(
                    `image/${targetFormat}`, 
                    targetFormat === 'jpeg' ? quality : undefined
                ).split(',')[1];
                
                resolve({
                    data: convertedData,
                    mimeType: `image/${targetFormat}`
                });
            };
            img.src = `data:image/png;base64,${base64Data}`;
        });
    } catch (error) {
        console.warn('Format conversion failed, using original:', error);
        return { data: base64Data, mimeType: 'image/png' };
    }
}

// Display generated/edited image
async function displayGeneratedImage(base64Data, description) {
    const messagesContainer = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    messageDiv.id = messageId;
    messageDiv.className = 'message ai-message';
    
    // Convert to desired format
    const convertedImage = await convertImageFormat(base64Data, imageSettings.outputFormat);
    
    // Create file extension based on format
    const extension = imageSettings.outputFormat;
    
    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="message-text">
                <div class="generated-image-container">
                    <img src="data:${convertedImage.mimeType};base64,${convertedImage.data}" alt="${description}" class="generated-image">
                    <div class="image-description">${description}</div>
                    <div class="image-settings-info">
                        <small>Quality: ${imageSettings.quality} • Size: ${imageSettings.size} • Format: ${extension.toUpperCase()}</small>
                    </div>
                    <div class="image-actions">
                        <button onclick="downloadImage('${convertedImage.data}', '${description}', '${extension}', '${convertedImage.mimeType}')" class="image-action-btn">
                            📥 Download
                        </button>
                        <button onclick="copyImageToClipboard('${convertedImage.data}', '${convertedImage.mimeType}')" class="image-action-btn">
                            📋 Copy
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Download generated image
function downloadImage(base64Data, description, extension = 'png', mimeType = 'image/png') {
    const link = document.createElement('a');
    link.href = `data:${mimeType};base64,${base64Data}`;
    link.download = `${description.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Copy image to clipboard
async function copyImageToClipboard(base64Data, mimeType = 'image/png') {
    try {
        const response = await fetch(`data:${mimeType};base64,${base64Data}`);
        const blob = await response.blob();
        await navigator.clipboard.write([
            new ClipboardItem({ [mimeType]: blob })
        ]);
        // Show temporary success message
        const successMsg = addMessage('✅ Image copied to clipboard!', 'ai', 'normal');
        setTimeout(() => removeMessage(successMsg), 2000);
    } catch (error) {
        console.error('Failed to copy image:', error);
        addMessage('❌ Failed to copy image to clipboard', 'ai', 'error');
    }
}

// Download image from URL
async function downloadImageFromUrl(imageUrl, description) {
    try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `${description.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Failed to download image:', error);
        addMessage('❌ Failed to download image', 'ai', 'error');
    }
}

// Copy image URL to clipboard
async function copyImageUrlToClipboard(imageUrl) {
    try {
        await navigator.clipboard.writeText(imageUrl);
        // Show temporary success message
        const successMsg = addMessage('✅ Image URL copied to clipboard!', 'ai', 'normal');
        setTimeout(() => removeMessage(successMsg), 2000);
    } catch (error) {
        console.error('Failed to copy URL:', error);
        addMessage('❌ Failed to copy URL to clipboard', 'ai', 'error');
    }
}

// Copy code block content to clipboard
async function copyToClipboard(button) {
    try {
        const codeWrapper = button.closest('.code-block-wrapper');
        const codeElement = codeWrapper.querySelector('pre code');
        const codeText = codeElement.textContent;
        
        await navigator.clipboard.writeText(codeText);
        
        // Update button appearance temporarily
        const originalContent = button.innerHTML;
        button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"></polyline></svg>';
        button.style.color = '#10b981';
        
        setTimeout(() => {
            button.innerHTML = originalContent;
            button.style.color = '';
        }, 2000);
        
    } catch (error) {
        console.error('Failed to copy code:', error);
        // Show error state
        const originalContent = button.innerHTML;
        button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
        button.style.color = '#ef4444';
        
        setTimeout(() => {
            button.innerHTML = originalContent;
            button.style.color = '';
        }, 2000);
    }
}

// Accent Color Management
const accentColors = {
    '#4f46e5': { 
        primary: '#4f46e5', secondary: '#7c3aed', tertiary: '#06b6d4', 
        rgb: '79, 70, 229', secondaryRgb: '124, 58, 237', tertiaryRgb: '6, 182, 212' 
    },
    '#06b6d4': { 
        primary: '#06b6d4', secondary: '#0891b2', tertiary: '#22d3ee', 
        rgb: '6, 182, 212', secondaryRgb: '8, 145, 178', tertiaryRgb: '34, 211, 238' 
    },
    '#10b981': { 
        primary: '#10b981', secondary: '#059669', tertiary: '#34d399', 
        rgb: '16, 185, 129', secondaryRgb: '5, 150, 105', tertiaryRgb: '52, 211, 153' 
    },
    '#f59e0b': { 
        primary: '#f59e0b', secondary: '#d97706', tertiary: '#fbbf24', 
        rgb: '245, 158, 11', secondaryRgb: '217, 119, 6', tertiaryRgb: '251, 191, 36' 
    },
    '#ef4444': { 
        primary: '#ef4444', secondary: '#dc2626', tertiary: '#f87171', 
        rgb: '239, 68, 68', secondaryRgb: '220, 38, 38', tertiaryRgb: '248, 113, 113' 
    },
    '#8b5cf6': { 
        primary: '#8b5cf6', secondary: '#7c3aed', tertiary: '#a78bfa', 
        rgb: '139, 92, 246', secondaryRgb: '124, 58, 237', tertiaryRgb: '167, 139, 250' 
    },
    '#ec4899': { 
        primary: '#ec4899', secondary: '#db2777', tertiary: '#f472b6', 
        rgb: '236, 72, 153', secondaryRgb: '219, 39, 119', tertiaryRgb: '244, 114, 182' 
    },
    '#6366f1': { 
        primary: '#6366f1', secondary: '#4f46e5', tertiary: '#818cf8', 
        rgb: '99, 102, 241', secondaryRgb: '79, 70, 229', tertiaryRgb: '129, 140, 248' 
    },
    '#6b7280': { 
        primary: '#6b7280', secondary: '#4b5563', tertiary: '#9ca3af', 
        rgb: '107, 114, 128', secondaryRgb: '75, 85, 99', tertiaryRgb: '156, 163, 175' 
    },
    '#374151': { 
        primary: '#374151', secondary: '#1f2937', tertiary: '#6b7280', 
        rgb: '55, 65, 81', secondaryRgb: '31, 41, 55', tertiaryRgb: '107, 114, 128' 
    }
};

function initializeAccentColorPicker() {
    const colorOptions = document.querySelectorAll('.color-option');
    const savedColor = localStorage.getItem('accentColor') || '#6b7280';
    
    // Set active color on load
    setActiveColor(savedColor);
    applyAccentColor(savedColor);
    
    // Add click handlers
    colorOptions.forEach(option => {
        option.addEventListener('click', () => {
            const color = option.dataset.color;
            setActiveColor(color);
            applyAccentColor(color);
            localStorage.setItem('accentColor', color);
        });
    });
}

function setActiveColor(color) {
    const colorOptions = document.querySelectorAll('.color-option');
    colorOptions.forEach(option => {
        option.classList.remove('active');
        if (option.dataset.color === color) {
            option.classList.add('active');
        }
    });
}

function applyAccentColor(color) {
    const colorScheme = accentColors[color];
    if (!colorScheme) return;
    
    const root = document.documentElement;
    root.style.setProperty('--accent-primary', colorScheme.primary);
    root.style.setProperty('--accent-secondary', colorScheme.secondary);
    root.style.setProperty('--accent-tertiary', colorScheme.tertiary);
    root.style.setProperty('--accent-primary-rgb', colorScheme.rgb);
    root.style.setProperty('--accent-secondary-rgb', colorScheme.secondaryRgb);
    root.style.setProperty('--accent-tertiary-rgb', colorScheme.tertiaryRgb);
    
    // Update derived colors
    root.style.setProperty('--interactive-focus', `rgba(${colorScheme.rgb}, 0.2)`);
    root.style.setProperty('--border-accent', `rgba(${colorScheme.rgb}, 0.3)`);
}

// Initialize accent color picker when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        initializeAccentColorPicker();
    }, 100);
});

// New functions for persistent overlay functionality
function minimizeSelectionOverlay(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        const content = overlay.querySelector('.selection-response-content');
        const minimizeBtn = overlay.querySelector('.overlay-minimize svg path');
        
        if (content.classList.contains('minimized')) {
            // Expand
            content.classList.remove('minimized');
            if (minimizeBtn) {
                minimizeBtn.setAttribute('d', 'M6 9l6 6 6-6'); // Down arrow
            }
        } else {
            // Minimize
            content.classList.add('minimized');
            if (minimizeBtn) {
                minimizeBtn.setAttribute('d', 'M18 15l-6-6-6 6'); // Up arrow
            }
        }
        saveOverlayState(overlay);
        
        // Auto-save chat when overlay state changes
        if (currentChatId) {
            saveCurrentChat();
        }
    }
}

function closeSelectionOverlay(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        // Remove overlay-specific saved data
        localStorage.removeItem('selectionOverlayPosition_' + overlayId);
        localStorage.removeItem('selectionOverlayState_' + overlayId);
        overlay.remove();
        
        // Auto-save chat when overlay is closed
        if (currentChatId) {
            saveCurrentChat();
        }
    }
}

function initializeOverlayDrag(overlay) {
    const content = overlay.querySelector('.selection-response-content');
    const dragHandle = overlay.querySelector('.overlay-drag-handle');
    if (!content || !dragHandle) return;

    let startX = 0, startY = 0;
    let translateX = 0, translateY = 0;

    // Enable GPU acceleration
    content.style.transform = 'translate3d(0,0,0)';
    content.style.willChange = 'transform';
    
    function onMouseDown(e) {
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp, { once: true });
        e.preventDefault();
    }

    function onMouseMove(e) {
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        requestAnimationFrame(() => {
            content.style.transform = `translate3d(${translateX}px,${translateY}px,0)`;
        });
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        saveOverlayPosition(overlay);
    }

    dragHandle.addEventListener('mousedown', onMouseDown);
}

function saveOverlayPosition(overlay) {
    const content = overlay.querySelector('.selection-response-content');
    if (content) {
        const rect = content.getBoundingClientRect();
        const position = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
        };
        localStorage.setItem('selectionOverlayPosition_' + overlay.id, JSON.stringify(position));
        
        // Auto-save chat when overlay position changes
        if (currentChatId) {
            setTimeout(() => saveCurrentChat(), 100); // Small delay to avoid excessive saves during drag
        }
    }
}

function loadOverlayPosition(overlay) {
    const savedPosition = localStorage.getItem('selectionOverlayPosition_' + overlay.id);
    if (savedPosition) {
        try {
            const position = JSON.parse(savedPosition);
            const content = overlay.querySelector('.selection-response-content');
            if (content) {
                content.style.position = 'fixed';
                
                // Ensure position is within viewport bounds
                const constrainedPosition = constrainToViewport(position.left, position.top, position.width || 320, position.height || 200);
                
                content.style.left = constrainedPosition.left + 'px';
                content.style.top = constrainedPosition.top + 'px';
                if (position.width) content.style.width = position.width + 'px';
                if (position.height) content.style.height = position.height + 'px';
            }
        } catch (e) {
            console.warn('Failed to load overlay position:', e);
        }
    }
}

function constrainToViewport(left, top, width, height) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Ensure overlay doesn't go off the right edge
    if (left + width > viewportWidth) {
        left = viewportWidth - width - 20; // 20px margin
    }
    
    // Ensure overlay doesn't go off the left edge
    if (left < 20) {
        left = 20;
    }
    
    // Ensure overlay doesn't go off the bottom edge
    if (top + height > viewportHeight) {
        top = viewportHeight - height - 20;
    }
    
    // Ensure overlay doesn't go off the top edge
    if (top < 20) {
        top = 20;
    }
    
    return { left, top };
}

function repositionOverlayOnResize() {
    // Find all selection overlays and reposition them
    const overlays = document.querySelectorAll('[id^="selectionResponseOverlay_"]');
    overlays.forEach(overlay => {
        const content = overlay.querySelector('.selection-response-content');
        if (content) {
            const currentLeft = parseInt(content.style.left) || 0;
            const currentTop = parseInt(content.style.top) || 0;
            const currentWidth = parseInt(content.style.width) || content.offsetWidth;
            const currentHeight = parseInt(content.style.height) || content.offsetHeight;
            
            const constrainedPosition = constrainToViewport(currentLeft, currentTop, currentWidth, currentHeight);
            
            content.style.left = constrainedPosition.left + 'px';
            content.style.top = constrainedPosition.top + 'px';
            
            // Save the new position
            saveOverlayPosition(overlay);
        }
    });
}

function collectCurrentOverlays() {
    const overlays = document.querySelectorAll('[id^="selectionResponseOverlay_"]');
    console.log(`Collecting ${overlays.length} current overlays`);
    const overlayData = [];
    
    overlays.forEach(overlay => {
        const content = overlay.querySelector('.selection-response-content');
        const selectedTextDisplay = overlay.querySelector('.selected-text-display');
        const responseArea = overlay.querySelector('.selection-response-area');
        const textarea = overlay.querySelector('textarea');
        
        if (content && selectedTextDisplay) {
            const overlayInfo = {
                id: overlay.id,
                selectedText: selectedTextDisplay.textContent,
                position: {
                    left: parseInt(content.style.left) || 0,
                    top: parseInt(content.style.top) || 0,
                    width: parseInt(content.style.width) || content.offsetWidth,
                    height: parseInt(content.style.height) || content.offsetHeight
                },
                minimized: content.classList.contains('minimized'),
                zIndex: overlay.style.zIndex || '',
                hasResponse: responseArea && responseArea.style.display !== 'none' && responseArea.innerHTML.trim() !== '',
                responseContent: responseArea ? responseArea.innerHTML : '',
                textareaValue: textarea ? textarea.value : ''
            };
            
            console.log(`Collected overlay ${overlayInfo.id} with text: "${overlayInfo.selectedText}"`);
            overlayData.push(overlayInfo);
        }
    });
    
    console.log(`Total collected overlay data:`, overlayData);
    return overlayData;
}

function restoreChatOverlays(overlayData) {
    console.log(`Restoring ${overlayData.length} overlays for this chat:`, overlayData);
    
    // Restore each overlay (overlays should already be cleared by loadChat)
    overlayData.forEach(overlayInfo => {
        console.log(`Restoring overlay: ${overlayInfo.id} with text: "${overlayInfo.selectedText}"`);
        restoreSingleOverlay(overlayInfo);
    });
    
    console.log(`Finished restoring ${overlayData.length} overlays for this chat`);
}

function clearAllOverlays() {
    const existingOverlays = document.querySelectorAll('[id^="selectionResponseOverlay_"]');
    console.log(`Clearing ${existingOverlays.length} overlays`);
    existingOverlays.forEach(overlay => {
        console.log(`Removing overlay: ${overlay.id}`);
        overlay.remove();
    });
    
    // Reset overlay counter when clearing all overlays
    overlayCounter = 0;
    console.log('Reset overlay counter to 0');
}

function restoreSingleOverlay(overlayInfo) {
    // Extract the counter from the ID (e.g., "selectionResponseOverlay_3" -> 3)
    const idParts = overlayInfo.id.split('_');
    const originalCounter = parseInt(idParts[1]) || 1;
    
    // Update the global counter to avoid conflicts
    overlayCounter = Math.max(overlayCounter, originalCounter);
    
    // Create overlay with the original ID
    const overlay = document.createElement('div');
    overlay.id = overlayInfo.id;
    overlay.className = 'selection-response-overlay persistent-overlay';
    overlay.style.zIndex = overlayInfo.zIndex || (1005 + originalCounter);
    
    const textareaId = 'additionalContext_' + originalCounter;
    
    overlay.innerHTML = `
        <div class="selection-response-content" data-selected-text="${overlayInfo.selectedText.replace(/"/g, '&quot;')}">
            <div class="overlay-header">
                <div class="overlay-drag-handle" title="Drag to move">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 12h18M3 6h18M3 18h18"/>
                    </svg>
                    <span>ChatGPT Assistant #${originalCounter}</span>
                </div>
                <div class="overlay-controls">
                    <button class="overlay-minimize" onclick="minimizeSelectionOverlay('${overlayInfo.id}')" title="Minimize">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M6 9l6 6 6-6"/>
                        </svg>
                    </button>
                    <button class="overlay-close" onclick="closeSelectionOverlay('${overlayInfo.id}')" title="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="bubble-content">
                <div class="selection-query-section" style="${overlayInfo.hasResponse ? 'display: none;' : ''}">
                    <div class="selected-text-display">${overlayInfo.selectedText}</div>
                    <div class="quick-input">
                        <textarea 
                            id="${textareaId}" 
                            placeholder="Ask about this..."
                            rows="1"
                        >${overlayInfo.textareaValue || ''}</textarea>
                        <button class="quick-send" onclick="sendSelectionQuery('${overlayInfo.id}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="selection-response-area" style="${overlayInfo.hasResponse ? 'display: block;' : 'display: none;'}">
                    ${overlayInfo.responseContent || ''}
                </div>
            </div>
        </div>
    `;
    
    // Add to DOM
    document.body.appendChild(overlay);
    
    // Apply saved position and state
    const content = overlay.querySelector('.selection-response-content');
    if (content && overlayInfo.position) {
        content.style.position = 'fixed';
        content.style.left = overlayInfo.position.left + 'px';
        content.style.top = overlayInfo.position.top + 'px';
        if (overlayInfo.position.width) content.style.width = overlayInfo.position.width + 'px';
        if (overlayInfo.position.height) content.style.height = overlayInfo.position.height + 'px';
        
        // Apply minimized state
        if (overlayInfo.minimized) {
            content.classList.add('minimized');
            const minimizeBtn = overlay.querySelector('.overlay-minimize svg path');
            if (minimizeBtn) {
                minimizeBtn.setAttribute('d', 'M18 15l-6-6-6 6'); // Up arrow
            }
        }
    }
    
    // Initialize drag and resize functionality
    initializeOverlayDrag(overlay);
    setupOverlayResize(overlay);
    
    // Show overlay with animation
    setTimeout(() => {
        overlay.classList.add('show');
    }, 10);
}

function saveOverlayState(overlay) {
    const content = overlay.querySelector('.selection-response-content');
    if (content) {
        const selectedTextDisplay = overlay.querySelector('.selected-text-display');
        const responseContent = overlay.querySelector('.response-content');
        
        const state = {
            minimized: content.classList.contains('minimized'),
            selectedText: selectedTextDisplay ? selectedTextDisplay.textContent : '',
            responseText: responseContent ? responseContent.innerHTML : '',
            hasResponse: responseContent ? responseContent.innerHTML.trim() !== '' : false
        };
        localStorage.setItem('selectionOverlayState_' + overlay.id, JSON.stringify(state));
    }
}

function restoreOverlayState(overlay) {
    const savedState = localStorage.getItem('selectionOverlayState_' + overlay.id);
    if (savedState) {
        try {
            const state = JSON.parse(savedState);
            const content = overlay.querySelector('.selection-response-content');
            
            // Restore minimized state
            if (content && state.minimized) {
                content.classList.add('minimized');
                const minimizeBtn = overlay.querySelector('.overlay-minimize svg path');
                if (minimizeBtn) {
                    minimizeBtn.setAttribute('d', 'M18 15l-6-6-6 6'); // Up arrow
                }
            }
            
            // Restore response content if it exists
            if (state.hasResponse && state.responseText) {
                const responseArea = overlay.querySelector('.selection-response-area');
                const responseContent = overlay.querySelector('.response-content');
                if (responseArea && responseContent) {
                    responseContent.innerHTML = state.responseText;
                    responseArea.style.display = 'block';
                }
            }
        } catch (e) {
            console.warn('Failed to restore overlay state:', e);
        }
    }
}


