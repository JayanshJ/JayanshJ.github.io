// File Management Module
import { AppState, StateManager } from './state.js';
import { uiManager } from './ui.js';
import { CONFIG } from './config.js';

export class FileManager {
    constructor() {
        this.supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        this.supportedAudioTypes = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac'];
        this.supportedAudioExtensions = ['.mp3', '.wav', '.m4a', '.aac'];
    }

    // Handle file selection from input
    handleFileSelect(event) {
        const files = Array.from(event.target.files);
        if (!files.length) return;
        
        console.log('📎 Processing', files.length, 'selected files');
        
        // Process each file
        files.forEach(file => this.processFile(file));
        
        // Clear the input to allow selecting the same file again
        event.target.value = '';
    }

    // Process individual file
    async processFile(file) {
        console.log('📄 Processing file:', file.name, file.type, file.size);
        
        // Validate file type
        const isImage = this.isImageFile(file);
        const isPDF = this.isPDFFile(file);
        const isAudio = this.isAudioFile(file);
        
        if (!isImage && !isPDF && !isAudio) {
            uiManager.showError('Please select a valid image, PDF, or audio file.');
            return;
        }

        // Validate file size
        const maxSize = isAudio ? CONFIG.MAX_FILE_SIZE.AUDIO : CONFIG.MAX_FILE_SIZE.OTHER;
        if (file.size > maxSize) {
            const sizeLimit = isAudio ? '25MB' : '20MB';
            uiManager.showError(`File is too large. Please select a file under ${sizeLimit}.`);
            return;
        }

        try {
            if (isImage) {
                await this.processImageFile(file);
            } else if (isPDF) {
                await this.processPDFFile(file);
            } else if (isAudio) {
                await this.processAudioFile(file);
            }
            
            // Update file preview
            uiManager.showFilePreview();
            
        } catch (error) {
            console.error('Error processing file:', error);
            uiManager.showError(`Error processing ${file.name}: ${error.message}`);
        }
    }

    // Process image file
    async processImageFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                const imageData = {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    dataUrl: e.target.result,
                    isImage: true
                };
                
                StateManager.addSelectedImage(imageData);
                console.log('🖼️ Image processed:', file.name);
                resolve(imageData);
            };
            
            reader.onerror = () => {
                reject(new Error('Failed to read image file'));
            };
            
            reader.readAsDataURL(file);
        });
    }

    // Process PDF file
    async processPDFFile(file) {
        try {
            // Check if PDF.js is available
            if (typeof pdfjsLib === 'undefined') {
                throw new Error('PDF.js library not loaded');
            }
            
            // Set up PDF.js worker
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
                text: text,
                file: file,
                isAudio: false,
                isPDF: true
            };
            
            StateManager.addSelectedFile(fileData);
            console.log('📄 PDF processed:', file.name, 'Pages:', pdf.numPages);
            
            return fileData;
            
        } catch (error) {
            console.error('Error processing PDF:', error);
            throw new Error(`Failed to process PDF: ${error.message}`);
        }
    }

    // Process audio file
    async processAudioFile(file) {
        const fileData = {
            name: file.name,
            size: file.size,
            type: file.type,
            file: file,
            isAudio: true,
            isPDF: false
        };
        
        StateManager.addSelectedFile(fileData);
        console.log('🎵 Audio file prepared:', file.name);
        
        return fileData;
    }

    // File type validation methods
    isImageFile(file) {
        return this.supportedImageTypes.includes(file.type);
    }

    isPDFFile(file) {
        return file.type === 'application/pdf';
    }

    isAudioFile(file) {
        return this.supportedAudioTypes.includes(file.type) || 
               this.supportedAudioExtensions.some(ext => 
                   file.name.toLowerCase().endsWith(ext)
               );
    }

    // Handle drag and drop
    handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        
        // Add visual feedback
        const dropZone = event.currentTarget;
        dropZone.classList.add('drag-over');
    }

    handleDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();
        
        // Remove visual feedback
        const dropZone = event.currentTarget;
        dropZone.classList.remove('drag-over');
    }

    handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        
        // Remove visual feedback
        const dropZone = event.currentTarget;
        dropZone.classList.remove('drag-over');
        
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) {
            console.log('📎 Files dropped:', files.length);
            files.forEach(file => this.processFile(file));
        }
    }

    // Remove selected file
    removeSelectedFile(type, index) {
        if (type === 'image') {
            AppState.selectedImages.splice(index, 1);
        } else if (type === 'file') {
            AppState.selectedFiles.splice(index, 1);
        }
        
        // Update preview
        uiManager.showFilePreview();
        
        console.log('🗑️ Removed', type, 'at index', index);
    }

    // Clear all selected files
    clearSelectedFiles() {
        StateManager.clearSelectedFiles();
        StateManager.clearSelectedImages();
        uiManager.showFilePreview();
        console.log('🗑️ Cleared all selected files');
    }

    // Get file info for display
    getFileInfo(file) {
        return {
            name: file.name,
            size: this.formatFileSize(file.size),
            type: file.type,
            icon: this.getFileIcon(file.name)
        };
    }

    // Format file size for display
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

    // Download file utility
    downloadFile(data, filename, mimeType) {
        const blob = new Blob([data], { type: mimeType });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    }

    // Download image from base64
    downloadImage(base64Data, prompt) {
        try {
            // Convert base64 to blob
            const byteCharacters = atob(base64Data.split(',')[1]);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/png' });
            
            // Create download link
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `generated-image-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            console.log('📥 Image downloaded');
        } catch (error) {
            console.error('Error downloading image:', error);
            uiManager.showError('Failed to download image');
        }
    }

    // Copy image to clipboard
    async copyImageToClipboard(base64Data) {
        try {
            // Convert base64 to blob
            const response = await fetch(base64Data);
            const blob = await response.blob();
            
            // Copy to clipboard
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            
            uiManager.showSuccess('Image copied to clipboard');
            console.log('📋 Image copied to clipboard');
        } catch (error) {
            console.error('Error copying image:', error);
            uiManager.showError('Failed to copy image to clipboard');
        }
    }

    // Initialize file handling
    initializeFileHandling() {
        // Set up file input handler
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        // Set up drag and drop on main container
        const mainContainer = document.querySelector('.main-content');
        if (mainContainer) {
            mainContainer.addEventListener('dragover', (e) => this.handleDragOver(e));
            mainContainer.addEventListener('dragleave', (e) => this.handleDragLeave(e));
            mainContainer.addEventListener('drop', (e) => this.handleDrop(e));
        }

        // Set up global functions for HTML onclick handlers
        window.removeSelectedFile = (type, index) => this.removeSelectedFile(type, index);
        window.downloadImage = (base64Data, prompt) => this.downloadImage(base64Data, prompt);
        window.copyImageToClipboard = (base64Data) => this.copyImageToClipboard(base64Data);
    }
}

// Create singleton instance
export const fileManager = new FileManager();