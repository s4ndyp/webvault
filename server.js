const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const app = express();

app.use(express.json({ limit: '50mb' }));

const PUBLISH_DIR = path.join(__dirname, 'published_site');

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

// API: Stop de server (maak de map leeg)
app.post('/api/stop-server', async (req, res) => {
    await fs.emptyDir(PUBLISH_DIR);
    serverStatus = "Stopped";
    res.json({ success: true, message: "Server gestopt" });
});

// API: Status opvragen
app.get('/api/server-status', (req, res) => {
    res.json({ status: serverStatus });
});

app.listen(5000, () => console.log('Publish API draait op poort 5000'));
