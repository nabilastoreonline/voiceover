const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors()); // Izinkan permintaan dari domain frontend (GitHub Pages atau Localhost)
app.use(express.json({ limit: '10mb' })); // Tambah limit untuk file audio besar
app.use(express.urlencoded({ limit: '10mb', extended: true }));

/**
 * Konfigurasi API
 * Gunakan environment variable untuk keamanan
 */
const API_KEY = process.env.GOOGLE_API_KEY;
const PORT = process.env.PORT || 3000;

// Validasi API Key
if (!API_KEY) {
    console.error('ERROR: GOOGLE_API_KEY tidak ditemukan di environment variables!');
    console.error('Silakan set variable GOOGLE_API_KEY di file .env atau environment');
    process.exit(1);
}

/**
 * Fungsi Pembantu: Validasi Input
 */
function validateInput(input, maxLength = 2000) {
    if (!input || typeof input !== 'string') {
        return null;
    }
    // Hapus whitespace berlebih dan batasi panjang
    const cleaned = input.trim().substring(0, maxLength);
    return cleaned.length > 0 ? cleaned : null;
}

/**
 * Middleware: Rate Limiting (Simple In-Memory)
 */
const requestCounts = new Map();
const RATE_LIMIT = 10; // 10 requests per minute per IP
const RATE_WINDOW = 60000; // 1 menit

function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!requestCounts.has(ip)) {
        requestCounts.set(ip, []);
    }
    
    const timestamps = requestCounts.get(ip).filter(t => now - t < RATE_WINDOW);
    
    if (timestamps.length >= RATE_LIMIT) {
        return res.status(429).json({ 
            error: "Terlalu banyak permintaan. Silakan coba lagi dalam beberapa saat." 
        });
    }
    
    timestamps.push(now);
    requestCounts.set(ip, timestamps);
    
    // Bersihkan entry lama setiap 5 menit
    if (Math.random() < 0.1) {
        for (let [key, times] of requestCounts.entries()) {
            const active = times.filter(t => now - t < RATE_WINDOW);
            if (active.length === 0) {
                requestCounts.delete(key);
            } else {
                requestCounts.set(key, active);
            }
        }
    }
    
    next();
}

app.use(rateLimitMiddleware);

/**
 * Fungsi Pembantu: Fetch dengan Exponential Backoff
 * Digunakan untuk mencoba ulang permintaan jika terjadi rate limit (error 429)
 */
async function fetchWithRetry(url, options, retries = 5, backoff = 1000) {
    try {
        const response = await fetch(url, options);
        if (response.ok) return response;

        if (retries > 0 && (response.status === 429 || response.status >= 500)) {
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        return response;
    } catch (err) {
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        throw err;
    }
}

/**
 * Endpoint: Health Check
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Endpoint: Generate Naskah Berita
 * Mengambil data fakta dari frontend dan mengembalikan struktur naskah JSON
 */
app.post('/api/generate-news', async (req, res) => {
    try {
        const { topic, facts, style } = req.body;
        
        // Validasi input
        const validTopic = validateInput(topic, 500);
        const validFacts = validateInput(facts, 2000);
        const validStyle = validateInput(style, 100);
        
        if (!validTopic || !validFacts || !validStyle) {
            return res.status(400).json({ 
                error: "Input tidak valid. Topic, facts, dan style tidak boleh kosong." 
            });
        }
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;

        const payload = {
            contents: [{ 
                parts: [{ text: `Topik: ${validTopic}. Fakta: ${validFacts}. Gaya: ${validStyle}` }] 
            }],
            systemInstruction: { 
                parts: [{ text: "Kamu adalah penulis naskah berita TV profesional. Buat respons dalam format JSON murni: {headline, lead, body, closing}. Gunakan Bahasa Indonesia yang baku dan lugas." }] 
            },
            generationConfig: { 
                responseMimeType: "application/json" 
            }
        };

        const response = await fetchWithRetry(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        if (data.error) {
            console.error('Gemini API Error:', data.error);
            return res.status(data.error.code || 500).json({ 
                error: data.error.message || "Terjadi kesalahan pada AI API." 
            });
        }
        
        res.json(data);
    } catch (error) {
        console.error('Generate News Error:', error);
        res.status(500).json({ 
            error: "Terjadi kesalahan pada server saat menghubungi AI." 
        });
    }
});

/**
 * Endpoint: Generate TTS (Audio)
 * Mengonversi naskah menjadi audio dalam format PCM
 */
app.post('/api/generate-tts', async (req, res) => {
    try {
        const { text, voice } = req.body;
        
        // Validasi input
        const validText = validateInput(text, 5000);
        if (!validText) {
            return res.status(400).json({ 
                error: "Text tidak boleh kosong." 
            });
        }
        
        // Validasi voice parameter
        const validVoice = voice ? validateInput(voice, 50) : "Charon";
        const allowedVoices = ["Charon", "Puck", "Breeze", "Juniper", "Ember", "Alloy"];
        
        if (!allowedVoices.includes(validVoice)) {
            return res.status(400).json({ 
                error: `Voice tidak valid. Gunakan salah satu: ${allowedVoices.join(', ')}` 
            });
        }
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${API_KEY}`;

        const payload = {
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: validText }] }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: { 
                    voiceConfig: { 
                        prebuiltVoiceConfig: { voiceName: validVoice } 
                    } 
                }
            }
        };

        const response = await fetchWithRetry(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.error) {
            console.error('Gemini TTS Error:', data.error);
            return res.status(data.error.code || 500).json({ 
                error: data.error.message || "Gagal memproses audio berita." 
            });
        }

        res.json(data);
    } catch (error) {
        console.error('Generate TTS Error:', error);
        res.status(500).json({ 
            error: "Gagal memproses audio berita." 
        });
    }
});

/**
 * Error Handler untuk route yang tidak ditemukan
 */
app.use((req, res) => {
    res.status(404).json({ 
        error: "Endpoint tidak ditemukan." 
    });
});

/**
 * Global Error Handler
 */
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ 
        error: "Internal server error. Silakan coba lagi." 
    });
});

// Jalankan Server
app.listen(PORT, () => {
    console.log(`============================================`);
    console.log(` AI News Anchor Backend is Running!`);
    console.log(` URL   : http://localhost:${PORT}`);
    console.log(` Health: http://localhost:${PORT}/health`);
    console.log(`============================================`);
});
