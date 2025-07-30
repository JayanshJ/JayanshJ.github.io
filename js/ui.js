// UI Management Module
import { AppState, StateManager } from './state.js';
import { CONFIG, MODEL_CONFIG } from './config.js';

export class UIManager {
    constructor() {
        this.messagesContainer = null;
        this.messageInput = null;
        this.sendButton = null;
        this.init();
    }

    // Initialize UI elements
    init() {
        this.messagesContainer = document.getElementById('messages');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
    }

    // Generate unique message ID
    generateMessageId() {
        return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Add message to chat
    addMessage(content, sender = 'user', type = 'normal', messageId = null, imageData = null, fileData = null) {
        console.log('📝 Adding message:', { content, sender, type, messageId });
        
        if (!this.messagesContainer) {
            console.error('Messages container not found!');
            return null;
        }
        
        // Generate unique message ID if not provided
        if (!messageId) {
            messageId = this.generateMessageId();
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
        let messageContent = this.createMessageContent(content, type, imageData, fileData);
        messageDiv.innerHTML = messageContent;
        
        // Add to conversation history if it's a real message (not typing indicator)
        if (type !== 'typing' && content.trim()) {
            StateManager.addToConversation({
                role: sender === 'user' ? 'user' : 'assistant',
                content: content
            });
        }
        
        // Append to messages container
        this.messagesContainer.appendChild(messageDiv);
        
        // Scroll to bottom
        this.scrollToBottom();
        
        // Auto-save chat if it's a real message
        if (type !== 'typing' && content.trim()) {
            setTimeout(() => {
                this.saveCurrentChatOptimized();
            }, 500);
        }
        
        return messageId;
    }

    // Create message content HTML
    createMessageContent(content, type, imageData = null, fileData = null) {
        if (type === 'typing') {
            return `
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
        }

        let messageHTML = `<div class="message-content">`;
        
        // Add image if present
        if (imageData) {
            messageHTML += `
                <div class="message-image">
                    <img src="${imageData.dataUrl}" alt="${imageData.name}" style="max-width: 300px; border-radius: 8px;">
                    <div class="image-info">${imageData.name} (${this.formatFileSize(imageData.size)})</div>
                </div>
            `;
        }
        
        // Add file info if present
        if (fileData) {
            messageHTML += `
                <div class="message-file">
                    <div class="file-icon">📄</div>
                    <div class="file-info">
                        <div class="file-name">${fileData.name}</div>
                        <div class="file-size">${this.formatFileSize(fileData.size)}</div>
                    </div>
                </div>
            `;
        }
        
        // Add text content
        messageHTML += `<div class="message-text">${content}</div>`;
        messageHTML += `</div>`;
        
        return messageHTML;
    }

    // Remove message from chat
    removeMessage(messageId) {
        if (!messageId) return;
        
        const messageElement = document.getElementById(messageId);
        if (messageElement) {
            messageElement.remove();
            console.log('🗑️ Removed message:', messageId);
        }
    }

    // Scroll to bottom of messages
    scrollToBottom() {
        if (this.messagesContainer) {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        }
    }

    // Clear chat messages
    clearChat() {
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = `
                <div class="welcome-screen">
                    <div class="welcome-icon">✨</div>
                    <h2>How can I help you today?</h2>
                </div>
            `;
        }
        StateManager.clearConversation();
        StateManager.clearSelectedFiles();
        StateManager.clearSelectedImages();
    }

    // Show/hide welcome screen
    toggleWelcomeScreen(show = false) {
        const welcomeScreen = document.querySelector('.welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.style.display = show ? 'block' : 'none';
        }
    }

    // Update input placeholder based on model
    updateInputPlaceholder(model) {
        if (!this.messageInput) return;
        
        const placeholder = MODEL_CONFIG.placeholders[model] || 'Message ChatGPT...';
        this.messageInput.placeholder = placeholder;
    }

    // Update welcome message based on model
    updateWelcomeMessage(model) {
        const welcomeScreen = document.querySelector('.welcome-screen h2');
        if (!welcomeScreen) return;
        
        const message = MODEL_CONFIG.welcomeMessages[model] || 'How can I help you today?';
        welcomeScreen.textContent = message;
    }

    // Enable/disable input controls
    setInputEnabled(enabled) {
        if (this.messageInput) {
            this.messageInput.disabled = !enabled;
        }
        if (this.sendButton) {
            this.sendButton.disabled = !enabled;
        }
        
        if (enabled && this.messageInput) {
            this.messageInput.focus();
        }
    }

    // Clear input field
    clearInput() {
        if (this.messageInput) {
            this.messageInput.value = '';
            this.messageInput.style.height = 'auto';
        }
    }

    // Get input value
    getInputValue() {
        return this.messageInput ? this.messageInput.value.trim() : '';
    }

    // Set input value
    setInputValue(value) {
        if (this.messageInput) {
            this.messageInput.value = value;
        }
    }

    // Format file size for display
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Show error message
    showError(message) {
        this.addMessage(`❌ ${message}`, 'ai', 'error');
    }

    // Show success message
    showSuccess(message) {
        this.addMessage(`✅ ${message}`, 'ai', 'normal');
    }

    // Show info message
    showInfo(message) {
        this.addMessage(`ℹ️ ${message}`, 'ai', 'normal');
    }

    // Update model selection UI
    updateModelSelection(model) {
        // Update selected state for all model options
        document.querySelectorAll('.model-option').forEach(option => {
            option.classList.remove('selected');
            if (option.dataset.model === model) {
                option.classList.add('selected');
            }
        });

        // Close dropdowns
        const headerDropdown = document.getElementById('modelDropdownHeader');
        const inputDropdown = document.getElementById('modelDropdown');
        const headerButton = document.getElementById('modelDropdownHeaderButton');
        const inputButton = document.getElementById('modelDropdownButton');

        [headerDropdown, inputDropdown].forEach(dropdown => {
            if (dropdown) dropdown.classList.remove('active');
        });

        [headerButton, inputButton].forEach(button => {
            if (button) button.classList.remove('active');
        });

        // Update placeholder and welcome message
        this.updateInputPlaceholder(model);
        this.updateWelcomeMessage(model);

        console.log('Model selected:', model);
    }

    // Show/hide file preview
    showFilePreview() {
        const previewContainer = document.getElementById('filePreview');
        if (!previewContainer) return;

        const hasFiles = AppState.selectedImages.length > 0 || AppState.selectedFiles.length > 0;
        previewContainer.style.display = hasFiles ? 'block' : 'none';

        if (hasFiles) {
            this.updateFilePreviewContent();
        }
    }

    // Update file preview content
    updateFilePreviewContent() {
        const previewContainer = document.getElementById('filePreview');
        if (!previewContainer) return;

        let previewHTML = '<div class="file-preview-items">';

        // Add images
        AppState.selectedImages.forEach((image, index) => {
            previewHTML += `
                <div class="preview-item image-preview" data-index="${index}" data-type="image">
                    <img src="${image.dataUrl}" alt="${image.name}">
                    <div class="preview-info">
                        <span class="file-name">${image.name}</span>
                        <span class="file-size">${this.formatFileSize(image.size)}</span>
                    </div>
                    <button class="remove-file" onclick="removeSelectedFile('image', ${index})">×</button>
                </div>
            `;
        });

        // Add files
        AppState.selectedFiles.forEach((file, index) => {
            previewHTML += `
                <div class="preview-item file-preview" data-index="${index}" data-type="file">
                    <div class="file-icon">${this.getFileIcon(file.name)}</div>
                    <div class="preview-info">
                        <span class="file-name">${file.name}</span>
                        <span class="file-size">${this.formatFileSize(file.size)}</span>
                    </div>
                    <button class="remove-file" onclick="removeSelectedFile('file', ${index})">×</button>
                </div>
            `;
        });

        previewHTML += '</div>';
        previewContainer.innerHTML = previewHTML;
    }

    // Get file icon based on file type
    getFileIcon(fileName) {
        const extension = fileName.split('.').pop().toLowerCase();
        const iconMap = {
            'pdf': '📄',
            'doc': '📝',
            'docx': '📝',
            'txt': '📄',
            'mp3': '🎵',
            'wav': '🎵',
            'm4a': '🎵',
            'aac': '🎵',
            'jpg': '🖼️',
            'jpeg': '🖼️',
            'png': '🖼️',
            'gif': '🖼️',
            'webp': '🖼️'
        };
        return iconMap[extension] || '📎';
    }

    // Placeholder for save function (to be implemented in storage module)
    saveCurrentChatOptimized() {
        // This will be implemented in the storage module
        console.log('💾 Saving chat...');
    }
}

// Create singleton instance
export const uiManager = new UIManager();