// ChatGPT App Configuration
// The API key and settings are loaded from config.js
const API_URL = 'https://api.openai.com/v1/chat/completions';
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const BILLING_URL = 'https://api.openai.com/v1/dashboard/billing/usage';
const SUBSCRIPTION_URL = 'https://api.openai.com/v1/dashboard/billing/subscription';

// Store conversation history
let conversationHistory = [];
let selectedImage = null;
let selectedFile = null;
let currentModel = 'o3-2025-04-16';
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

// Load chat history from localStorage
function loadChatHistory() {
    const saved = localStorage.getItem('chatgpt_history');
    if (saved) {
        try {
            chatHistory = JSON.parse(saved);
            
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
            chatHistory = [];
        }
    }
    loadChatFolders();
    updateHistoryDisplay();
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

// Delete a folder
function deleteFolder(folderId) {
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
        
        saveChatHistory();
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
function renameFolder(folderId) {
    const folder = chatFolders.find(f => f.id === folderId);
    if (!folder) return;
    
    const newName = prompt('Rename folder:', folder.name);
    if (newName && newName.trim() && newName.trim() !== folder.name) {
        folder.name = newName.trim();
        saveChatFolders();
        updateHistoryDisplay();
    }
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
function saveChatHistory() {
    try {
        localStorage.setItem('chatgpt_history', JSON.stringify(chatHistory));
    } catch (e) {
        console.error('Error saving chat history:', e);
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
        // Still loading on first run
        creditContent = `<div class="credit-balance" style="color: #f59e0b;">Checking balance... ⏳</div>`;
    } else {
        // Show manual entry option with helpful message
        creditContent = `<div class="credit-balance" onclick="setCreditBalance()" style="cursor: pointer; color: #10b981;" title="Click to set your credit balance manually">Click to set balance 💰</div>`;
    }
    
    // For the main header (top right), show credit more prominently
    if (globalElement) {
        globalElement.innerHTML = `
            ${creditContent}
            ${tokenContent}
        `;
    }
    
    // For sidebar, keep the original order
    if (globalSidebarElement) {
        globalSidebarElement.innerHTML = tokenContent + creditContent;
    }
}

// Manual credit balance setting
function setCreditBalance() {
    const currentBalance = creditBalance.remaining > 0 ? creditBalance.remaining.toFixed(2) : '';
    
    // More detailed prompt with instructions
    const message = `Enter your OpenAI credit balance:

💡 To find your balance:
1. Go to https://platform.openai.com/usage
2. Look for "Credits" or "Balance" section
3. Enter the amount here (e.g., 15.50)

Current balance: ${currentBalance || 'Not set'}

Note: Automatic balance fetching is not available in browser apps due to OpenAI's security restrictions. Manual entry is the standard approach.`;
    
    const newBalance = prompt(message, currentBalance);
    
    if (newBalance !== null && newBalance.trim() !== '') {
        const balanceNumber = parseFloat(newBalance.trim());
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
            
            console.log('✅ Manual credit balance set to:', `$${balanceNumber.toFixed(2)}`);
            console.log('💾 Balance saved to localStorage');
        } else {
            alert('Please enter a valid number (e.g., 15.50)');
        }
    }
}

// Estimate and deduct API costs from credit balance
function updateCreditBalanceWithUsage(inputTokens, outputTokens, model) {
    if (!creditBalance.manual || creditBalance.remaining <= 0) {
        return; // Only update if manually set balance exists
    }
    
    // Current pricing per 1M tokens (July 2025 - from OpenAI API pricing page)
    const pricingPer1M = {
        'o3-2025-04-16': {
            input: 2.50,    // $2.50 per 1M input tokens (estimated for o3 model)
            output: 10.00   // $10.00 per 1M output tokens (estimated for o3 model)
        },
        'gpt-4.1-2025-04-14': {
            input: 2.00,    // $2.00 per 1M input tokens
            output: 8.00    // $8.00 per 1M output tokens
        }
    };
    
    const pricing = pricingPer1M[model] || pricingPer1M['o3-2025-04-16'];
    
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
function processMessageText(text) {
    if (!text) return '';
    
    // First, handle code blocks to preserve them
    const codeBlocks = [];
    text = text.replace(/```([\s\S]*?)```/g, (match, code) => {
        const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
        codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
        return placeholder;
    });
    
    // Handle inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Convert **bold** to <strong>
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Convert *italic* to <em>
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
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

// Get chat title from first message
function getChatTitle(messages) {
    if (messages.length === 0) return 'New Chat';
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

// Save current chat
function saveCurrentChat() {
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
    
    saveChatHistory();
    updateHistoryDisplay();
}

// Load a chat from history
function loadChat(chatId) {
    const chat = chatHistory.find(c => c.id === chatId);
    if (!chat) return;
    
    currentChatId = chatId;
    conversationHistory = [...chat.messages];
    currentModel = chat.model || 'o3-2025-04-16';
    
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

// Delete a chat from history
function deleteChat(chatId) {
    const chatToDelete = chatHistory.find(chat => chat.id === chatId);
    
    // DON'T subtract tokens - they were already consumed and billed
    // Token usage represents actual API consumption, not current chat tokens
    
    chatHistory = chatHistory.filter(chat => chat.id !== chatId);
    globalTokens.chats = chatHistory.length;
    
    saveChatHistory();
    saveGlobalTokens();
    updateHistoryDisplay();
    updateGlobalTokenDisplay();
    
    // If deleted chat was current, start new chat
    if (currentChatId === chatId) {
        startNewChat();
    }
}

// Clear all chat history
function clearAllHistory() {
    if (confirm('Are you sure you want to delete all chat history? This cannot be undone.\n\nNote: Token usage will remain unchanged as tokens were already consumed.')) {
        chatHistory = [];
        // DON'T reset global tokens - they represent actual API usage that was already billed
        // Only reset the chat count
        globalTokens.chats = 0;
        saveChatHistory();
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
}

// Update history display
function updateHistoryDisplay() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    
    let html = '';
    
    // Show folders section
    if (chatFolders.length > 0 || chatHistory.length > 0) {
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
    }
    
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
    const moveOptions = ['Remove from folder', ...chatFolders.map(f => f.name)];
    const choice = prompt(
        `Move chat to:\n\n${moveOptions.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}\n\nEnter number:`,
        ''
    );
    
    const choiceIndex = parseInt(choice) - 1;
    if (choiceIndex >= 0 && choiceIndex < moveOptions.length) {
        if (choiceIndex === 0) {
            // Remove from folder
            moveChatToFolder(chatId, null);
        } else {
            // Move to selected folder
            const targetFolder = chatFolders[choiceIndex - 1];
            if (targetFolder) {
                moveChatToFolder(chatId, targetFolder.id);
            }
        }
    }
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
    
    const message = `🔑 Welcome to JayanshGPT!

To get started, you'll need an OpenAI API key:

1. Go to: https://platform.openai.com/api-keys
2. Create a new API key
3. Copy and paste it below

Your API key will be saved securely in your browser for future visits.

Enter your OpenAI API key:`;
    
    const apiKey = prompt(message, '');
    
    if (!apiKey || apiKey.trim() === '') {
        alert('❌ API key is required to use this app. Please refresh and try again.');
        return false;
    }
    
    if (!apiKey.startsWith('sk-')) {
        const confirm = window.confirm('⚠️ The API key should start with "sk-". Are you sure this is correct?\n\nClick OK to continue anyway, or Cancel to re-enter.');
        if (!confirm) {
            return promptForApiKey(); // Try again
        }
    }
    
    sessionApiKey = apiKey.trim();
    
    // Save the key by default for convenience
    localStorage.setItem('chatgpt_api_key', sessionApiKey);
    console.log('💾 API key saved to localStorage for future visits');
    
    // Show confirmation
    alert('✅ API key saved! You won\'t need to enter it again on future visits.\n\n💡 You can update or clear your saved key anytime using the Settings button (⚙️).');
    
    return true;
}

function clearSavedApiKey() {
    if (confirm('🗑️ Are you sure you want to clear your saved API key?\n\nYou will need to enter it again on your next visit.')) {
        localStorage.removeItem('chatgpt_api_key');
        sessionApiKey = null;
        updateApiKeyStatus(); // Update status display
        alert('✅ Saved API key has been cleared. You will be prompted for a new key on next visit.');
    }
}

function updateApiKey() {
    const newKey = prompt('🔑 Enter your new OpenAI API key:', sessionApiKey || '');
    
    if (newKey && newKey.trim() !== '' && newKey !== sessionApiKey) {
        sessionApiKey = newKey.trim();
        
        // Save the new key automatically
        localStorage.setItem('chatgpt_api_key', sessionApiKey);
        updateApiKeyStatus(); // Update status display
        alert('✅ API key updated and saved successfully!');
    }
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
    const dropdown = document.getElementById('modelDropdown');
    const button = document.querySelector('.model-selector-btn');
    
    if (dropdown) {
        dropdown.classList.toggle('active');
        if (button) {
            button.classList.toggle('active');
        }
        console.log('Dropdown toggled, active:', dropdown.classList.contains('active'));
    } else {
        console.error('Model dropdown not found');
    }
}

function selectModel(model) {
    currentModel = model;
    const currentModelElement = document.getElementById('currentModel');
    if (currentModelElement) {
        currentModelElement.textContent = getModelDisplayName(model);
    }
    
    const dropdown = document.getElementById('modelDropdown');
    const button = document.querySelector('.model-selector-btn');
    if (dropdown) {
        dropdown.classList.remove('active');
    }
    if (button) {
        button.classList.remove('active');
    }
    
    // Update selected state
    document.querySelectorAll('.model-option').forEach(option => {
        option.classList.remove('selected');
        if (option.dataset.model === model) {
            option.classList.add('selected');
        }
    });
    
    console.log('Model selected:', model);
}

function getModelDisplayName(model) {
    const names = {
        'o3-2025-04-16': 'o3-2025-04-16',
        'gpt-4.1-2025-04-14': 'GPT-4.1-2025-04-14'
    };
    return names[model] || model;
}

function getModelTemperature(model) {
    const temperatures = {
        'o3-2025-04-16': 1,
        'gpt-4.1-2025-04-14': 0.1
    };
    return temperatures[model] || 0.7; // Default fallback
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
    const hasApiKey = sessionApiKey && sessionApiKey !== 'prompt-for-key';
    const isApiKeySaved = localStorage.getItem('chatgpt_api_key') !== null;
    
    let options = [
        '🔑 Update API Key',
        '📊 View Token Usage',
        '💰 Set Credit Balance'
    ];
    
    if (isApiKeySaved) {
        options.push('🗑️ Clear Saved API Key');
    }
    
    options.push('❌ Cancel');
    
    const choice = prompt(
        `⚙️ Settings Menu:\n\n${options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}\n\nChoose an option (1-${options.length}):`,
        ''
    );
    
    const choiceNum = parseInt(choice);
    
    if (choiceNum === 1) {
        updateApiKey();
    } else if (choiceNum === 2) {
        showTokenUsageInfo();
    } else if (choiceNum === 3) {
        setCreditBalance();
    } else if (choiceNum === 4 && isApiKeySaved) {
        clearSavedApiKey();
    }
}

function showTokenUsageInfo() {
    const info = `📊 Token Usage Information:

Current Chat:
• Total: ${currentChatTokens.total.toLocaleString()} tokens
• Input: ${currentChatTokens.prompt.toLocaleString()} tokens  
• Output: ${currentChatTokens.completion.toLocaleString()} tokens
• Requests: ${currentChatTokens.requests}

Global Stats:
• All Time: ${globalTokens.total.toLocaleString()} tokens
• Total Chats: ${globalTokens.chats}

💡 Tokens are used for both input and output. Longer conversations use more tokens.`;
    
    alert(info);
}

async function sendMessage() {
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
    
    const message = input.value.trim();

    if (!message && !selectedImage && !selectedFile) return;

    const apiKey = getApiKey();

    // Validate API key
    if (apiKey === 'YOUR_API_KEY' || apiKey === 'your-api-key-here' || !apiKey) {
        addMessage('⚠️ Please set your OpenAI API key in the config.js file.', 'ai', 'error');
        return;
    }

    // Check if model supports vision when image is selected
    if (selectedImage && !currentModel.includes('gpt-4') && !currentModel.includes('o3')) {
        addMessage('⚠️ Image analysis requires vision-capable models. Please switch to GPT-4.1-2025-04-14 or o3-2025-04-16.', 'ai', 'error');
        return;
    }

    // Hide welcome screen
    const welcomeScreen = document.querySelector('.welcome-screen');
    if (welcomeScreen) {
        welcomeScreen.style.display = 'none';
    }

    // Disable input and button during request
    input.disabled = true;
    sendButton.disabled = true;

    // Display user message with file if selected
    let displayMessage = message;
    if (!message && selectedFile) {
        if (selectedFile.type === 'application/pdf') {
            displayMessage = 'Analyze this PDF';
        } else if (selectedFile.isAudio) {
            displayMessage = 'Transcribe this audio file';
        } else {
            displayMessage = 'Analyze this image';
        }
    }
    
    addMessage(displayMessage, 'user', 'normal', selectedImage, selectedFile);
    input.value = '';
    input.style.height = 'auto';

    // Handle audio file transcription
    if (selectedFile && selectedFile.isAudio) {
        // Clear selected files first
        const audioFile = selectedFile.file;
        clearSelectedFiles();
        
        // Show processing message
        const processingId = addMessage('🎵 Transcribing audio file...', 'ai', 'typing');
        
        try {
            const transcription = await transcribeAudioFile(audioFile);
            
            // Remove processing message
            removeMessage(processingId);
            
            if (transcription) {
                // Add transcribed text to conversation
                conversationHistory.push({
                    role: 'user',
                    content: `Audio transcription: ${transcription}`
                });
                
                // Prepare message content with transcription
                const fullMessage = message ? 
                    `${message}\n\nAudio transcription:\n${transcription}` : 
                    `Please analyze this audio transcription:\n\n${transcription}`;
                
                // Update conversation history
                conversationHistory[conversationHistory.length - 1].content = fullMessage;
                
                // Show transcribed content
                addMessage(`📝 Transcription: ${transcription}`, 'ai');
                
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
                            messages: conversationHistory,
                            max_completion_tokens: 1000,
                            temperature: getModelTemperature(currentModel)
                        })
                    });

                    removeMessage(typingId);

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
                    }

                    const data = await response.json();
                    const aiMessage = data.choices[0].message.content;

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
                    saveCurrentChat();
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
    if (selectedImage) {
        messageContent = [
            {
                type: "text",
                text: message || "What do you see in this image?"
            },
            {
                type: "image_url",
                image_url: {
                    url: selectedImage.dataUrl
                }
            }
        ];
    } else if (selectedFile && selectedFile.type === 'application/pdf') {
        messageContent = message || "Please analyze this PDF content:";
        messageContent += `\n\nPDF Content:\n${selectedFile.text}`;
    } else {
        messageContent = message;
    }

    // Add user message to conversation history
    conversationHistory.push({
        role: 'user',
        content: messageContent
    });

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
                messages: conversationHistory,
                max_completion_tokens: 1000,
                temperature: getModelTemperature(currentModel)
            })
        });

        // Remove typing indicator
        removeMessage(typingId);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const aiMessage = data.choices[0].message.content;

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
        saveCurrentChat();

    } catch (error) {
        console.error('Error:', error);
        removeMessage(typingId);
        addMessage(`❌ Error: ${error.message}`, 'ai', 'error');
    } finally {
        // Re-enable input and button
        input.disabled = false;
        sendButton.disabled = false;
        input.focus();
    }
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
            <div class="message-avatar">🤖</div>
            <div class="message-content">
                <div class="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
    } else {
        const avatar = sender === 'user' ? '�‍💻' : '🤖';
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
            const processedText = processMessageText(text);
            contentHtml += `<div class="message-text">${processedText}</div>`;
        }
        
        messageDiv.innerHTML = `
            <div class="message-avatar">${avatar}</div>
            <div class="message-content">${contentHtml}</div>
        `;
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
    const file = event.target.files[0];
    if (!file) return;
    processFile(file);
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
            selectedImage = {
                name: file.name,
                size: file.size,
                dataUrl: e.target.result
            };
            selectedFile = null;
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
                
                selectedFile = {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    text: text.trim(),
                    pages: pdf.numPages
                };
                selectedImage = null;
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
            selectedFile = {
                name: file.name,
                size: file.size,
                type: file.type || 'audio/mpeg',
                file: file, // Store the actual file for transcription
                isAudio: true
            };
            selectedImage = null;
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
    
    // Process the first valid file found
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
            
            // Show feedback that file was dropped
            const input = document.getElementById('messageInput');
            if (input && !input.value.trim()) {
                let fileType = 'File';
                if (isImage) fileType = 'Image';
                else if (isPDF) fileType = 'PDF';
                else if (isAudio) fileType = 'Audio file';
                
                input.placeholder = `${fileType} dropped! Add a message or press Enter to send...`;
                setTimeout(() => {
                    input.placeholder = 'Message ChatGPT... (paste/drag images, PDFs, or audio)';
                }, 3000);
            }
            break;
        }
    }
}

function showFilePreview() {
    const preview = document.getElementById('filePreview');
    if (!selectedImage && !selectedFile) {
        preview.classList.remove('active');
        return;
    }

    let previewHTML = '';
    
    if (selectedImage) {
        previewHTML = `
            <img src="${selectedImage.dataUrl}" alt="${selectedImage.name}" class="preview-image">
            <div class="preview-info">
                <div class="preview-name">${selectedImage.name}</div>
                <div class="preview-size">${formatFileSize(selectedImage.size)}</div>
            </div>
            <button onclick="clearSelectedFiles()" class="remove-file">×</button>
        `;
    } else if (selectedFile) {
        if (selectedFile.isAudio) {
            previewHTML = `
                <div class="preview-audio">MP3</div>
                <div class="preview-info">
                    <div class="preview-name">${selectedFile.name}</div>
                    <div class="preview-size">${formatFileSize(selectedFile.size)}</div>
                    <div class="preview-size">Audio file for transcription</div>
                </div>
                <button onclick="clearSelectedFiles()" class="remove-file">×</button>
            `;
        } else {
            previewHTML = `
                <div class="preview-pdf">PDF</div>
                <div class="preview-info">
                    <div class="preview-name">${selectedFile.name}</div>
                    <div class="preview-size">${formatFileSize(selectedFile.size)}</div>
                    ${selectedFile.pages ? `<div class="preview-size">${selectedFile.pages} pages</div>` : ''}
                </div>
                <button onclick="clearSelectedFiles()" class="remove-file">×</button>
            `;
        }
    }
    
    preview.innerHTML = previewHTML;
    preview.classList.add('active');
}

function clearSelectedFiles() {
    selectedImage = null;
    selectedFile = null;
    const preview = document.getElementById('filePreview');
    preview.classList.remove('active');
    document.getElementById('fileInput').value = '';
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
        input.placeholder = 'Message ChatGPT... (paste/drag images, PDFs, or audio)';
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
document.addEventListener('DOMContentLoaded', function() {
    const fileInput = document.getElementById('fileInput');
    const messageInput = document.getElementById('messageInput');
    const mainContent = document.querySelector('.main-content');

    // Initialize API key first
    if (!promptForApiKey()) {
        // If no API key provided, disable the app
        if (messageInput) messageInput.disabled = true;
        return;
    }
    
    // Update UI to show API key status
    updateApiKeyStatus();

    // Load chat history on startup
    loadChatHistory();
    
    // Load global token data
    loadGlobalTokens();
    
    // Load credit balance
    loadCreditBalance();
    
    // Initialize token display
    updateTokenDisplay();
    
    // Ensure input is enabled on page load
    if (messageInput) {
        messageInput.disabled = false;
        messageInput.value = '';
        console.log('Message input initialized');
        
        // Test that the input is clickable and focusable
        messageInput.addEventListener('click', function() {
            console.log('Input clicked successfully');
        });
        
        messageInput.addEventListener('focus', function() {
            console.log('Input focused successfully');
        });
        
        // Try to focus the input
        setTimeout(() => {
            messageInput.focus();
            console.log('Focus attempted');
        }, 100);
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
            const dropdown = document.getElementById('modelDropdown');
            const button = document.querySelector('.model-selector-btn');
            if (dropdown) {
                dropdown.classList.remove('active');
            }
            if (button) {
                button.classList.remove('active');
            }
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
        // Stop any ongoing recording
        if (isRecording) {
            stopRecording();
        }
        
        if (conversationHistory.length > 0) {
            saveCurrentChat();
        }
    });

    // Close sidebar on ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSidebar();
        }
    });

    // Close sidebar when resizing to desktop
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            closeSidebar();
        }
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
});
