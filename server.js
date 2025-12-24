const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const app = express();

app.use(express.json({ limit: '50mb' }));

const PUBLISH_DIR = '/var/www/published';

// Zorg dat de map bestaat
fs.ensureDirSync(PUBLISH_DIR);

let serverStatus = "Stopped";

// API: Publiceer bestanden
app.post('/api/publish', async (req, res) => {
    try {
        const { projectId, version, files } = req.body;
        
        // 1. Maak de map leeg voor een schone installatie
        await fs.emptyDir(PUBLISH_DIR);

// In server.js in de publish route:
for (const file of files) {
    const filePath = path.join(PUBLISH_DIR, file.name);
    await fs.outputFile(filePath, file.content);
    
    // Geef NGINX leesrechten (644 = eigenaar rw, groep r, rest r)
    await fs.chmod(filePath, 0o644); 
}

        serverStatus = "Running";
        console.log(`[Server] Project ${projectId} v${version} gepubliceerd.`);
        
        res.json({ 
            success: true, 
            message: `Project v${version} is nu live!`,
            url: `http://jouwserver.nl:8080` // De poort van de live site
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Stop de server
app.post('/api/stop-server', async (req, res) => {
    try {
        await fs.emptyDir(PUBLISH_DIR);
        serverStatus = "Stopped";
        console.log("[Server] Status handmatig op Stopped gezet.");
        res.json({ success: true, message: "Server gestopt" });
    } catch (err) {
        console.error("[Server] Fout bij stoppen:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Status opvragen (Robuuste versie)
app.get('/api/server-status', (req, res) => {
    // We sturen ook een timestamp mee om browser-caching van dit API verzoek te voorkomen
    res.set('Cache-Control', 'no-store');
    res.json({ 
        status: serverStatus,
        timestamp: new Date().getTime() 
    });
});

// Luister op 0.0.0.0 zodat hij ook via het lokale IP van de container/VPS bereikbaar is
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Publish API draait op http://0.0.0.0:${PORT}`);
});
