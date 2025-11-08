// --- DOM Elements ---
        const textInput = document.getElementById('text-input');
        const voiceSelect = document.getElementById('voice-select');
        const generateButton = document.getElementById('generate-button');
        const loadingSpinner = document.getElementById('loading-spinner');
        const buttonText = document.getElementById('button-text');
        const audioPlayer = document.getElementById('audio-player');
        const audioOutputDiv = document.getElementById('audio-output');
        const messageBox = document.getElementById('message-box');
        const charCountDisplay = document.getElementById('char-count');


        // --- Utility Functions for Audio Conversion (PCM -> WAV) ---

        /**
         * Converts a Base64 string to an ArrayBuffer.
         * @param {string} base64 - The base64 string.
         * @returns {ArrayBuffer}
         */
        function base64ToArrayBuffer(base64) {
            const binaryString = atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes.buffer;
        }

        /**
         * Helper to write a string into a DataView.
         * @param {DataView} view
         * @param {number} offset
         * @param {string} string
         */
        function writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        /**
         * Converts 16-bit PCM audio data (Int16Array) into a standard WAV Blob.
         * @param {Int16Array} pcm16 - The raw 16-bit signed PCM data.
         * @param {number} sampleRate - The audio sample rate (e.g., 24000).
         * @returns {Blob} The WAV audio Blob.
         */
        function pcmToWav(pcm16, sampleRate) {
            const numChannels = 1;
            const bitsPerSample = 16;
            const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
            const blockAlign = numChannels * (bitsPerSample / 8);
            const dataLength = pcm16.byteLength;
            const buffer = new ArrayBuffer(44 + dataLength);
            const view = new DataView(buffer);

            // RIFF chunk
            writeString(view, 0, 'RIFF'); // ChunkID (0-3)
            view.setUint32(4, 36 + dataLength, true); // ChunkSize (4-7)
            writeString(view, 8, 'WAVE'); // Format (8-11)

            // FMT sub-chunk
            writeString(view, 12, 'fmt '); // Subchunk1ID (12-15)
            view.setUint32(16, 16, true); // Subchunk1Size (16-19) - 16 for PCM
            view.setUint16(20, 1, true); // AudioFormat (20-21) - 1 for PCM
            view.setUint16(22, numChannels, true); // NumChannels (22-23)
            view.setUint32(24, sampleRate, true); // SampleRate (24-27)
            view.setUint32(28, byteRate, true); // ByteRate (28-31)
            view.setUint16(32, blockAlign, true); // BlockAlign (32-33)
            view.setUint16(34, bitsPerSample, true); // BitsPerSample (34-35)

            // DATA sub-chunk
            writeString(view, 36, 'data'); // Subchunk2ID (36-39)
            view.setUint32(40, dataLength, true); // Subchunk2Size (40-43)

            // Write PCM data
            const dataView = new DataView(pcm16.buffer);
            for (let i = 0; i < dataLength; i++) {
                view.setUint8(44 + i, dataView.getUint8(i));
            }

            return new Blob([buffer], { type: 'audio/wav' });
        }

        
        

        // --- UI Management ---

        /**
         * Displays a temporary message box.
         * @param {string} message - The message content.
         * @param {boolean} isError - True for error (red), false for success/info (green/blue).
         */
        function showMessage(message, isError = false) {
            messageBox.textContent = message;
            messageBox.classList.remove('hidden', 'bg-red-100', 'border-red-400', 'text-red-700', 'bg-green-100', 'border-green-400', 'text-green-700');
            messageBox.classList.add('block', isError ? 'bg-red-100' : 'bg-green-100', isError ? 'border-red-400' : 'border-green-400', isError ? 'text-red-700' : 'text-green-700');

            // Hide after 5 seconds
            setTimeout(() => {
                messageBox.classList.add('hidden');
            }, 5000);
        }

        /**
         * Sets the loading state of the button.
         * @param {boolean} isLoading
         */
        function setLoading(isLoading) {
            generateButton.disabled = isLoading;
            if (isLoading) {
                loadingSpinner.classList.remove('hidden');
                buttonText.textContent = 'Generating...';
                audioOutputDiv.classList.add('hidden');
            } else {
                loadingSpinner.classList.add('hidden');
                buttonText.textContent = 'Generate Audio';
            }
        }

        function checkInputAndEnableButton() {
            const text = textInput.value.trim();
            // generateButton.disabled = text.length === 0 || !isAuthReady;
        }

        // --- Core Gemini TTS API Logic ---

        /**
         * Calls the Gemini TTS API with exponential backoff.
         * @param {object} payload - The API request payload.
         * @returns {Promise<object|null>} The JSON response object or null on failure.
         */
        async function fetchWithBackoff(payload) {
            const apiKey = await decryptApiKey(localStorage.getItem("apiKey"), "Encc1234");
            if (!apiKey) {
                throw new Error("API key not found. Please refresh the page and enter your API key.");
            }
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
            const maxRetries = 5;
            let delay = 1000;

            for (let i = 0; i < maxRetries; i++) {
                try {
                    const response = await fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (response.ok) {
                        return await response.json();
                    } else if (response.status === 429 || response.status >= 500) {
                        // Rate limit or server error - retry
                        await new Promise(resolve => setTimeout(resolve, delay));
                        delay *= 2; // Exponential backoff
                        continue;
                    } else {
                        // Other client errors
                        const errorData = await response.json();
                        throw new Error(`API Error: ${response.status} - ${errorData.error?.message || response.statusText}`);
                    }
                } catch (error) {
                    console.error("Fetch attempt failed:", error);
                    // If it's the last retry, or a non-retryable error, throw it
                    if (i === maxRetries - 1 || error.message.startsWith('API Error')) {
                        throw error;
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                }
            }
            throw new Error("API call failed after multiple retries.");
        }


        /**
         * Handles the entire TTS generation and playback process.
         */
        async function generateSpeech() {
            const text = textInput.value.trim();
            const voiceName = voiceSelect.value;

            if (!text) {
                showMessage("Please enter some text to generate speech.", true);
                return;
            }
            // if (!isAuthReady) {
            //     showMessage("Application is still initializing. Please wait.", true);
            //     return;
            // }

            setLoading(true);

            // Optional: Inject speech style guidance for better results
            const stylePrompt = textInput.value.includes('?')
                ? `Say excitedly: ${text}`
                : `Say clearly: ${text}`;

            const payload = {
                contents: [{
                    parts: [{ text: stylePrompt }]
                }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voiceName }
                        }
                    }
                },
                // Explicitly set model for the TTS call
                model: "gemini-2.5-flash-preview-tts"
            };

            try {
                const result = await fetchWithBackoff(payload);

                const part = result?.candidates?.[0]?.content?.parts?.[0];
                const audioData = part?.inlineData?.data;
                const mimeType = part?.inlineData?.mimeType;

                if (audioData && mimeType && mimeType.startsWith("audio/L16")) {
                    // 1. Extract sample rate from mimeType string (e.g., audio/L16;rate=24000)
                    const rateMatch = mimeType.match(/rate=(\d+)/);
                    if (!rateMatch || rateMatch.length < 2) {
                        throw new Error("Could not determine sample rate from API response.");
                    }
                    const sampleRate = parseInt(rateMatch[1], 10);

                    // 2. Convert base64 to raw PCM data
                    const pcmData = base64ToArrayBuffer(audioData);
                    const pcm16 = new Int16Array(pcmData);

                    // 3. Convert raw PCM to a playable WAV Blob
                    const wavBlob = pcmToWav(pcm16, sampleRate);
                    const audioUrl = URL.createObjectURL(wavBlob);

                    // 4. Update the audio player
                    audioPlayer.src = audioUrl;
                    audioPlayer.load();
                    audioPlayer.play();

                    audioOutputDiv.classList.remove('hidden');
                    showMessage(`Speech generated successfully using voice: ${voiceName}!`, false);

                } else {
                    throw new Error("API response missing audio data or invalid format.");
                }

            } catch (error) {
                console.error("TTS generation failed:", error);
                showMessage(`Failed to generate speech: ${error.message || "An unknown error occurred."}`, true);
                audioOutputDiv.classList.add('hidden');
                audioPlayer.src = '';
            } finally {
                setLoading(false);
            }

            textInput.value = '';
        }

        // --- Event Listeners ---

        // Update character count and enable/disable button on input
        textInput.addEventListener('input', () => {
            const currentLength = textInput.value.length;
            charCountDisplay.textContent = `${currentLength}/500 characters`;
            checkInputAndEnableButton();
        });

        generateButton.addEventListener('click', generateSpeech);

    // --- Initialization ---
        window.onload = async function () {
            // Check if API key exists in localStorage
            let apiKey = localStorage.getItem("apiKey");
           
            
            if (!apiKey) {
                // Prompt for API key if not found
                apiKey = prompt("Please enter your Gemini API key: ");
                if (apiKey) {
                    const encrypted = await encryptApiKey(apiKey, "Encc1234");
                    //Save encrypted to localStorage
                    localStorage.setItem('apiKey', encrypted);
                    
                    showMessage("API key saved successfully!", false);  
                } else {
                    showMessage("No API key provided. Voice generation will not work.", true);
                }
            }
            
        };