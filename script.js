// ChatGPT App Configuration
// The API key and settings are loaded from config.js
const API_URL = 'https://api.openai.com/v1/chat/completions';
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const BILLING_URL = 'https://api.openai.com/v1/dashboard/billing/usage';
const SUBSCRIPTION_URL = 'https://api.openai.com/v1/dashboard/billing/subscription';

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

// Credit balance tracking
let creditBalance = {
    total: 0,
    used: 0,
    remaining: 0,
    lastUpdated: null
};

// Token usage tracking
let currentChatTokens = {
    total: 0,
    prompt: 0,
    completion: 0,
    requests: 0
};

// Global token usage across all chats
let globalTokens = {
    total: 0,
    chats: 0
};

// Voice recording variables - Using MediaRecorder for GPT-4o-transcribe
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// Load chat history from Firebase or localStorage
async function loadChatHistory() {
    try {
        // Always load from localStorage first as a fallback
        const saved = localStorage.getItem('chatgpt_history');
        if (saved) {
            chatHistory = JSON.parse(saved);
            console.log('Loaded chat history from localStorage');
        }
        
        // Wait for authentication to complete on mobile devices
        let authRetries = 0;
        while ((!window.chatStorage || !window.chatStorage.getCurrentUser()) && authRetries < 10) {
            await new Promise(resolve => setTimeout(resolve, 500));
            authRetries++;
        }
        
        // Then try to load from Firebase if user is authenticated
        if (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) {
            console.log('User authenticated, attempting to sync with Firebase...');
            const result = await window.chatStorage.getUserChats();
            if (result.success && result.chats && result.chats.length > 0) {
                // Merge Firebase data with localStorage, keeping the most recent
                const mergedChats = mergeChats(chatHistory, result.chats);
                chatHistory = mergedChats;
                console.log(`Synced ${result.chats.length} chats from Firebase`);
                
                // Update localStorage with merged data
                localStorage.setItem('chatgpt_history', JSON.stringify(chatHistory));
            } else if (result.error && result.error !== 'User not authenticated') {
                console.warn('Firebase sync error:', result.error);
                if (result.fallback) {
                    console.log('🔄 Using localStorage fallback due to API issues');
                    // Continue with localStorage data - app still works offline
                }
            }
        } else {
            console.log('User not authenticated, using localStorage only');
        }
        
        // Calculate global tokens from existing chats if not already loaded
        if (globalTokens.total === 0) {
            globalTokens.total = chatHistory.reduce((total, chat) => {
                return total + (chat.tokens ? chat.tokens.total : 0);
            }, 0);
            globalTokens.chats = chatHistory.length;
            saveGlobalTokens();
        }
    } catch (e) {
        console.error('Error loading chat history:', e);
        // Fallback to localStorage on error
        const saved = localStorage.getItem('chatgpt_history');
        if (saved) {
            try {
                chatHistory = JSON.parse(saved);
            } catch (parseError) {
                console.error('Error parsing localStorage data:', parseError);
                chatHistory = [];
            }
        } else {
            chatHistory = [];
        }
    }
    loadChatFolders();
    updateHistoryDisplay();
}

// Merge chats from different sources, keeping the most recent version
function mergeChats(localChats, remoteChats) {
    const merged = {};
    
    // Add all local chats
    localChats.forEach(chat => {
        if (chat.id) {
            merged[chat.id] = chat;
        }
    });
    
    // Add/update with remote chats (Firebase data takes precedence if newer)
    remoteChats.forEach(remoteChat => {
        if (remoteChat.id) {
            const localChat = merged[remoteChat.id];
            if (!localChat || (remoteChat.lastUpdated && localChat.lastUpdated && remoteChat.lastUpdated > localChat.lastUpdated)) {
                merged[remoteChat.id] = remoteChat;
            }
        }
    });
    
    return Object.values(merged).sort((a, b) => {
        const aTime = a.lastUpdated || a.timestamp || 0;
        const bTime = b.lastUpdated || b.timestamp || 0;
        return bTime - aTime;
    });
}

// Load chat folders from localStorage
function loadChatFolders() {
    const saved = localStorage.getItem('chatgpt_folders');
    if (saved) {
        try {
            chatFolders = JSON.parse(saved);
        } catch (e) {
            console.error('Error loading chat folders:', e);
            chatFolders = [];
        }
    }
}

// Save chat folders to localStorage
function saveChatFolders() {
    try {
        localStorage.setItem('chatgpt_folders', JSON.stringify(chatFolders));
    } catch (e) {
        console.error('Error saving chat folders:', e);
    }
}

// Create a new folder
function createFolder() {
    const folderName = prompt('Enter folder name:');
    if (folderName && folderName.trim()) {
        const newFolder = {
            id: 'folder_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            name: folderName.trim(),
            chats: [],
            expanded: true,
            createdAt: Date.now()
        };
        chatFolders.push(newFolder);
        saveChatFolders();
        updateHistoryDisplay();
    }
}

// Delete a folder (async implementation)
async function deleteFolderAsync(folderId) {
    const folder = chatFolders.find(f => f.id === folderId);
    if (!folder) return;
    
    const confirmMessage = folder.chats.length > 0 
        ? `Delete folder "${folder.name}" and its ${folder.chats.length} chat(s)? This cannot be undone.`
        : `Delete folder "${folder.name}"?`;
    
    if (confirm(confirmMessage)) {
        // Remove all chats from this folder from main chatHistory
        folder.chats.forEach(chatId => {
            chatHistory = chatHistory.filter(chat => chat.id !== chatId);
        });
        
        // Remove the folder
        chatFolders = chatFolders.filter(f => f.id !== folderId);
        
        // Update global token count
        globalTokens.chats = chatHistory.length;
        
        debouncedSave();
        saveChatFolders();
        saveGlobalTokens();
        updateHistoryDisplay();
        updateGlobalTokenDisplay();
        
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

function saveFolderName() {
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
            saveChatFolders();
            updateHistoryDisplay();
        }
    }
    
    closeRenameFolderModal();
}

// Toggle folder expanded/collapsed state
function toggleFolder(folderId) {
    const folder = chatFolders.find(f => f.id === folderId);
    if (folder) {
        folder.expanded = !folder.expanded;
        saveChatFolders();
        updateHistoryDisplay();
    }
}

// Move chat to folder
function moveChatToFolder(chatId, targetFolderId) {
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
    
    saveChatFolders();
    updateHistoryDisplay();
}

// Start new chat in specific folder
function startNewChatInFolder(folderId) {
    currentFolderId = folderId;
    startNewChat(true); // Pass true to preserve folder context
}

// Save chat history to localStorage
let savingInProgress = false;
let saveTimeout = null;

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
        console.log('🔄 Syncing chats with Firebase...');
        await saveChatHistory(); // This will sync all local changes
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
        
        // Save to localStorage immediately
        localStorage.setItem('chatgpt_history', JSON.stringify(chatHistory));
        console.log('Saved chat history to localStorage');
        
        // If user is authenticated and Firebase is available, also save to cloud
        if (typeof window.chatStorage !== 'undefined' && window.chatStorage && window.chatStorage.getCurrentUser()) {
            console.log(`Attempting to save ${chatHistory.length} chats to Firebase...`);
            
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
            
            console.log(`Successfully saved ${successCount}/${chatHistory.length} chats to Firebase`);
            
            // Check for any failures and log them
            const failures = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));
            if (failures.length > 0) {
                console.warn(`${failures.length} chats failed to save to Firebase - they remain in localStorage`);
            }
        } else {
            console.log('User not authenticated or Firebase not available, only saved to localStorage');
        }
    } catch (e) {
        console.error('Error saving chat history:', e);
        // Ensure localStorage is still updated even if Firebase fails
        try {
            localStorage.setItem('chatgpt_history', JSON.stringify(chatHistory));
        } catch (localError) {
            console.error('Critical: Failed to save to localStorage:', localError);
        }
    } finally {
        savingInProgress = false;
    }
}

// Update token usage display
function updateTokenDisplay() {
    const tokenElement = document.getElementById('tokenUsage');
    if (tokenElement) {
        tokenElement.innerHTML = `
            <div class="token-info">
                <span class="token-total">${currentChatTokens.total} tokens</span>
                <span class="token-details">${currentChatTokens.prompt}+${currentChatTokens.completion} • ${currentChatTokens.requests} requests</span>
            </div>
        `;
    }
}

// Load global token usage from localStorage
function loadGlobalTokens() {
    const saved = localStorage.getItem('chatgpt_global_tokens');
    if (saved) {
        try {
            globalTokens = JSON.parse(saved);
        } catch (e) {
            console.error('Error loading global tokens:', e);
            globalTokens = { total: 0, chats: 0 };
        }
    }
    updateGlobalTokenDisplay();
}

// Save global token usage to localStorage
function saveGlobalTokens() {
    try {
        localStorage.setItem('chatgpt_global_tokens', JSON.stringify(globalTokens));
    } catch (e) {
        console.error('Error saving global tokens:', e);
    }
}

// Update global token usage display
function updateGlobalTokenDisplay() {
    const globalElement = document.getElementById('globalTokens');
    const globalSidebarElement = document.getElementById('globalTokensSidebar');
    
    const tokenContent = `
        <div class="global-token-total">${globalTokens.total.toLocaleString()} tokens</div>
        <div class="global-token-subtitle">${globalTokens.chats} chats total</div>
    `;
    
    // Show credit balance based on available data
    let creditContent = '';
    if (creditBalance.remaining > 0) {
        const source = creditBalance.automatic ? ' (auto)' : creditBalance.manual ? ' (manual)' : '';
        const lastUpdated = creditBalance.lastUpdated ? new Date(creditBalance.lastUpdated).toLocaleTimeString() : '';
        const tooltip = creditBalance.manual 
            ? 'Manual balance - click to update' 
            : `Auto-fetched balance at ${lastUpdated} - click for manual entry`;
        
        creditContent = `<div class="credit-balance" onclick="setCreditBalance()" style="cursor: pointer;" title="${tooltip}">$${creditBalance.remaining.toFixed(2)} remaining${source}</div>`;
    } else if (creditBalance.usageOnly && creditBalance.used > 0) {
        creditContent = `<div class="credit-balance" onclick="setCreditBalance()" style="cursor: pointer; color: #f59e0b;" title="Usage data only - click to set balance">$${creditBalance.used.toFixed(2)} used (set balance)</div>`;
    } else if (creditBalance.lastUpdated === null && !globalTokens.total) {
        // Still loading on first run - only show in sidebar, not in mobile header
        creditContent = `<div class="credit-balance" style="color: #f59e0b;">Checking balance... ⏳</div>`;
    } else {
        // Show manual entry option with helpful message
        creditContent = `<div class="credit-balance" onclick="setCreditBalance()" style="cursor: pointer; color: #10b981;" title="Click to set your credit balance manually">Click to set balance 💰</div>`;
    }
    
    // For the main header (mobile), hide token/credit display - available in settings
    if (globalElement) {
        globalElement.innerHTML = '';
    }
    
    // For sidebar, keep the original order with both tokens and credits
    if (globalSidebarElement) {
        globalSidebarElement.innerHTML = tokenContent + creditContent;
    }
}

// Manual credit balance setting
function setCreditBalance() {
    closeSettingsModal(); // Close the settings modal first
    
    // Show the credit balance modal
    const modal = document.getElementById('creditBalanceModal');
    const input = document.getElementById('creditBalanceInput');
    
    if (modal && input) {
        // Pre-fill current balance if available
        const currentBalance = creditBalance.remaining > 0 ? creditBalance.remaining.toFixed(2) : '';
        input.value = currentBalance;
        modal.style.display = 'flex';
        input.focus();
        document.body.style.overflow = 'hidden';
    }
}

function closeCreditBalanceModal() {
    const modal = document.getElementById('creditBalanceModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

function saveCreditBalance() {
    const input = document.getElementById('creditBalanceInput');
    const newBalance = input.value.trim();
    
    if (newBalance !== '' && newBalance !== null) {
        const balanceNumber = parseFloat(newBalance);
        if (!isNaN(balanceNumber) && balanceNumber >= 0) {
            creditBalance = {
                total: balanceNumber,
                used: 0,
                remaining: balanceNumber,
                lastUpdated: new Date().toISOString(),
                manual: true,
                initialBalance: balanceNumber // Track starting balance
            };
            
            // Save to localStorage
            localStorage.setItem('chatgpt_credit_balance', JSON.stringify(creditBalance));
            
            // Update display
            updateGlobalTokenDisplay();
            
            closeCreditBalanceModal();
            console.log('✅ Manual credit balance set to:', `$${balanceNumber.toFixed(2)}`);
            console.log('💾 Balance saved to localStorage');
            alert(`✅ Credit balance set to $${balanceNumber.toFixed(2)}`);
        } else {
            alert('❌ Please enter a valid positive number (e.g., 15.50)');
        }
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

// Estimate and deduct API costs from credit balance
function updateCreditBalanceWithUsage(inputTokens, outputTokens, model) {
    if (!creditBalance.manual || creditBalance.remaining <= 0) {
        return; // Only update if manually set balance exists
    }
    
    // Current pricing per 1M tokens (July 2025 - from OpenAI API pricing page)
    const pricingPer1M = {
        'gpt-4.1-2025-04-14': {
            input: 2.00,    // $2.00 per 1M input tokens
            output: 8.00    // $8.00 per 1M output tokens
        },
        'gpt-image-1': {
            input: 0.04,    // $0.04 per image (estimated for image generation)
            output: 0.00    // No output tokens for image generation
        },
        'chatgpt-4o-latest': {
            input: 5.00,    // $5.00 per 1M input tokens
            output: 15.00   // $15.00 per 1M output tokens
        },
        'gpt-4o-search-preview-2025-03-11': {
            input: 5.00,    // $5.00 per 1M input tokens (estimated, same as 4o)
            output: 15.00   // $15.00 per 1M output tokens (estimated, same as 4o)
        }
    };
    
    const pricing = pricingPer1M[model] || pricingPer1M['chatgpt-4o-latest'];
    
    // Calculate separate costs for input and output tokens
    const inputCost = (inputTokens / 1000000) * pricing.input;
    const outputCost = (outputTokens / 1000000) * pricing.output;
    const totalCost = inputCost + outputCost;
    
    // Deduct from remaining balance
    creditBalance.remaining = Math.max(0, creditBalance.remaining - totalCost);
    creditBalance.used += totalCost;
    creditBalance.lastUpdated = new Date().toISOString();
    
    // Save updated balance
    localStorage.setItem('chatgpt_credit_balance', JSON.stringify(creditBalance));
    
    // Update display
    updateGlobalTokenDisplay();
    
    console.log(`Estimated cost: $${totalCost.toFixed(6)} (Input: $${inputCost.toFixed(6)}, Output: $${outputCost.toFixed(6)}) for ${inputTokens + outputTokens} tokens (${model})`);
}

// Fetch OpenAI account credit balance
async function fetchCreditBalance() {
    try {
        const apiKey = getApiKey();
        
        if (apiKey === 'YOUR_API_KEY' || apiKey === 'your-api-key-here' || !apiKey) {
            console.log('❌ No valid API key found for credit balance');
            return false;
        }
        
        console.log('🔍 Attempting to fetch credit balance from OpenAI...');
        console.log('ℹ️  Note: OpenAI billing endpoints may not be accessible from browser due to CORS restrictions');
        
        // Show user-friendly message about attempting auto-fetch
        const globalElement = document.getElementById('globalTokens');
        if (globalElement) {
            const currentContent = globalElement.innerHTML;
            globalElement.innerHTML = `
                <div class="credit-balance" style="color: #f59e0b;">Checking balance... ⏳</div>
                ${currentContent.includes('tokens') ? currentContent.match(/<div class="global-token.*?<\/div>/s)?.[0] || '' : ''}
            `;
        }
        
        // Try multiple endpoints that might work with your API key
        const endpoints = [
            'https://api.openai.com/v1/dashboard/billing/subscription',
            'https://api.openai.com/v1/dashboard/billing/credit_grants', 
            'https://api.openai.com/v1/dashboard/billing/usage'
        ];
        
        for (const endpoint of endpoints) {
            try {
                console.log(`🔄 Trying endpoint: ${endpoint}`);
                
                const response = await fetch(endpoint, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                console.log(`📊 Response status for ${endpoint}:`, response.status);
                
                if (response.ok) {
                    const data = await response.json();
                    console.log(`📋 Data from ${endpoint}:`, data);
                    
                    // Handle subscription endpoint
                    if (endpoint.includes('subscription') && data.hard_limit_usd !== undefined) {
                        const remaining = data.hard_limit_usd;
                        creditBalance = {
                            total: data.system_hard_limit_usd || remaining,
                            used: (data.system_hard_limit_usd || remaining) - remaining,
                            remaining: remaining,
                            lastUpdated: new Date().toISOString(),
                            automatic: true
                        };
                        
                        console.log('✅ Successfully fetched balance from subscription endpoint:', creditBalance);
                        localStorage.setItem('chatgpt_credit_balance', JSON.stringify(creditBalance));
                        updateGlobalTokenDisplay();
                        return true;
                    }
                    
                    // Handle credit grants endpoint
                    if (endpoint.includes('credit_grants') && data.data && data.data.length > 0) {
                        const grant = data.data[0];
                        creditBalance = {
                            total: grant.grant_amount || 0,
                            used: grant.used_amount || 0,
                            remaining: (grant.grant_amount || 0) - (grant.used_amount || 0),
                            lastUpdated: new Date().toISOString(),
                            automatic: true
                        };
                        
                        console.log('✅ Successfully fetched balance from credit grants endpoint:', creditBalance);
                        localStorage.setItem('chatgpt_credit_balance', JSON.stringify(creditBalance));
                        updateGlobalTokenDisplay();
                        return true;
                    }
                    
                    // Handle usage endpoint (shows spending but not remaining balance)
                    if (endpoint.includes('usage') && data.total_usage !== undefined) {
                        creditBalance = {
                            total: 0,
                            used: data.total_usage / 100, // Convert cents to dollars
                            remaining: 0,
                            lastUpdated: new Date().toISOString(),
                            usageOnly: true,
                            automatic: true
                        };
                        
                        console.log('✅ Got usage data (no balance info available):', creditBalance);
                        localStorage.setItem('chatgpt_credit_balance', JSON.stringify(creditBalance));
                        updateGlobalTokenDisplay();
                        return true;
                    }
                } else {
                    const errorText = await response.text();
                    console.log(`❌ Error from ${endpoint}:`, response.status, errorText);
                    
                    // Special handling for common errors
                    if (response.status === 403 || response.status === 401) {
                        console.log('🔒 API key lacks permission for billing endpoints (this is normal for most API keys)');
                    } else if (response.status === 404) {
                        console.log('🔍 Billing endpoint not found or deprecated');
                    }
                }
            } catch (endpointError) {
                console.log(`❌ Network error for ${endpoint}:`, endpointError.message);
                
                // Check for CORS errors
                if (endpointError.message.includes('CORS') || endpointError.message.includes('fetch')) {
                    console.log('🚫 CORS restriction detected - billing endpoints not accessible from browser');
                }
            }
        }
        
        console.log('⚠️  Automatic balance fetch failed - this is normal for browser-based apps');
        console.log('💡 Reason: OpenAI billing endpoints require server-side access or special permissions');
        console.log('✋ Please use manual balance entry by clicking the balance display');
        return false;
        
    } catch (error) {
        console.warn('❌ Error fetching credit balance:', error);
        return false;
    }
}

// Load credit balance - try automatic first, then manual
async function loadCreditBalance() {
    console.log('🚀 Initializing credit balance system...');
    
    const saved = localStorage.getItem('chatgpt_credit_balance');
    if (saved) {
        try {
            const savedBalance = JSON.parse(saved);
            console.log('💾 Found saved balance data:', savedBalance);
            
            // If we have automatic data that's less than 1 hour old, use it
            if (savedBalance.automatic && savedBalance.lastUpdated) {
                const lastUpdated = new Date(savedBalance.lastUpdated);
                const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                
                if (lastUpdated > oneHourAgo) {
                    creditBalance = savedBalance;
                    updateGlobalTokenDisplay();
                    console.log('✅ Using cached automatic balance data (less than 1 hour old)');
                    return;
                } else {
                    console.log('⏰ Cached automatic data is older than 1 hour, will try to refresh');
                }
            } else if (savedBalance.manual) {
                // Keep manual data permanently
                creditBalance = savedBalance;
                updateGlobalTokenDisplay();
                console.log('✅ Using manual balance data');
                
                // Still try to fetch automatic data in background for comparison
                console.log('🔄 Attempting background automatic fetch for comparison...');
                setTimeout(() => fetchCreditBalance(), 1000);
                return;
            }
        } catch (e) {
            console.error('❌ Error loading saved credit balance:', e);
        }
    } else {
        console.log('📭 No saved balance data found');
    }
    
    // Show fetching state
    updateGlobalTokenDisplay();
    
    // Try to fetch automatically
    console.log('🔍 Attempting automatic balance fetch...');
    const success = await fetchCreditBalance();
    
    if (!success) {
        console.log('ℹ️  Automatic fetch failed (this is expected for browser-based apps)');
        console.log('💡 OpenAI billing endpoints are typically restricted for security reasons');
        console.log('✋ Manual balance entry is the recommended approach');
        
        // Reset to show manual entry option
        creditBalance = { total: 0, used: 0, remaining: 0, lastUpdated: null };
        updateGlobalTokenDisplay();
        
        // Show helpful message to user
        setTimeout(() => {
            const globalElement = document.getElementById('globalTokens');
            if (globalElement && !creditBalance.manual) {
                console.log('💬 Showing user guidance for manual balance entry');
            }
        }, 2000);
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
                model: 'chatgpt-4o-latest',
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
    deleteFolderAsync(folderId).catch(error => {
        console.error('Error deleting folder:', error);
    });
}

// Save current chat
async function saveCurrentChat() {
    if (conversationHistory.length === 0) return;
    
    const chatData = {
        id: currentChatId || generateChatId(),
        title: getChatTitle(conversationHistory),
        messages: [...conversationHistory],
        model: currentModel,
        tokens: { ...currentChatTokens },
        timestamp: Date.now(),
        date: new Date().toLocaleDateString()
    };
    
    // Find existing chat or add new one
    const existingIndex = chatHistory.findIndex(chat => chat.id === chatData.id);
    if (existingIndex !== -1) {
        chatHistory[existingIndex] = chatData;
    } else {
        chatHistory.unshift(chatData); // Add to beginning
        currentChatId = chatData.id;
        
        // Update URL for new chat
        updateChatUrl(currentChatId);
        
        // If starting in a folder, add chat to that folder
        if (currentFolderId) {
            const folder = chatFolders.find(f => f.id === currentFolderId);
            if (folder && !folder.chats.includes(chatData.id)) {
                folder.chats.unshift(chatData.id);
                saveChatFolders();
            }
        }
        
        // Update global chat count for new chats
        globalTokens.chats = chatHistory.length;
        saveGlobalTokens();
        updateGlobalTokenDisplay();
    }
    
    // Keep only last 50 chats
    if (chatHistory.length > 50) {
        chatHistory = chatHistory.slice(0, 50);
    }
    
    debouncedSave();
    updateHistoryDisplay();
}

// Load a chat from history
function loadChat(chatId) {
    const chat = chatHistory.find(c => c.id === chatId);
    if (!chat) return;
    
    currentChatId = chatId;
    conversationHistory = [...chat.messages];
    
    // Update URL when loading a chat
    updateChatUrl(currentChatId);
    currentModel = chat.model || 'chatgpt-4o-latest';
    
    // Determine which folder this chat belongs to
    currentFolderId = null;
    for (const folder of chatFolders) {
        if (folder.chats.includes(chatId)) {
            currentFolderId = folder.id;
            break;
        }
    }
    
    // Restore token usage data if available
    if (chat.tokens) {
        currentChatTokens = { ...chat.tokens };
    } else {
        currentChatTokens = {
            total: 0,
            prompt: 0,
            completion: 0,
            requests: 0
        };
    }
    updateTokenDisplay();
    
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
    
    // Update active state in history
    updateHistoryDisplay();
}

// Delete a chat from history (async implementation)
async function deleteChatAsync(chatId) {
    const chatToDelete = chatHistory.find(chat => chat.id === chatId);
    
    // DON'T subtract tokens - they were already consumed and billed
    // Token usage represents actual API consumption, not current chat tokens
    
    chatHistory = chatHistory.filter(chat => chat.id !== chatId);
    globalTokens.chats = chatHistory.length;
    
    debouncedSave();
    saveGlobalTokens();
    updateHistoryDisplay();
    updateGlobalTokenDisplay();
    
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
    if (confirm('Are you sure you want to delete all chat history? This cannot be undone.\n\nNote: Token usage will remain unchanged as tokens were already consumed.')) {
        chatHistory = [];
        // DON'T reset global tokens - they represent actual API usage that was already billed
        // Only reset the chat count
        globalTokens.chats = 0;
        debouncedSave();
        saveGlobalTokens();
        updateHistoryDisplay();
        updateGlobalTokenDisplay();
        startNewChat();
    }
}

// Start a new chat
function startNewChat(preserveFolder = false) {
    currentChatId = null;
    if (!preserveFolder) {
        currentFolderId = null; // Reset folder when starting new chat normally
    }
    clearChat();
    // Reset token counters for new chat
    currentChatTokens = {
        total: 0,
        prompt: 0,
        completion: 0,
        requests: 0
    };
    updateTokenDisplay();
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

    const chats = Object.values(chatHistory).sort((a, b) => b.timestamp - a.timestamp);
    
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
function promptForApiKey() {
    const savedKey = localStorage.getItem('chatgpt_api_key');
    
    if (savedKey && savedKey !== 'prompt-for-key') {
        sessionApiKey = savedKey;
        console.log('✅ Using saved API key from previous session');
        return true;
    }
    
    // No API key found - user can set it in settings
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

function saveApiKey() {
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
    
    // Fallback to config (though it should be 'prompt-for-key')
    const configKey = window.CONFIG?.apiKey;
    if (configKey && configKey !== 'prompt-for-key' && configKey !== 'YOUR_API_KEY') {
        return configKey;
    }
    
    return 'YOUR_API_KEY';
}

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
        'chatgpt-4o-latest': 'Message ChatGPT-4o...',
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
        'chatgpt-4o-latest': 'How can I assist you today?'
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
                            <select id="qualitySetting" class="setting-select" onchange="updatePricingDisplay()">
                                <option value="auto">Auto (Recommended)</option>
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                            </select>
                        </div>
                        
                        <div class="setting-group">
                            <label for="sizeSetting">Size:</label>
                            <select id="sizeSetting" class="setting-select" onchange="updatePricingDisplay()">
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
                    
                    <div class="pricing-section">
                        <h4>💰 Pricing Information</h4>
                        <div class="pricing-grid" id="pricingGrid">
                            <!-- Pricing will be populated dynamically -->
                        </div>
                        <div class="current-price">
                            <div class="price-label">Current Selection:</div>
                            <div class="price-value" id="currentPrice">$0.042 per image</div>
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

// Image pricing data based on quality and size
const imagePricing = {
    'low': {
        '1024x1024': 0.011,
        '1024x1536': 0.016,
        '1536x1024': 0.016
    },
    'medium': {
        '1024x1024': 0.042,
        '1024x1536': 0.063,
        '1536x1024': 0.063
    },
    'high': {
        '1024x1024': 0.167,
        '1024x1536': 0.25,
        '1536x1024': 0.25
    }
};

// Update pricing display based on current selections
function updatePricingDisplay() {
    const quality = document.getElementById('qualitySetting').value;
    const size = document.getElementById('sizeSetting').value;
    const pricingGrid = document.getElementById('pricingGrid');
    const currentPriceElement = document.getElementById('currentPrice');
    
    if (!pricingGrid || !currentPriceElement) return;
    
    // Generate pricing grid
    let gridHTML = '';
    const qualities = ['low', 'medium', 'high'];
    const sizes = ['1024x1024', '1024x1536', '1536x1024'];
    const sizeLabels = {
        '1024x1024': 'Square',
        '1024x1536': 'Portrait', 
        '1536x1024': 'Landscape'
    };
    
    qualities.forEach(q => {
        gridHTML += `<div class="pricing-quality-section">`;
        gridHTML += `<div class="pricing-quality-header">${q.charAt(0).toUpperCase() + q.slice(1)} Quality</div>`;
        gridHTML += `<div class="pricing-row">`;
        
        sizes.forEach(s => {
            const price = imagePricing[q][s];
            const isSelected = (quality === q || quality === 'auto') && (size === s || size === 'auto');
            gridHTML += `
                <div class="pricing-item ${isSelected ? 'selected' : ''}">
                    <div class="pricing-size">${sizeLabels[s]}</div>
                    <div class="pricing-dimensions">${s}</div>
                    <div class="pricing-cost">$${price.toFixed(3)}</div>
                </div>
            `;
        });
        
        gridHTML += `</div></div>`;
    });
    
    pricingGrid.innerHTML = gridHTML;
    
    // Update current price
    let currentPrice = 0.042; // Default medium quality
    if (quality !== 'auto' && size !== 'auto' && imagePricing[quality] && imagePricing[quality][size]) {
        currentPrice = imagePricing[quality][size];
    } else if (quality !== 'auto' && imagePricing[quality]) {
        // Use default size (1024x1024) for the quality
        currentPrice = imagePricing[quality]['1024x1024'];
    } else if (size !== 'auto') {
        // Use medium quality for the size
        currentPrice = imagePricing['medium'][size] || 0.042;
    }
    
    currentPriceElement.textContent = `$${currentPrice.toFixed(3)} per image`;
}

// Update image settings modal with current values
function updateImageSettingsModal() {
    document.getElementById('qualitySetting').value = imageSettings.quality;
    document.getElementById('sizeSetting').value = imageSettings.size;
    document.getElementById('backgroundSetting').value = imageSettings.background;
    document.getElementById('formatSetting').value = imageSettings.outputFormat;
    
    // Update pricing display
    setTimeout(() => updatePricingDisplay(), 100);
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
        'chatgpt-4o-latest': 'ChatGPT-4o Latest',
        'gpt-4o-search-preview-2025-03-11': 'GPT-4o Search Preview'
    };
    return names[model] || model;
}

function getModelTemperature(model) {
    const temperatures = {
        'gpt-4.1-2025-04-14': 0.7,
        'gpt-image-1': 0.7,
        'chatgpt-4o-latest': 1.0,
        'gpt-4o-search-preview-2025-03-11': 0.7
    };
    return temperatures[model] || 0.7; // Default fallback
}

// Available models for cycling
const availableModels = ['gpt-4.1-2025-04-14', 'gpt-image-1', 'chatgpt-4o-latest', 'gpt-4o-search-preview-2025-03-11'];

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
        const modals = ['settingsModal', 'apiKeyModal', 'tokenUsageModal', 'creditBalanceModal', 'confirmationModal', 'renameFolderModal', 'moveChatModal'];
        
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
                    case 'tokenUsageModal':
                        closeTokenUsageModal();
                        break;
                    case 'creditBalanceModal':
                        closeCreditBalanceModal();
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

function showTokenUsageInfo() {
    closeSettingsModal(); // Close the settings modal first
    
    // Update token display values
    document.getElementById('currentChatTotal').textContent = currentChatTokens.total.toLocaleString();
    document.getElementById('currentChatInput').textContent = currentChatTokens.prompt.toLocaleString();
    document.getElementById('currentChatOutput').textContent = currentChatTokens.completion.toLocaleString();
    document.getElementById('currentChatRequests').textContent = currentChatTokens.requests;
    document.getElementById('globalTokenTotal').textContent = globalTokens.total.toLocaleString();
    document.getElementById('globalChatCount').textContent = globalTokens.chats;
    
    // Show the token usage modal
    const modal = document.getElementById('tokenUsageModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
}

function closeTokenUsageModal() {
    const modal = document.getElementById('tokenUsageModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

async function sendMessageAsync() {
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
    if (selectedImages.length > 0 && !currentModel.includes('gpt-4') && !currentModel.includes('gpt-image-1') && !currentModel.includes('chatgpt-4o-latest') && !currentModel.includes('gpt-4o-search-preview')) {
        addMessage('⚠️ Image analysis requires vision-capable models. Please switch to GPT-4.1-2025-04-14, gpt-image-1, chatgpt-4o-latest, or gpt-4o-search-preview-2025-03-11.', 'ai', 'error');
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

                    // Track token usage for audio transcription responses
                    if (data.usage) {
                        const newTokens = data.usage.total_tokens || 0;
                        const inputTokens = data.usage.prompt_tokens || 0;
                        const outputTokens = data.usage.completion_tokens || 0;
                        currentChatTokens.prompt += inputTokens;
                        currentChatTokens.completion += outputTokens;
                        currentChatTokens.total += newTokens;
                        currentChatTokens.requests += 1;
                        
                        // Update global token count
                        globalTokens.total += newTokens;
                        saveGlobalTokens();
                        
                        // Update credit balance with estimated cost
                        updateCreditBalanceWithUsage(inputTokens, outputTokens, currentModel);
                        
                        updateTokenDisplay();
                        updateGlobalTokenDisplay();
                    }

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


    // Add user message to conversation history for all models
    const userMessage = {
        role: 'user',
        content: messageContent
    };
    conversationHistory.push(userMessage);

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

        // Track token usage
        if (data.usage) {
            const newTokens = data.usage.total_tokens || 0;
            const inputTokens = data.usage.prompt_tokens || 0;
            const outputTokens = data.usage.completion_tokens || 0;
            currentChatTokens.prompt += inputTokens;
            currentChatTokens.completion += outputTokens;
            currentChatTokens.total += newTokens;
            currentChatTokens.requests += 1;
            
            // Update global token count
            globalTokens.total += newTokens;
            saveGlobalTokens();
            
            // Update credit balance with estimated cost
            updateCreditBalanceWithUsage(inputTokens, outputTokens, currentModel);
            
            updateTokenDisplay();
            updateGlobalTokenDisplay();
        }

        // Add AI response to conversation history
        conversationHistory.push({
            role: 'assistant',
            content: aiMessage
        });

        // Display AI response
        addMessage(aiMessage, 'ai');

        // Auto-save chat after successful response
        await saveCurrentChat();

    } catch (error) {
        console.error('Error:', error);
        removeMessage(typingId);
        addMessage(`❌ Error: ${error.message}`, 'ai', 'error');
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
    
    messagesContainer.appendChild(messageDiv);
    
    // Add buttons as separate element for AI messages
    if (sender === 'ai' && type === 'normal' && text) {
        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'ai-message-buttons';
        buttonsDiv.style.cssText = `
            display: flex !important;
            gap: 8px !important;
            margin: 8px auto 16px auto !important;
            padding: 0 24px !important;
            max-width: 48rem !important;
            background: transparent !important;
            border: none !important;
            justify-content: flex-start !important;
            align-items: center !important;
        `;
        
        const copyBtn = document.createElement('button');
        copyBtn.style.cssText = `
            display: flex !important;
            align-items: center !important;
            gap: 4px !important;
            padding: 6px 12px !important;
            background-color: rgba(34, 197, 94, 0.15) !important;
            border: 1px solid rgba(34, 197, 94, 0.5) !important;
            border-radius: 8px !important;
            color: #22c55e !important;
            font-size: 12px !important;
            cursor: pointer !important;
            transition: all 0.2s ease !important;
        `;
        copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2;">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="m5 15-2-2v-6a2 2 0 0 1 2-2h6l2 2"></path>
            </svg>
            Copy
        `;
        copyBtn.setAttribute('aria-label', 'Copy message');
        copyBtn.onclick = () => copyMessageToClipboard(copyBtn, messageDiv);
        
        const rewriteBtn = document.createElement('button');
        rewriteBtn.style.cssText = `
            display: flex !important;
            align-items: center !important;
            gap: 4px !important;
            padding: 6px 12px !important;
            background-color: rgba(59, 130, 246, 0.15) !important;
            border: 1px solid rgba(59, 130, 246, 0.5) !important;
            border-radius: 8px !important;
            color: #3b82f6 !important;
            font-size: 12px !important;
            cursor: pointer !important;
            transition: all 0.2s ease !important;
        `;
        rewriteBtn.innerHTML = `
            <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2;">
                <path d="m3 16 4 4 4-4"></path>
                <path d="M7 20V4"></path>
                <path d="M20 8l-4-4-4 4"></path>
                <path d="M17 4v16"></path>
            </svg>
            Rewrite
        `;
        rewriteBtn.setAttribute('aria-label', 'Regenerate response');
        rewriteBtn.onclick = () => rewriteMessage(messageDiv);
        
        // Add responsive behavior for mobile
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            buttonsDiv.style.justifyContent = 'flex-start';
            buttonsDiv.style.padding = '0 16px';
        }
        
        buttonsDiv.appendChild(copyBtn);
        buttonsDiv.appendChild(rewriteBtn);
        messagesContainer.appendChild(buttonsDiv);
    }
    
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
    
    // Save immediately when page is about to unload
    window.addEventListener('beforeunload', () => {
        // Use sendBeacon for reliable delivery during page unload
        const dataToSave = JSON.stringify(chatHistory);
        localStorage.setItem('chatgpt_history', dataToSave);
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
    
    // Show overlay with input form
    showSelectionResponseOverlay(selectedText, prefix, selectionRect);
    
    // Focus on the textarea after a brief delay and add keyboard support
    setTimeout(() => {
        const textarea = document.getElementById('additionalContext');
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
                    sendSelectionQuery();
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

async function sendSelectionQueryAsync() {
    if (!currentSelectionData) return;
    
    const additionalContext = document.getElementById('additionalContext').value.trim();
    
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
    showSelectionLoading();
    
    // Make API call
    try {
        const response = await getSelectionResponse(query);
        updateSelectionOverlayResponse(response);
    } catch (error) {
        updateSelectionOverlayResponse(`Error: ${error.message}`, true);
    }
}

// Wrapper for HTML onclick handlers
function sendSelectionQuery() {
    sendSelectionQueryAsync().catch(error => {
        console.error('Error sending selection query:', error);
    });
}

function showSelectionLoading() {
    const querySection = document.querySelector('.selection-query-section');
    const responseArea = document.querySelector('.selection-response-area');
    
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

function showSelectionResponseOverlay(selectedText, prefix, selectionRect) {
    // Remove any existing overlay
    hideSelectionResponseOverlay();
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'selectionResponseOverlay';
    overlay.className = 'selection-response-overlay';
    
    overlay.innerHTML = `
        <div class="selection-response-content">
            <div class="bubble-content">
                <div class="selection-query-section">
                    <div class="selected-text-display">${selectedText}</div>
                    <div class="quick-input">
                        <textarea 
                            id="additionalContext" 
                            placeholder="Ask about this..."
                            rows="1"
                        ></textarea>
                        <button class="quick-send" onclick="sendSelectionQuery()">
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
    
    document.body.appendChild(overlay);
    
    // Position the overlay relative to the selection
    if (selectionRect) {
        console.log('Selection rect:', selectionRect);
        const content = overlay.querySelector('.selection-response-content');
        if (content) {
            positionBubbleRelativeToSelection(content, selectionRect);
        }
    } else {
        console.log('No selection rect available');
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
}

function positionBubbleRelativeToSelection(content, selectionRect) {
    console.log('Positioning bubble with rect:', selectionRect);
    
    const bubbleWidth = 320;
    const margin = 20;
    
    // Calculate initial position - try right side first
    let bubbleLeft = selectionRect.right + margin;
    let bubbleTop = selectionRect.top;
    
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
    content.style.left = bubbleLeft + 'px';
    content.style.top = bubbleTop + 'px';
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

function updateSelectionOverlayResponse(response, isError = false) {
    const overlay = document.getElementById('selectionResponseOverlay');
    if (!overlay) return;
    
    const responseArea = overlay.querySelector('.selection-response-area');
    const footer = overlay.querySelector('.selection-response-footer');
    
    // Show the original query and response
    const queryDiv = document.createElement('div');
    queryDiv.className = 'selection-final-query';
    
    const additionalContext = document.getElementById('additionalContext')?.value.trim();
    
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

function setupOverlayResize(overlay) {
    const content = overlay.querySelector('.selection-response-content');
    const resizeHandle = overlay.querySelector('.overlay-resize-handle');
    
    if (!content || !resizeHandle || window.innerWidth <= 768) {
        return; // Skip on mobile
    }
    
    let isResizing = false;
    let startX, startY, startWidth, startHeight;
    
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = parseInt(document.defaultView.getComputedStyle(content).width, 10);
        startHeight = parseInt(document.defaultView.getComputedStyle(content).height, 10);
        
        e.preventDefault();
        e.stopPropagation();
        
        // Add body class to prevent text selection during resize
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'nw-resize';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const width = startWidth + e.clientX - startX;
        const height = startHeight + e.clientY - startY;
        
        // Apply constraints
        const minWidth = 280;
        const maxWidth = Math.min(800, window.innerWidth - 40);
        const minHeight = 200;
        const maxHeight = Math.min(600, window.innerHeight - 40);
        
        const constrainedWidth = Math.max(minWidth, Math.min(width, maxWidth));
        const constrainedHeight = Math.max(minHeight, Math.min(height, maxHeight));
        
        content.style.width = constrainedWidth + 'px';
        content.style.height = constrainedHeight + 'px';
        content.style.maxWidth = 'none';
        content.style.maxHeight = 'none';
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
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
            model: currentModel || 'chatgpt-4o-latest',
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
    console.log('addMessageActions called with:', messageDiv, messageText);
    const messageContent = messageDiv.querySelector('.message-content');
    console.log('messageContent found:', messageContent);
    if (!messageContent) {
        console.log('No message-content found, returning');
        return;
    }
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    // Force visibility for debugging
    actionsDiv.style.setProperty('display', 'flex', 'important');
    actionsDiv.style.setProperty('opacity', '1', 'important');
    actionsDiv.style.setProperty('visibility', 'visible', 'important');
    actionsDiv.style.setProperty('transform', 'translateY(0)', 'important');
    actionsDiv.style.setProperty('margin-top', '12px', 'important');
    actionsDiv.style.setProperty('gap', '8px', 'important');
    actionsDiv.style.setProperty('background-color', 'red', 'important'); // Debug background
    
    // Store the message text on the message div for safe access
    messageDiv.dataset.messageText = messageText;
    
    const copyButton = document.createElement('button');
    copyButton.className = 'message-action-btn copy-btn';
    copyButton.setAttribute('aria-label', 'Copy message to clipboard');
    // Force button styling for debugging
    copyButton.style.setProperty('display', 'flex', 'important');
    copyButton.style.setProperty('align-items', 'center', 'important');
    copyButton.style.setProperty('gap', '4px', 'important');
    copyButton.style.setProperty('padding', '6px 12px', 'important');
    copyButton.style.setProperty('background-color', '#22c55e', 'important');
    copyButton.style.setProperty('border', '1px solid #22c55e', 'important');
    copyButton.style.setProperty('border-radius', '8px', 'important');
    copyButton.style.setProperty('color', 'white', 'important');
    copyButton.style.setProperty('font-size', '12px', 'important');
    copyButton.style.setProperty('cursor', 'pointer', 'important');
    copyButton.style.setProperty('visibility', 'visible', 'important');
    copyButton.innerHTML = `
        <svg viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="m5 15-2-2v-6a2 2 0 0 1 2-2h6l2 2"></path>
        </svg>
        Copy
    `;
    copyButton.addEventListener('click', () => copyMessageToClipboard(copyButton, messageDiv));
    
    const rewriteButton = document.createElement('button');
    rewriteButton.className = 'message-action-btn rewrite-btn';
    rewriteButton.setAttribute('aria-label', 'Ask AI to rewrite this message');
    // Force button styling for debugging
    rewriteButton.style.setProperty('display', 'flex', 'important');
    rewriteButton.style.setProperty('align-items', 'center', 'important');
    rewriteButton.style.setProperty('gap', '4px', 'important');
    rewriteButton.style.setProperty('padding', '6px 12px', 'important');
    rewriteButton.style.setProperty('background-color', '#3b82f6', 'important');
    rewriteButton.style.setProperty('border', '1px solid #3b82f6', 'important');
    rewriteButton.style.setProperty('border-radius', '8px', 'important');
    rewriteButton.style.setProperty('color', 'white', 'important');
    rewriteButton.style.setProperty('font-size', '12px', 'important');
    rewriteButton.style.setProperty('cursor', 'pointer', 'important');
    rewriteButton.style.setProperty('visibility', 'visible', 'important');
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
    console.log('Message actions added to DOM:', actionsDiv);
    
    // Check if buttons are still there after 1 second
    setTimeout(() => {
        const stillThere = document.contains(actionsDiv);
        const parentStillThere = actionsDiv.parentElement;
        console.log('Buttons still in DOM after 1 second:', stillThere, 'Parent:', parentStillThere);
        if (stillThere) {
            console.log('Computed styles for actionsDiv:', window.getComputedStyle(actionsDiv));
            console.log('Computed styles for copyButton:', window.getComputedStyle(copyButton));
        }
    }, 1000);
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
        
        // Update token usage
        if (data.usage) {
            currentChatTokens.input += data.usage.prompt_tokens;
            currentChatTokens.output += data.usage.completion_tokens;
            currentChatTokens.total += data.usage.total_tokens;
            updateTokenDisplay();
        }

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

    // Check for API key
    const hasApiKey = promptForApiKey();
    
    // Always initialize the app, but show a message if no API key
    await initializeApp();
    
    // Wait for Firebase modules to load, then set up auth listener
    let firebaseRetryCount = 0;
    const maxFirebaseRetries = 10;
    
    function setupFirebaseAuthListener() {
        if (typeof window.authFunctions !== 'undefined' && window.authFunctions) {
            window.authFunctions.onAuthStateChanged(async (user) => {
                if (user) {
                    console.log('User signed in:', user.email);
                    console.log('Reloading chats from Firebase...');
                    await loadChatHistory();
                    updateHistoryDisplay();
                } else {
                    console.log('User signed out, using local storage only');
                    await loadChatHistory();
                    updateHistoryDisplay();
                }
            });
            console.log('Firebase auth listener established');
        } else {
            firebaseRetryCount++;
            if (firebaseRetryCount < maxFirebaseRetries) {
                console.log(`Waiting for Firebase... (${firebaseRetryCount}/${maxFirebaseRetries})`);
                setTimeout(setupFirebaseAuthListener, 500);
            } else {
                console.log('Firebase not available - running in local-only mode');
                // App will work with localStorage only
            }
        }
    }
    
    // Start trying to set up Firebase
    setTimeout(setupFirebaseAuthListener, 500);
    
    // Initialize URL routing after app is loaded
    setTimeout(() => {
        initializeUrlRouting();
    }, 50);
    
    // Multiple fallback attempts for GitHub Pages
    setTimeout(() => {
        const urlChatId = getChatIdFromUrl();
        if (urlChatId && !currentChatId) {
            console.log('Fallback 1: attempting to load chat from URL');
            handleUrlChange();
        }
    }, 500);
    
    setTimeout(() => {
        const urlChatId = getChatIdFromUrl();
        if (urlChatId && !currentChatId) {
            console.log('Fallback 2: attempting to load chat from URL');
            handleUrlChange();
        }
    }, 1000);
    
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

    // Load chat history on startup
    await loadChatHistory();
    
    // Load global token data
    loadGlobalTokens();
    
    // Load credit balance
    loadCreditBalance();
    
    // Load image generation settings
    loadImageSettings();
    
    // Initialize token display
    updateTokenDisplay();
    
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
        if (conversationHistory.length > 0) {
            // For beforeunload, we need to save synchronously
            // Save to localStorage immediately
            const chatData = {
                id: currentChatId || generateChatId(),
                title: getChatTitle(conversationHistory),
                messages: [...conversationHistory],
                model: currentModel,
                tokens: { ...currentChatTokens },
                timestamp: Date.now(),
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
            
            // Save immediately to localStorage
            try {
                localStorage.setItem('chatgpt_history', JSON.stringify(chatHistory));
            } catch (e) {
                console.error('Error saving chat history on unload:', e);
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
            
            // Track token usage if available
            if (data.usage) {
                currentChatTokens.prompt += data.usage.prompt_tokens || 0;
                currentChatTokens.completion += data.usage.completion_tokens || 0;
                currentChatTokens.total = currentChatTokens.prompt + currentChatTokens.completion;
                currentChatTokens.requests += 1;
                
                globalTokens.total += (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0);
                
                updateTokenDisplay();
                updateGlobalTokenDisplay();
                saveGlobalTokens();
                updateCreditBalanceWithUsage(data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0, currentModel);
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
            
            // Track token usage if available
            if (data.usage) {
                currentChatTokens.prompt += data.usage.prompt_tokens || 0;
                currentChatTokens.completion += data.usage.completion_tokens || 0;
                currentChatTokens.total = currentChatTokens.prompt + currentChatTokens.completion;
                currentChatTokens.requests += 1;
                
                globalTokens.total += (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0);
                
                updateTokenDisplay();
                updateGlobalTokenDisplay();
                saveGlobalTokens();
                updateCreditBalanceWithUsage(data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0, currentModel);
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

