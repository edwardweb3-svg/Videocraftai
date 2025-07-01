/// <reference lib="dom" />

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { marked } from 'marked';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

// --- INTERFACES ---
interface Message {
  id: number;
  role: 'user' | 'bot';
  text: string;
  videoScript?: VideoScript;
}

interface Scene {
  narration: string;
  image_prompt: string;
  generatedImage?: string; // base64 string
}

interface VideoScript {
  scenes: Scene[];
}

// --- HELPER ICONS & SPINNER ---
const IconBot = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5.5C12.41 5.5 12.75 5.84 12.75 6.25V7.25C12.75 7.66 12.41 8 12 8C11.59 8 11.25 7.66 11.25 7.25V6.25C11.25 5.84 11.59 5.5 12 5.5ZM7.25 11.25H6.25C5.84 11.25 5.5 11.59 5.5 12C5.5 12.41 5.84 12.75 6.25 12.75H7.25C7.66 12.75 8 12.41 8 12C8 11.59 7.66 11.25 7.25 11.25ZM17.75 11.25H16.75C16.34 11.25 16 11.59 16 12C16 12.41 16.34 12.75 16.75 12.75H17.75C18.16 12.75 18.5 12.41 18.5 12C18.5 11.59 18.16 11.25 17.75 11.25ZM20 12C20 16.42 16.42 20 12 20C7.58 20 4 16.42 4 12C4 7.58 7.58 4 12 4C12.75 4 13.5 4.1 14.19 4.3C14.73 4.45 15.22 4.93 15.22 5.5C15.22 6.13 14.67 6.64 14.05 6.5C13.44 6.3 12.75 6.16 12 6.16C8.78 6.16 6.16 8.78 6.16 12C6.16 15.22 8.78 17.84 12 17.84C15.22 17.84 17.84 15.22 17.84 12C17.84 11.25 17.7 10.56 17.5 9.95C17.36 9.33 17.87 8.78 18.5 8.78C19.07 8.78 19.55 9.27 19.7 9.81C19.9 10.5 20 11.25 20 12Z" fill="currentColor"/></svg>;
const IconUser = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" fill="currentColor"/></svg>;
const IconSend = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.01 21L23 12L2.01 3L2 10L17 12L2 14L2.01 21Z" fill="currentColor"/></svg>;
const IconVideo = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17 10.5V7C17 6.45 16.55 6 16 6H4C3.45 6 3 6.45 3 7V17C3 17.55 3.45 18 4 18H16C16.55 18 17 17.55 17 17V13.5L21 17.5V6.5L17 10.5Z" fill="currentColor"/></svg>;
const IconDownload = () => <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>;
const Spinner = () => <div className="spinner"></div>;


// --- VIDEO PLAYER MODAL ---
const VideoPlayerModal: React.FC<{ script: VideoScript; onClose: () => void; }> = ({ script, onClose }) => {
    const [generationStatus, setGenerationStatus] = useState('Initializing...');
    const [isGenerating, setIsGenerating] = useState(true);
    const [processedScenes, setProcessedScenes] = useState<Scene[]>([]);
    const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playerError, setPlayerError] = useState<string | null>(null);
    const [animationState, setAnimationState] = useState({ key: 0, style: {} });
    const [isEncoding, setIsEncoding] = useState(false);
    const [encodingProgress, setEncodingProgress] = useState(0);

    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
    const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
    const ffmpegRef = useRef(new FFmpeg());
    const animationClasses = ['ken-burns-top-left', 'ken-burns-top-right', 'ken-burns-bottom-left', 'ken-burns-bottom-right'];
    const SCENE_DURATION = 5; // 5 seconds

    // Function to select a higher-quality voice
    useEffect(() => {
        const setVoice = () => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length === 0) return;
            
            voiceRef.current = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) ||
                               voices.find(v => v.lang.startsWith('en') && v.name.includes('Microsoft')) ||
                               voices.find(v => v.lang.startsWith('en') && !v.localService) ||
                               voices.find(v => v.lang === 'en-US') || voices[0];
            
            window.speechSynthesis.onvoiceschanged = null; // Clean up listener
        };
        setVoice();
        if (!voiceRef.current) {
            window.speechSynthesis.onvoiceschanged = setVoice;
        }
        return () => { window.speechSynthesis.onvoiceschanged = null; };
    }, []);

    const generateImages = useCallback(async () => {
        setIsGenerating(true);
        setGenerationStatus(`Generating ${script.scenes.length} images...`);
        const newScenes: Scene[] = [];

        for (let i = 0; i < script.scenes.length; i++) {
            const scene = script.scenes[i];
            setGenerationStatus(`Generating image for scene ${i + 1}/${script.scenes.length}...`);
            try {
                 const res = await fetch('/api/gemini', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'image',
                        payload: { prompt: scene.image_prompt }
                    }),
                });

                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.error?.message || 'Failed to generate image.');
                }
                const data = await res.json();
                newScenes.push({ ...scene, generatedImage: `data:image/jpeg;base64,${data.image}` });
            } catch (error: any) {
                console.error(`Image generation failed for scene ${i + 1}:`, error);
                setPlayerError(`Image generation failed for scene ${i + 1}: ${error.message}. The video may be incomplete.`);
                newScenes.push({ ...scene, generatedImage: '' }); // Add empty scene to keep order
            }
        }
        
        setProcessedScenes(newScenes);
        setIsGenerating(false);
        setGenerationStatus('Ready to play');
    }, [script.scenes]);

    const handlePlay = () => {
        setIsPlaying(true);
        setCurrentSceneIndex(0);
        setPlayerError(null);
    };

    const handleClose = useCallback(() => {
        window.speechSynthesis.cancel();
        setIsPlaying(false);
        if (ffmpegRef.current.loaded) {
          ffmpegRef.current.terminate();
        }
        onClose();
    }, [onClose]);

    useEffect(() => {
        generateImages();
        return () => {
            window.speechSynthesis.cancel();
        };
    }, [generateImages]);

    useEffect(() => {
        if (isPlaying && currentSceneIndex < processedScenes.length) {
            const scene = processedScenes[currentSceneIndex];
            
            const animationClass = animationClasses[currentSceneIndex % animationClasses.length];
            setAnimationState({
                key: currentSceneIndex,
                style: { animation: `${animationClass} ${SCENE_DURATION}s ease-in-out forwards` }
            });

            const utterance = new SpeechSynthesisUtterance(scene.narration);
            if (voiceRef.current) utterance.voice = voiceRef.current;
            utteranceRef.current = utterance;
            
            utterance.onend = () => {
                if (currentSceneIndex < processedScenes.length - 1) {
                    setCurrentSceneIndex(prev => prev + 1);
                } else {
                    setIsPlaying(false);
                    setGenerationStatus('Finished');
                }
            };
            utterance.onerror = (e) => {
                const errorEvent = e as SpeechSynthesisErrorEvent;
                if (errorEvent.error === 'interrupted') {
                    console.log('Speech synthesis was interrupted intentionally.');
                    setIsPlaying(false);
                    return;
                }
                console.error("Speech synthesis error:", errorEvent.error);
                setPlayerError(`Speech synthesis failed: ${errorEvent.error}. Your browser might not support it.`);
                setIsPlaying(false);
            };
            window.speechSynthesis.speak(utterance);
        }
    }, [isPlaying, currentSceneIndex, processedScenes]);

    const handleDownloadMp4 = async () => {
        if (!processedScenes.length || isEncoding) return;
        setIsEncoding(true);
        setEncodingProgress(0);
        setPlayerError(null);

        try {
            const ffmpeg = ffmpegRef.current;
            const baseURL = "https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd";

            ffmpeg.on('log', ({ message }) => { console.log(message); });
            ffmpeg.on('progress', ({ progress }) => { setEncodingProgress(Math.round(progress * 100)); });
            
            setGenerationStatus('Loading video engine...');
            await ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
                workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
            });
    
            setGenerationStatus('Preparing assets...');
            for (let i = 0; i < processedScenes.length; i++) {
                const scene = processedScenes[i];
                const imageName = `scene_${String(i + 1).padStart(2, '0')}.jpeg`;
                if (scene.generatedImage) {
                    await ffmpeg.writeFile(imageName, new Uint8Array(await (await fetch(scene.generatedImage)).arrayBuffer()));
                }
            }
    
            const formatTime = (totalSeconds: number) => {
                const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
                const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
                const seconds = (totalSeconds % 60).toFixed(3).replace('.', ',').padStart(6, '0');
                return `${hours}:${minutes}:${seconds}`;
            };
            let srtContent = '';
            processedScenes.forEach((scene, i) => {
                const startTime = i * SCENE_DURATION;
                const endTime = (i + 1) * SCENE_DURATION;
                srtContent += `${i + 1}\n${formatTime(startTime)} --> ${formatTime(endTime)}\n${scene.narration}\n\n`;
            });
            await ffmpeg.writeFile('subtitles.srt', srtContent);
    
            setGenerationStatus('Encoding video... This can take a minute.');
            const totalDuration = processedScenes.length * SCENE_DURATION;
            
            await ffmpeg.exec([
                '-framerate', `1/${SCENE_DURATION}`,
                '-i', 'scene_%02d.jpeg',
                '-vf', `zoompan=z='min(zoom+0.0015,1.5)':d=${SCENE_DURATION * 25}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720,subtitles=subtitles.srt,format=yuv420p`,
                '-c:v', 'libx264',
                '-t', totalDuration.toString(),
                '-movflags', '+faststart',
                'output.mp4'
            ]);
    
            setGenerationStatus('Finalizing...');
            const data = await ffmpeg.readFile('output.mp4');
            const url = URL.createObjectURL(new Blob([(data as Uint8Array).buffer], { type: 'video/mp4' }));
    
            const a = document.createElement('a');
            a.href = url;
            a.download = 'explanation_video.mp4';
            a.click();
            URL.revokeObjectURL(url);
            
            setGenerationStatus('Download started!');
        } catch (err: any) {
            console.error("MP4 generation failed:", err);
            setPlayerError(`Failed to create MP4. Please ensure your browser supports the necessary features.`);
        } finally {
            setIsEncoding(false);
            if (ffmpegRef.current.loaded) {
                ffmpegRef.current.terminate();
                ffmpegRef.current = new FFmpeg();
            }
        }
    };

    const currentScene = processedScenes[currentSceneIndex];

    return (
        <div className="modal-backdrop" onClick={handleClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button className="modal-close-btn" onClick={handleClose}>&times;</button>
                <div className="video-player">
                    <div className="video-viewport">
                        {isGenerating ? (
                            <div className="video-status"><Spinner /><p>{generationStatus}</p></div>
                        ) : currentScene?.generatedImage ? (
                            <img key={animationState.key} src={currentScene.generatedImage} alt={currentScene.image_prompt} style={animationState.style} />
                        ) : (
                            <div className="video-status"><p>Image not available</p></div>
                        )}
                    </div>
                    <div className="video-controls">
                        {isEncoding ? (
                            <div className="encoding-status">
                                <p>{generationStatus} ({encodingProgress}%)</p>
                                <div className="progress-bar-container">
                                    <div className="progress-bar" style={{ width: `${encodingProgress}%` }}></div>
                                </div>
                            </div>
                        ) : isGenerating ? (
                             <p>{generationStatus}</p>
                        ) : !isPlaying ? (
                            <>
                                <button className="play-btn" onClick={handlePlay}>
                                    {generationStatus === 'Finished' ? 'Replay Animation' : 'Play Animation'}
                                </button>
                                <button className="download-btn" onClick={handleDownloadMp4} disabled={isEncoding}>
                                    <IconDownload /> Download MP4
                                </button>
                            </>
                        ) : (
                             <p>Playing scene {currentSceneIndex + 1}/{processedScenes.length}...</p>
                        )}
                    </div>
                    {playerError && <div className="player-error" role="alert">{playerError}</div>}
                    {currentScene && <div className="narration-text">{currentScene.narration}</div>}
                </div>
            </div>
        </div>
    );
};

// --- MAIN APP COMPONENT ---
const App = () => {
    const [messages, setMessages] = useState<Message[]>([
        {id: 1, role: 'bot', text: 'Hello! Ask me to "make a video" about a topic to see an animated explanation.'}
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showVideoPlayer, setShowVideoPlayer] = useState(false);
    const [videoToPlay, setVideoToPlay] = useState<VideoScript | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js').then(reg => console.log('SW registered.', reg), err => console.error('SW registration failed:', err));
            });
        }
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);
    
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage: Message = { id: Date.now(), role: 'user', text: input };
        setMessages(prev => [...prev, userMessage]);
        const currentInput = input;
        setInput('');
        setIsLoading(true);
        setError(null);
        
        try {
            // Prepare chat history for the API
            const history = messages
              .filter(m => m.id !== 1) // Exclude initial bot message
              .map(msg => ({
                role: msg.role === 'bot' ? 'model' : 'user',
                // Send only the text part, not the video script object
                parts: [{ text: msg.text }] 
              }));

            const res = await fetch('/api/gemini', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'chat',
                    payload: {
                        message: currentInput,
                        history: history,
                    }
                })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error?.message || 'The request failed.');
            }

            const data = await res.json();
            const responseText = data.text;
            
            let videoScript: VideoScript | null = null;
            try {
                let jsonStr = responseText.trim();
                const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
                const match = jsonStr.match(fenceRegex);
                if (match && match[2]) {
                  jsonStr = match[2].trim();
                }
                const parsedJson = JSON.parse(jsonStr);
                if (parsedJson.scenes && Array.isArray(parsedJson.scenes) && parsedJson.scenes.every((s: any) => s.narration && s.image_prompt)) {
                    videoScript = parsedJson;
                }
            } catch (parseError) {
                // Not a JSON response, which is expected for normal chat
            }

            const botMessage: Message = {
                id: Date.now() + 1,
                role: 'bot',
                text: videoScript ? "I've prepared an animated explanation for you. Click the button to generate and watch." : responseText,
                videoScript: videoScript ?? undefined,
            };
            setMessages(prev => [...prev, botMessage]);

        } catch (e: any) {
            console.error(e);
            const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
            setError(`API Error: ${errorMessage}`);
            setMessages(prev => [...prev, { id: Date.now() + 1, role: 'bot', text: `Sorry, I encountered an error: ${errorMessage}` }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePlayVideo = (script: VideoScript) => {
        setVideoToPlay(script);
        setShowVideoPlayer(true);
    };

    const sanitizedHtml = (text: string) => ({ __html: marked.parse(text) });

    return (
        <>
            <div className="chat-container">
                <header className="chat-header">
                    <h1>Gemini Video Explainer</h1>
                    <p>Your AI-powered chat and video creation assistant</p>
                </header>

                <main className="chat-messages" aria-live="polite">
                    {messages.map(msg => (
                        <div key={msg.id} className={`message-wrapper ${msg.role}`}>
                            <div className="avatar">{msg.role === 'bot' ? <IconBot /> : <IconUser />}</div>
                            <div className="message-content">
                                 <div className="prose" dangerouslySetInnerHTML={sanitizedHtml(msg.text)} />
                                {msg.role === 'bot' && msg.videoScript && (
                                    <button className="video-button" onClick={() => handlePlayVideo(msg.videoScript!)}>
                                        <IconVideo />
                                        <span>Create Animated Explanation</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                         <div className="message-wrapper bot">
                            <div className="avatar"><IconBot /></div>
                            <div className="message-content">
                                <div className="typing-indicator">
                                    <span></span><span></span><span></span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </main>
                
                {error && <div className="error-banner" role="alert">{error}</div>}

                <footer className="chat-input-area">
                    <form onSubmit={handleSendMessage} className="input-form">
                        <input
                            type="text"
                            value={input}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
                            placeholder="Ask to make a video about..."
                            aria-label="Chat input"
                            disabled={isLoading}
                        />
                        <button type="submit" disabled={isLoading || !input.trim()} aria-label="Send message">
                           {isLoading ? <Spinner /> : <IconSend />}
                        </button>
                    </form>
                </footer>
            </div>
            {showVideoPlayer && videoToPlay && (
                <VideoPlayerModal 
                    script={videoToPlay} 
                    onClose={() => setShowVideoPlayer(false)} 
                />
            )}
        </>
    );
};

// --- STYLES ---
const styles = `
:root {
  --background-dark: #131316;
  --surface-dark: #1E1E21;
  --primary: #8E64FF;
  --primary-hover: #A07EFF;
  --on-primary: #FFFFFF;
  --text-primary: #EAEAEA;
  --text-secondary: #9E9E9E;
  --border-color: #333338;
  --font-body: 'Inter', sans-serif;
  --font-heading: 'Space Grotesk', sans-serif;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body, #root {
  height: 100%;
}

body {
  background-color: var(--background-dark);
  color: var(--text-primary);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow: hidden;
}

#root {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem;
}

.chat-container {
  width: 100%;
  max-width: 800px;
  height: 100%;
  max-height: 95vh;
  background-color: var(--surface-dark);
  border-radius: 16px;
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0,0,0,0.2);
}

.chat-header {
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
  text-align: center;
}

.chat-header h1 {
  font-family: var(--font-heading);
  font-size: 1.75rem;
  color: var(--text-primary);
}

.chat-header p {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.chat-messages {
  flex-grow: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.message-wrapper {
  display: flex;
  gap: 1rem;
  max-width: 85%;
}

.message-wrapper.user {
  margin-left: auto;
  flex-direction: row-reverse;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.message-wrapper.user .avatar {
    background-color: var(--primary);
    color: var(--on-primary);
}

.message-content {
  background-color: var(--background-dark);
  padding: 1rem;
  border-radius: 12px;
  border-top-left-radius: 0;
}

.message-wrapper.user .message-content {
  background-color: var(--primary);
  color: var(--on-primary);
  border-top-left-radius: 12px;
  border-top-right-radius: 0;
}
.message-wrapper.user .message-content .prose a {
  color: var(--on-primary);
  text-decoration: underline;
}

.prose {
  line-height: 1.6;
}
.prose p { margin-bottom: 0.5em; }
.prose ul, .prose ol { margin-left: 1.5em; margin-bottom: 0.5em; }
.prose strong { font-weight: 600; }
.prose a { color: var(--primary-hover); }
.prose code { 
    background-color: rgba(255,255,255,0.1); 
    padding: 0.2em 0.4em;
    border-radius: 4px;
    font-family: monospace;
}
.prose pre { 
    background-color: rgba(0,0,0,0.3); 
    padding: 1em;
    border-radius: 8px;
    overflow-x: auto;
}

.video-button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    padding: 0.6rem 1rem;
    background-color: var(--primary);
    color: var(--on-primary);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 500;
    transition: background-color 0.2s ease;
}
.message-wrapper.user .video-button {
    background-color: var(--on-primary);
    color: var(--primary);
}
.video-button:hover {
    background-color: var(--primary-hover);
}
.message-wrapper.user .video-button:hover {
    background-color: #eee;
}

.chat-input-area {
  padding: 1rem;
  border-top: 1px solid var(--border-color);
  background-color: var(--background-dark);
}

.input-form {
  display: flex;
  gap: 0.5rem;
}

.input-form input {
  flex-grow: 1;
  background-color: var(--surface-dark);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  color: var(--text-primary);
  font-size: 1rem;
  outline: none;
  transition: border-color 0.2s ease;
}

.input-form input:focus {
  border-color: var(--primary);
}
.input-form input:disabled {
    background-color: #2a2a2f;
    opacity: 0.6;
}

.input-form button {
  width: 48px;
  height: 48px;
  border: none;
  background-color: var(--primary);
  color: var(--on-primary);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
  flex-shrink: 0;
}

.input-form button:hover:not(:disabled) {
  background-color: var(--primary-hover);
}

.input-form button:disabled {
  background-color: #555;
  cursor: not-allowed;
  opacity: 0.6;
}

.error-banner {
    background-color: #B00020;
    color: white;
    padding: 0.75rem 1.5rem;
    font-size: 0.9rem;
    text-align: center;
    font-weight: 500;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: #fff;
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.typing-indicator span {
  height: 8px;
  width: 8px;
  float: left;
  margin: 0 2px;
  background-color: var(--text-secondary);
  display: block;
  border-radius: 50%;
  opacity: 0.4;
  animation: bob 1s infinite;
}
.typing-indicator span:nth-of-type(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-of-type(3) { animation-delay: 0.4s; }

@keyframes bob {
  50% { opacity: 1; transform: translateY(-4px); }
}

.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background-color: var(--surface-dark);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 2rem;
  width: 90%;
  max-width: 800px;
  position: relative;
  box-shadow: 0 10px 40px rgba(0,0,0,0.4);
}

.modal-close-btn {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 2rem;
  cursor: pointer;
  line-height: 1;
}

.video-player {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.video-viewport {
  width: 100%;
  aspect-ratio: 16 / 9;
  background-color: var(--background-dark);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.video-viewport img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1);
}

.video-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  color: var(--text-secondary);
}

.video-controls {
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  min-height: 44px; /* prevent layout shifts */
}

.video-controls .play-btn, .video-controls .download-btn {
  padding: 0.8rem 1.5rem;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s ease, opacity 0.2s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  text-decoration: none;
}
.video-controls .play-btn {
  background-color: var(--primary);
  color: var(--on-primary);
}
.video-controls .download-btn {
  background-color: var(--surface-dark);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}
.video-controls .play-btn:hover:not(:disabled) {
  background-color: var(--primary-hover);
}
.video-controls .download-btn:hover:not(:disabled) {
  background-color: var(--border-color);
}
.video-controls .play-btn:disabled, .video-controls .download-btn:disabled {
  background-color: #555;
  cursor: not-allowed;
  opacity: 0.6;
}

.narration-text {
  text-align: center;
  color: var(--text-secondary);
  font-style: italic;
  min-height: 2.5em;
  line-height: 1.4;
}

.player-error {
  color: #ff8a80;
  background-color: rgba(255, 138, 128, 0.1);
  border: 1px solid rgba(255, 138, 128, 0.3);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin: 0.5rem 0 0;
  text-align: center;
  font-size: 0.9rem;
}

.encoding-status {
  width: 100%;
  max-width: 300px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  color: var(--text-secondary);
}

.progress-bar-container {
  width: 100%;
  height: 8px;
  background-color: var(--background-dark);
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar {
  width: 0%;
  height: 100%;
  background-color: var(--primary);
  border-radius: 4px;
  transition: width 0.3s ease-in-out;
}

@keyframes ken-burns-top-left {
  from { transform-origin: top left; transform: scale(1); }
  to { transform-origin: top left; transform: scale(1.2); }
}
@keyframes ken-burns-top-right {
  from { transform-origin: top right; transform: scale(1); }
  to { transform-origin: top right; transform: scale(1.2); }
}
@keyframes ken-burns-bottom-left {
  from { transform-origin: bottom left; transform: scale(1); }
  to { transform-origin: bottom left; transform: scale(1.2); }
}
@keyframes ken-burns-bottom-right {
  from { transform-origin: bottom right; transform: scale(1); }
  to { transform-origin: bottom right; transform: scale(1.2); }
}

`;

// --- RENDER APP ---
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
    <React.StrictMode>
        <style>{styles}</style>
        <App />
    </React.StrictMode>
);