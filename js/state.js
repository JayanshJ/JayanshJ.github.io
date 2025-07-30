// Global State Management
import { CONFIG } from './config.js';

// Application State
export const AppState = {
    // Conversation data
    conversationHistory: [],
    selectedImages: [],
    selectedFiles: [],
    currentModel: CONFIG.DEFAULT_MODEL,
    currentChatId: null,
    chatHistory: [],
    chatFolders: [],
    currentFolderId: null,
    
    // UI state
    isRecording: false,
    savingInProgress: false,
    saveTimeout: null,
    activeRequestTokens: new Map(),
    
    // Selection state
    selectedTextContext: null,
    currentSelectionData: null,
    selectionTooltip: null,
    selectionTimeout: null,
    overlayCounter: 0,
    
    // Inline commands
    inlineCommands: {},
    
    // Image settings
    imageSettings: {
        quality: 'auto',
        size: 'auto',
        background: 'auto',
        outputFormat: 'png'
    }
};

// State management utilities
export const StateManager = {
    // Get current state
    getState() {
        return AppState;
    },
    
    // Update conversation history
    updateConversationHistory(messages) {
        AppState.conversationHistory = messages;
    },
    
    // Add message to conversation
    addToConversation(message) {
        AppState.conversationHistory.push(message);
    },
    
    // Clear conversation
    clearConversation() {
        AppState.conversationHistory = [];
    },
    
    // Set current model
    setCurrentModel(model) {
        AppState.currentModel = model;
    },
    
    // Set current chat ID
    setCurrentChatId(chatId) {
        AppState.currentChatId = chatId;
    },
    
    // Update chat history
    updateChatHistory(chats) {
        AppState.chatHistory = chats;
    },
    
    // Add selected image
    addSelectedImage(imageData) {
        AppState.selectedImages.push(imageData);
    },
    
    // Clear selected images
    clearSelectedImages() {
        AppState.selectedImages = [];
    },
    
    // Add selected file
    addSelectedFile(fileData) {
        AppState.selectedFiles.push(fileData);
    },
    
    // Clear selected files
    clearSelectedFiles() {
        AppState.selectedFiles = [];
    },
    
    // Set recording state
    setRecording(isRecording) {
        AppState.isRecording = isRecording;
    },
    
    // Set saving state
    setSaving(isSaving) {
        AppState.savingInProgress = isSaving;
    },
    
    // Update image settings
    updateImageSettings(settings) {
        AppState.imageSettings = { ...AppState.imageSettings, ...settings };
    }
};

// Export state for direct access when needed
export { AppState as default };