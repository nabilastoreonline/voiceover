const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// Middleware
app.use(cors()); // Izinkan permintaan dari domain frontend (GitHub Pages atau Localhost)
app.use(express.json());

/**
 * Konfigurasi API
 * Ganti API_KEY dengan kunci yang valid jika diperlukan
 */
const API_KEY = "AIzaSyCijOKszthaZ6lawhfBDWJrIPKSXnS_oq4";
const PORT = process.env.PORT || 3000;

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
 * Endpoint: Generate Naskah Berita
 * Mengambil data fakta dari frontend dan mengembalikan struktur naskah JSON
 */
app.post('/api/generate-news', async (req, res) => {
    const { topic, facts, style } = req.body;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;

    const payload = {
        contents: [{ 
            parts: [{ text: `Topik: ${topic}. Fakta: ${facts}. Gaya: ${style}` }] 
        }],
        systemInstruction: { 
            parts: [{ text: "Kamu adalah penulis naskah berita TV profesional. Buat respons dalam format JSON murni: {headline, lead, body, closing}. Gunakan Bahasa Indonesia yang baku dan lugas." }] 
        },
        generationConfig: { 
            responseMimeType: "application/json" 
        }
    };

    try {
        const response = await fetchWithRetry(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        if (data.error) {
            return res.status(data.error.code || 500).json({ error: data.error.message });
        }
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Terjadi kesalahan pada server saat menghubungi AI." });
    }
});

/**
 * Endpoint: Generate TTS (Audio)
 * Mengonversi naskah menjadi audio dalam format PCM
 */
app.post('/api/generate-tts', async (req, res) => {
    const { text, voice } = req.body;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${API_KEY}`;

    const payload = {
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: text }] }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { 
                voiceConfig: { 
                    prebuiltVoiceConfig: { voiceName: voice || "Charon" } 
                } 
            }
        }
    };

    try {
        const response = await fetchWithRetry(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.error) {
            return res.status(data.error.code || 500).json({ error: data.error.message });
        }

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Gagal memproses audio berita." });
    }
});

// Jalankan Server
app.listen(PORT, () => {
    console.log(`============================================`);
    console.log(` AI News Anchor Backend is Running!`);
    console.log(` URL   : http://localhost:${PORT}`);
    console.log(`============================================`);
});
