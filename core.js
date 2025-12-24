

// ============================================
// CONFIGURATIE - PAS DEZE VARIABELEN AAN!
// ============================================
const API_URL = 'http://10.10.2.20:5000';  // Backend API URL
const CLIENT_ID = 'sandman';                 // Unieke gebruiker ID
const APP_NAME = 'sitebuilder';              // App naam voor collectie-prefix
const PUBLISH_API = window.location.origin;

// ============================================
// OFFLINE MANAGER INITIALISATIE
// ============================================
let manager = null;

async function initManager() {
    if (!manager) {
        manager = new OfflineManager(API_URL, CLIENT_ID, APP_NAME);
        console.log(`[Manager] Geïnitialiseerd: ${APP_NAME} @ ${API_URL} (Client: ${CLIENT_ID})`);
        
        // Sync outbox wanneer verbinding hersteld
        window.addEventListener('online', async () => {
            console.log('[Manager] Verbinding hersteld, syncing...');
            await manager.syncOutbox();
            await refreshProjectList();
        });
        
        // Auto-refresh elke 60 seconden (actieve sync)
// --- PAS DE setInterval AAN IN initManager ---
setInterval(async () => {
    // Voeg een extra check toe: alleen refreshen als we niet net handmatig gestopt zijn
    // en als de pagina nog steeds zichtbaar is (bespaart ook resources)
    if (navigator.onLine && manager && publishStatus.value !== 'Stopping...') {
        console.log('[Manager] Automatische cache refresh...');
        await manager.refreshCache('projects');
        
        // Roep alleen de status check aan als de server NIET handmatig gestopt is
        if (publishStatus.value !== 'Stopped') {
            await checkServerStatus();
        }
    }
}, 60000); // 60 seconden

// ============================================
// VUE APP
// ============================================
const { createApp, ref, computed, onMounted, onUnmounted, watch, nextTick } = Vue;

createApp({
    setup() {
        // STATE
        const isLoading = ref(false);
        const showNewProjectModal = ref(false);
        const newProjectName = ref('');
        const projectNameInput = ref(null);
        const fileInput = ref(null);
        const editorContainer = ref(null);
        let editorInstance = null;

        const viewMode = ref('split');
        const previewContent = ref('');
        const projectList = ref([]);
        const projectActive = ref(false);
        const currentProjectId = ref(null);
        const currentProjectName = ref('');
        const currentVersion = ref(0);
        const highestVersion = ref(0);
        const activeFileName = ref(null);
        const showHistoryModal = ref(false);
        const showMobileMenu = ref(false);
        const savedMessage = ref('');
        const currentTime = ref(Date.now());
        const files = ref([]);
        const history = ref([]);
        const expandedProjectId = ref(null);
        const dirtyFiles = ref(new Set());
        const activeFileHistoryTab = ref(null);
        const saveNote = ref('');
		const lastRestoredVersion = ref(null);
        const showNewFileModal = ref(false); // Houdt bij of het venster open is
		const newFileName = ref('');         // De naam die je typt
        const searchQuery = ref('');
		const replaceQuery = ref('');
		const searchMatches = ref('');
        const showPublishModal = ref(false);
		const publishStatus = ref('Stopped'); // 'Stopped' of 'Running'
		const selectedPublishVersion = ref(null);
        const isRefreshing = ref(false);

        const toggleFileHistory = (tab) => {
    	activeFileHistoryTab.value = activeFileHistoryTab.value === tab ? null : tab;
		};
        // Config display
        const clientId = ref(CLIENT_ID);
        const apiUrl = ref(API_URL);

        const REQUIRED_FILES = [
            'index.html', 'styles.css', 'tailwind.js', 'core.js', 'render.js'
        ];

 // --- INIT ---
        onMounted(async () => {
            try {
                // 1. Start de manager en haal projecten op
                await initManager();
                await refreshProjectList();
            } catch (e) {
                console.error('[Init Error]', e);
                showToast('Fout bij starten manager', 'error');
            }
            
            // 2. Start de hoofd-timer (elke minuut)
            timerInterval = setInterval(async () => {
                currentTime.value = Date.now();
                
                // Optioneel: Check elke minuut ook de server status automatisch
                if (navigator.onLine) {
                    await checkServerStatus();
                }
            }, 60000);

            // 3. Voer de eerste check direct uit bij het opstarten
            await checkServerStatus(); 
            
            console.log('[App] Initialisatie voltooid. Server status:', publishStatus.value);
        });

// --- CODEMIRROR EDITOR SETUP ---
        const initEditor = () => {
            if (!editorContainer.value) return;
            
            editorContainer.value.innerHTML = '';
            
            editorInstance = CodeMirror(editorContainer.value, {
                value: activeFile.value ? activeFile.value.content : '',
                mode: 'htmlmixed',
                theme: 'material-darker',
                lineNumbers: true,
                lineWrapping: true,
                indentUnit: 4,
                tabSize: 4
            });

            if (editorInstance) {
                editorInstance.on('change', (cm) => {
                    if (!activeFileName.value || !activeFile.value) return;

                    const currentVal = cm.getValue();
                    const file = files.value.find(f => f.name === activeFileName.value);

                    if (file) {
                        // 1. Zorg dat savedContent bestaat (referentiepunt voor de save-knop)
                        if (file.savedContent === undefined) {
                            file.savedContent = file.content;
                        }

                        // 2. Vergelijk met savedContent (voor de SAVE knop)
                        if (currentVal !== file.savedContent) {
                            file.content = currentVal; 
                            dirtyFiles.value.add(activeFileName.value);
                        } else {
                            // Als je terug-undo't naar de originele staat, gaat de knop weg
                            dirtyFiles.value.delete(activeFileName.value);
                        }
                        updatePreview();
                    }
                });
            }
        };

        const updateEditorMode = (filename) => {
            if (!editorInstance) return;
            let mode = 'htmlmixed';
            if (filename.endsWith('.css')) mode = 'css';
            if (filename.endsWith('.js')) mode = 'javascript';
            editorInstance.setOption('mode', mode);
        };

        // --- WATCHERS ---
        watch(activeFileName, (newVal) => {
            if (newVal && editorInstance && activeFile.value) {
                const currentContent = editorInstance.getValue();
                if (currentContent !== activeFile.value.content) {
                    editorInstance.setValue(activeFile.value.content);
                }
                updateEditorMode(newVal);
                editorInstance.clearHistory();
                
                // Bij wisselen van tabblad: zorg dat savedContent bekend is
                const file = files.value.find(f => f.name === newVal);
                if (file && file.savedContent === undefined) {
                    file.savedContent = file.content;
                }
            }
        });

        watch([projectActive, viewMode], () => {
            if (projectActive.value && viewMode.value !== 'preview') {
                nextTick(() => {
                    if (!editorInstance) initEditor();
                    else editorInstance.refresh();
                });
            }
        });

 const updatePreview = () => {
    if (!files.value || files.value.length === 0) return;

    const iframe = document.querySelector('iframe');
    if (!iframe) return;

    // --- DE NIEUWE CHECK ---
    // Als de server draait (Running), willen we de live-site op :8080 zien.
    // We stoppen deze functie dan, zodat hij de iframe niet overschrijft.
    if (publishStatus.value === 'Running') {
        // We doen niets, de iframe blijft op de URL van poort 8080 staan.
        return;
    }

    // 1. Haal de content op
    const getFileContent = (name) => {
        const f = files.value.find(file => file.name === name);
        return f ? f.content : '';
    };

    const html = getFileContent('index.html');
    const css = getFileContent('styles.css');
    const tailwindConfig = getFileContent('tailwind.js');

    const extraCss = files.value
        .filter(f => f.name.endsWith('.css') && f.name !== 'styles.css')
        .map(f => `<style>${f.content}</style>`)
        .join('\n');

    const extraJs = files.value
        .filter(f => f.name.endsWith('.js') && f.name !== 'tailwind.js')
        .map(f => `<script>${f.content.replace(/<\/script>/g, '<\\/script>')}<\/script>`)
        .join('\n');

    const completeHtml = `<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="UTF-8">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>${tailwindConfig.replace(/<\/script>/g, '<\\/script>')}<\/script>
    <style>
        body { background-color: white; color: black; margin: 0; padding: 0; } 
        ${css}
    </style>
    ${extraCss}
</head>
<body>
    ${html}
    ${extraJs}
</body>
</html>`;

    // 2. Verwijder de SRC (de URL) zodat srcdoc weer zichtbaar wordt
    iframe.removeAttribute('src');
    
    // 3. Injecteer de live-editor code
    iframe.srcdoc = completeHtml;
};
        const setViewMode = (mode) => {
            viewMode.value = mode;
            if (mode !== 'preview') {
                nextTick(() => {
                    if (editorInstance) editorInstance.refresh();
                });
            }
        };

        const toggleVersions = (id) => {
            expandedProjectId.value = expandedProjectId.value === id ? null : id;
        }; 

        const getFileVersion = (fileName) => {
            const file = files.value.find(f => f.name === fileName);
            if (!file) return `${currentVersion.value}.0`;
            return `${currentVersion.value}.${file.subVersion || 0}`;
        };

        const saveSingleFile = async (fileName) => {
            const fileIndex = files.value.findIndex(f => f.name === fileName);
            if (fileIndex === -1) return;

            const file = files.value[fileIndex];
            if (!file.fileHistory) file.fileHistory = [];
            
            file.fileHistory.unshift({
                subVersion: file.subVersion || 0,
                content: file.content,
                note: saveNote.value || (lastRestoredVersion.value ? `Herstart vanaf v${lastRestoredVersion.value}` : 'Handmatige wijziging'),
                timestamp: new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
            });

            if (file.fileHistory.length > 20) file.fileHistory.pop();
            file.subVersion = (file.subVersion || 0) + 1;
            
            // UPDATE DE "CLEAN" STATE
            file.savedContent = file.content; 
            dirtyFiles.value.delete(fileName);
            saveNote.value = ''; 
            
            await updateProjectInDB();

            if (editorInstance && activeFileName.value === fileName) {
                editorInstance.clearHistory();
            }

            showToast(`${fileName} bijgewerkt naar v${getFileVersion(fileName)}`, 'success');
        };

 // --- VERVANG DE INHOUD VAN restoreFileSubVersion ---
const restoreFileSubVersion = (fileName, historyItem) => {
    const file = files.value.find(f => f.name === fileName);
    if (file) {
        file.content = historyItem.content;
        file.savedContent = historyItem.content; 
        
        // Track welke sub-versie nu 'actief' is in de editor
        file.activeSubVersion = historyItem.subVersion;

        const highestSub = file.fileHistory && file.fileHistory.length > 0 
            ? Math.max(...file.fileHistory.map(h => h.subVersion)) 
            : historyItem.subVersion;

        file.subVersion = highestSub + 1;
        
        // Directe update van de editor
        if (activeFileName.value === fileName && editorInstance) {
            editorInstance.setValue(file.content);
            showToast(`${fileName} hersteld naar .${historyItem.subVersion}`, 'info');
        }
        
        updatePreview();
        activeFileHistoryTab.value = null; 
    }
};

        const updateProjectInDB = async () => {
            if (!currentProjectId.value) return;
            const project = {
                _id: currentProjectId.value,
                name: currentProjectName.value,
                files: JSON.parse(JSON.stringify(files.value)),
                history: history.value,
                currentVersion: currentVersion.value
            };
            await manager.saveSmartDocument('projects', project);
            await refreshProjectList();
        };      

        const deleteProjectBackup = async (projectId, version) => {
            if (!confirm(`Verwijder versie ${version}?`)) return;
            const proj = projectList.value.find(p => p._id === projectId);
            if (proj && proj.history) {
                proj.history = proj.history.filter(h => h.version !== version);
                await manager.saveSmartDocument('projects', proj);
                await refreshProjectList();
                showToast(`Projectversie ${version} verwijderd`, 'info');
            }
        };

        const deleteFileHistoryItem = async (fileName, subVersion) => {
            if (!confirm(`Verwijder versie .${subVersion}?`)) return;
            const file = files.value.find(f => f.name === fileName);
            if (file && file.fileHistory) {
                file.fileHistory = file.fileHistory.filter(h => h.subVersion !== subVersion);
                await updateProjectInDB(); 
                showToast(`Bestandversie verwijderd`, 'info');
            }
        };     

        // --- UNDO / REDO ---
        const undo = () => { if (editorInstance) editorInstance.undo(); };
        const redo = () => { if (editorInstance) editorInstance.redo(); };

        // --- ZOEK & VERVANG ---
        const findNext = () => {
            if (!editorInstance || !searchQuery.value) return;
            // CodeMirror search addon moet geladen zijn voor getSearchCursor
            if (editorInstance.getSearchCursor) {
                const cursor = editorInstance.getSearchCursor(searchQuery.value);
                if (cursor.findNext()) {
                    editorInstance.setSelection(cursor.from(), cursor.to());
                    editorInstance.scrollIntoView({from: cursor.from(), to: cursor.to()}, 20);
                }
            } else {
                // Fallback als addon niet geladen is
                const content = editorInstance.getValue();
                const index = content.indexOf(searchQuery.value);
                if (index !== -1) {
                    const pos = editorInstance.posFromIndex(index);
                    const endPos = editorInstance.posFromIndex(index + searchQuery.value.length);
                    editorInstance.setSelection(pos, endPos);
                }
            }
        };

        const replaceAll = () => {
            if (!editorInstance || !searchQuery.value) return;
            const content = editorInstance.getValue();
            const newContent = content.split(searchQuery.value).join(replaceQuery.value);
            editorInstance.setValue(newContent);
            showToast('Alles vervangen', 'success');
        };
        
// Zorg dat we bij het OPENEN van een file of project de 'originalContent' vastleggen
const setActiveFileWithCleanCheck = (name) => {
    setActiveFile(name);
    const file = files.value.find(f => f.name === name);
    if (file && !file.originalContent) {
        file.originalContent = file.content;
    }
};        
        
        
        
watch(searchQuery, (newQuery) => {
    if (!editorInstance) return;

    if (editorInstance.state.searchOverlay) {
        editorInstance.removeOverlay(editorInstance.state.searchOverlay);
    }

    if (!newQuery || newQuery.length < 2) {
        searchMatches.value = "";
        return;
    }

    editorInstance.state.searchOverlay = {
        token: function(stream) {
            // Maak een regex die hoofdlettergevoeligheid negeert
            const query = newQuery.toLowerCase();
            
            // Kijk of de huidige tekst in de stream begint met onze zoekterm
            if (stream.string.toLowerCase().slice(stream.pos).indexOf(query) == 0) {
                // We hebben een match! Markeer het aantal karakters van de zoekterm
                for (var i = 0; i < query.length; i++) stream.next();
                return "searching"; // Geef de class terug
            }

            // Geen match? Ga naar het volgende karakter
            stream.next();
        }
    };

    editorInstance.addOverlay(editorInstance.state.searchOverlay);

    // Matches tellen (blijft hetzelfde)
    const content = editorInstance.getValue();
    const count = (content.toLowerCase().split(newQuery.toLowerCase()).length - 1);
    searchMatches.value = count > 0 ? `${count} gevonden` : "0 gevonden";
});
        
        
        // --- VERSIE INSERTIE ---
        const insertVersionComment = () => {
            if (!activeFile.value || !editorInstance) return;
            editorInstance.focus();
            const fileName = activeFile.value.name.toLowerCase();
            let comment = '';
            if (fileName.endsWith('.html')) {
                comment = `<!-- v${currentVersion.value} -->`;
            } else if (fileName.endsWith('.css')) {
                comment = `/* v${currentVersion.value} */`;
            } else {
                comment = `// v${currentVersion.value}`;
            }

            const doc = editorInstance.getDoc();
            const cursor = doc.getCursor();
            doc.replaceRange(comment + '\n', cursor);
            showToast(`Versie v${currentVersion.value} ingevoegd!`);
        };

        
       const downloadSingleFileZip = async (file) => {
    if (!file) return;

    const zip = new JSZip();
    // We stoppen het bestand erin met zijn originele naam
    zip.file(file.name, file.content);

    // We maken een duidelijke naam voor de ZIP zelf
    const zipName = `${currentProjectName.value.replace(/\s+/g, '_')}_v${getFileVersion(file.name)}_${file.name}.zip`;

    try {
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, zipName);
        showToast(`${file.name} als ZIP gedownload`, 'success');
    } catch (err) {
        console.error("Download fout:", err);
        showToast("Download mislukt", "error");
    }
}; 
        
const forcePreviewRefresh = () => {
    isRefreshing.value = true;
    
    // Wis tijdelijke preview data in de Vue state
    previewContent.value = ''; 

    // Geef de browser 50ms de tijd om het geheugen vrij te geven
    setTimeout(() => {
        updatePreview();
        isRefreshing.value = false;
        showToast('Geheugen gewist & Preview herstart', 'info');
    }, 50);
};
        // --- UPLOAD LOGICA ---
        const triggerUpload = () => fileInput.value.click();

const handleFileUpload = async (event) => {
    const fileList = Array.from(event.target.files);
    if (!fileList.length) return;

    let updatedCount = 0;
    
    for (const file of fileList) {
        const text = await file.text();
        const existingFile = files.value.find(f => f.name === file.name);

        if (existingFile) {
            // 1. Sla de huidige staat op in de geschiedenis voordat we overschrijven
            if (!existingFile.fileHistory) existingFile.fileHistory = [];
            existingFile.fileHistory.unshift({
                subVersion: existingFile.subVersion || 0,
                content: existingFile.content,
                note: `Overschreven door upload`,
                timestamp: new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
            });

            // 2. Update de content en verhoog sub-versie
            existingFile.content = text;
            existingFile.savedContent = text; // Direct als 'schoon' markeren
            existingFile.subVersion = (existingFile.subVersion || 0) + 1;
            existingFile.lastModified = Date.now();
            
            // Verwijder uit dirty files mocht hij daar in staan
            dirtyFiles.value.delete(file.name);
        } else {
            // Nieuw bestand toevoegen
            files.value.push({
                name: file.name,
                content: text,
                savedContent: text,
                subVersion: 0,
                fileHistory: [],
                lastModified: Date.now()
            });
        }
        updatedCount++;

        // Als dit het actieve bestand is, update de editor
        if (activeFileName.value === file.name && editorInstance) {
            editorInstance.setValue(text);
            editorInstance.clearHistory();
        }
    }

    if (updatedCount > 0) {
        updatePreview();
        await updateProjectInDB(); // Sla direct op in de cloud/database
        showToast(`${updatedCount} bestanden verwerkt`, 'success');
        event.target.value = ''; // Reset de input
    }
};

        // --- PROJECT API's (OFFLINEMANAGER) ---
        const refreshProjectList = async () => {
            if (!manager) return;
            isLoading.value = true;
            try {
                const projects = await manager.getSmartCollection('projects');
                projectList.value = projects;
                console.log('[Projects] Geladen:', projects.length);
            } catch (e) {
                console.error(e);
                showToast('Kon projecten niet laden', 'error');
            } finally {
                isLoading.value = false;
            }
        };

// --- GEWIJZIGDE FUNCTIE: openProject ---
const openProject = async (projectId, projectName) => {
    if (!manager) return;
    isLoading.value = true;
    try {
        const allProjects = await manager.getSmartCollection('projects');
        const projectData = allProjects.find(p => p._id === projectId);
        
        if (projectData) {
            currentProjectId.value = projectData._id;
            currentProjectName.value = projectData.name || projectName;
            files.value = projectData.files || [];
            history.value = projectData.history || [];
            currentVersion.value = projectData.currentVersion || 1;
            highestVersion.value = projectData.highestVersion || 1;
            projectActive.value = true;
            
            // OPEN ALLE BESTANDEN ALS TABBLADEN
            openTabs.value = files.value.map(f => f.name);
            activeFileName.value = 'index.html'; // Standaard focus op index.html
            
            nextTick(() => {
                initEditor();
                updatePreview();
            });
        }
    } catch (e) {
        console.error(e);
        showToast('Fout bij openen project', 'error');
    } finally {
        isLoading.value = false;
    }
};

        const closeProject = async () => {
            projectActive.value = false;
            currentProjectId.value = null;
            currentProjectName.value = '';
            files.value = [];
            previewContent.value = '';
            editorInstance = null;
            await refreshProjectList();
        };

        // File watch voor preview update
        let previewTimeout;
watch(files, () => {
    if (projectActive.value) {
        // Alleen de automatische preview updaten als de server NIET draait
        // Anders overschrijven we de live-site op poort 8080
        if (publishStatus.value !== 'Running') {
            clearTimeout(previewTimeout);
            previewTimeout = setTimeout(updatePreview, 300);
        }
    }
}, { deep: true });

        const createProject = async () => {
            if (!newProjectName.value || !manager) return;
            isLoading.value = true;

            const initialFiles = REQUIRED_FILES.map(name => ({
                name,
                content: '',
                lastModified: Date.now()
            }));

            const newProjectData = {
                name: newProjectName.value,
                files: initialFiles,
                history: [],
                currentVersion: 1,
                highestVersion: 1
            };

            try {
                // Sla via OfflineManager op (auto POST/PUT)
                const createdProject = await manager.saveSmartDocument('projects', newProjectData);
                
                showNewProjectModal.value = false;
                currentProjectId.value = createdProject._id;
                currentProjectName.value = createdProject.name;
                files.value = initialFiles;
                history.value = [];
                currentVersion.value = 1;
                highestVersion.value = 1;
                projectActive.value = true;
                activeFileName.value = 'index.html';
                newProjectName.value = '';

                nextTick(() => {
                    initEditor();
                    updatePreview();
                });

                await createBackup(true);
                showToast('Project aangemaakt!', 'success');
            } catch (e) {
                console.error(e);
                showToast('Kon project niet aanmaken', 'error');
            } finally {
                isLoading.value = false;
            }
        };

        const deleteProject = async (projectId) => {
            if (!confirm('Weet je zeker dat je dit hele project wilt verwijderen?')) return;
            try {
                if (manager && manager.gateway) {
                    await manager.gateway.deleteDocument('projects', projectId);
                    await manager.refreshCache('projects');
                    showToast('Project verwijderd');
                    await refreshProjectList();
                }
            } catch (e) {
                console.error(e);
                showToast('Kon niet verwijderen', 'error');
            }
        };

 const saveToCloud = async (isSilent = false) => {
    if (!currentProjectId.value || !manager) return;

    // STAP 1: Forceer de huidige editor inhoud in de files array
    if (editorInstance && activeFileName.value) {
        const currentContent = editorInstance.getValue();
        const fileToUpdate = files.value.find(f => f.name === activeFileName.value);
        if (fileToUpdate) {
            fileToUpdate.content = currentContent;
            fileToUpdate.lastModified = Date.now();
        }
    }

    // STAP 2: Maak de payload (nu met de juiste content)
    const dataPayload = {
        _id: currentProjectId.value,
        name: currentProjectName.value,
        files: JSON.parse(JSON.stringify(files.value)), // Diepe kopie om proxy issues te voorkomen
        history: history.value,
        currentVersion: currentVersion.value,
        highestVersion: highestVersion.value
    };

    try {
        await manager.saveSmartDocument('projects', dataPayload);
        if (!isSilent) showToast('Opgeslagen', 'success');
    } catch (e) {
        console.error(e);
        showToast('Fout bij opslaan!', 'error');
    }
};
const createBackup = async (isAuto = false) => {
    isLoading.value = true;
    try {
        // 1. Maak de snapshot van de huidige staat
        const snapshot = JSON.parse(JSON.stringify(files.value));
        
        // 2. DOORTEL-LOGICA: Zoek het hoogste nummer ooit gebruikt in de geschiedenis
        const highestInHistory = history.value.length > 0 
            ? Math.max(...history.value.map(h => h.version)) 
            : currentVersion.value;
        
        // 3. Maak het backup-record van de huidige werkversie
        const backupRecord = {
            version: currentVersion.value,
            // Gebruik de automatische "Herstart vanaf..." tekst of de handmatige noot
            note: saveNote.value || (lastRestoredVersion.value ? `Herstart vanaf v${lastRestoredVersion.value}` : 'Project Backup'),
            timestamp: new Date().toLocaleTimeString('nl-NL', { 
                hour: '2-digit', 
                minute: '2-digit' 
            }),
            files: snapshot
        };
// ============================================================
        // Reset de 'hersteld' indicators voor de UI
        lastRestoredVersion.value = null;
        saveNote.value = ''; // Maak ook het notitieveld weer leeg voor de volgende keer
        
        files.value.forEach(f => {
            f.activeSubVersion = null;
        });
        // 4. Voeg toe aan geschiedenis
        history.value.unshift(backupRecord);

        // 5. BEPAAL DE VOLGENDE VERSIE
        const nextVer = Math.max(currentVersion.value, highestInHistory) + 1;
        currentVersion.value = nextVer;
        highestVersion.value = nextVer; // VOEG DEZE REGEL TOE om de globale teller te syncen
        
        // 6. Reset bestanden voor de nieuwe hoofdversie
        files.value.forEach(f => {
            f.subVersion = 0;
            // We laten fileHistory van het bestand zelf intact
        });
        
        if (dirtyFiles.value) {
            dirtyFiles.value.clear();
        }

        // 7. Reset de tijdelijke variabelen
        saveNote.value = '';
        lastRestoredVersion.value = null;

        // 8. Opslaan in database
        await updateProjectInDB();

        if (!isAuto) {
            showToast(`v${backupRecord.version} opgeslagen. Nieuwe werkversie: v${currentVersion.value}`, 'success');
        }
    } catch (error) {
        console.error("Backup fout:", error);
        showToast("Fout bij maken backup", "error");
    } finally {
        isLoading.value = false;
    }
};

        
  // --- NIEUWE STATE ---
const openTabs = ref([]); // Houdt bij welke bestanden open staan als tabbladen      
        
        
 // --- NIEUWE FUNCTIE: closeTab ---
const closeTab = (name) => {
    openTabs.value = openTabs.value.filter(t => t !== name);
    // Als we het actieve tabblad sluiten, kies een andere of zet op null
    if (activeFileName.value === name) {
        activeFileName.value = openTabs.value.length > 0 ? openTabs.value[0] : null;
    }
};

   
 const createNewFile = async () => {
    if (!newFileName.value) return;
    
    // Check of bestand al bestaat
    const exists = files.value.some(f => f.name.toLowerCase() === newFileName.value.toLowerCase());
    if (exists) {
        showToast('Bestand bestaat al!', 'error');
        return;
    }

    // Maak het nieuwe bestandsobject aan
    const newFile = {
        name: newFileName.value,
        content: '',
        subVersion: 0,
        fileHistory: [],
        lastModified: Date.now()
    };

    // Voeg toe aan de project bestanden
    files.value.push(newFile);
    
    // Voeg toe aan de open tabbladen en maak actief
    if (!openTabs.value.includes(newFileName.value)) {
        openTabs.value.push(newFileName.value);
    }
    setActiveFile(newFileName.value);

    // Reset en sluit modal
    showNewFileModal.value = false;
    newFileName.value = '';
    
    // Sla direct op in de database
    await updateProjectInDB();
    showToast(`${newFile.name} aangemaakt`, 'success');
};       
        
        
const checkServerStatus = async () => {
    try {
        // We voegen een uniek getal toe (?t=...) om te voorkomen dat de browser 
        // een oud antwoord uit het geheugen serveert (cache-busting)
        const res = await fetch(`${PUBLISH_API}/api/server-status?t=${Date.now()}`, {
            cache: 'no-store' // Extra instructie: niet cachen!
        });

        if (!res.ok) throw new Error('Server onbereikbaar');

        const data = await res.json();
        
        // Alleen de waarde aanpassen als deze echt verschilt
        if (publishStatus.value !== data.status) {
            console.log(`[Status] Server is nu: ${data.status}`);
            publishStatus.value = data.status;
            
            // Als de server herstart is naar Running, update de iframe
            if (data.status === 'Running' && !document.querySelector('iframe').src.includes(':8080')) {
                 const iframe = document.querySelector('iframe');
                 if (iframe) {
                    iframe.removeAttribute('srcdoc');
                    iframe.src = `http://${window.location.hostname}:8080?t=${Date.now()}`;
                 }
            }
        }
    } catch (e) {
        // BELANGRIJK: Bij een netwerkfout zetten we de status NIET direct op Stopped.
        // We laten de huidige status staan, want een tijdelijke hapering 
        // betekent niet dat de website offline is.
        console.warn('[Status Check] Kon server status niet ophalen:', e.message);
    }
};
const publishProject = async (project, backup) => {
    isLoading.value = true;
    try {
        const response = await fetch(`${PUBLISH_API}/api/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId: project._id,
                version: backup.version,
                files: backup.files 
            })
        });
        const result = await response.json();
        
        if (result.success) {
            publishStatus.value = 'Running';
            showPublishModal.value = false;
            
            // DE FIX: Pak de iframe en verander de SRC naar de live URL
            const iframe = document.querySelector('iframe');
            if (iframe) {
                // Verwijder srcdoc (die heeft voorrang op src)
                iframe.removeAttribute('srcdoc');
                // Zet de URL naar de poort van de gepubliceerde site
                iframe.src = `http://${window.location.hostname}:8080?v=${backup.version}`;
            }
            
            showToast(result.message, 'success');
        }
    } catch (e) {
        showToast("Publicatie mislukt", "error");
    } finally {
        isLoading.value = false;
    }
};

const stopServer = async () => {
    try {
        // Direct visueel op 'Stopping' zetten
        publishStatus.value = 'Stopping...';
        
        // FIX 1: Gebruik PUBLISH_API en het juiste pad /api/stop-server
        // FIX 2: Puntkomma toegevoegd na de fetch call
        const response = await fetch(`${PUBLISH_API}/api/stop-server`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            // FORCEER de status op Stopped
            publishStatus.value = 'Stopped';
            showToast('Server succesvol gestopt', 'info');
            
            // Optioneel: Update de lokale manager cache direct
            if (manager) {
                // Let op: updateCache is vaak een async functie
                await manager.updateCache('serverStatus', { status: 'Stopped' });
            }
        } else {
            // Als de response niet OK is (bijv. 404 of 500)
            throw new Error(`Server reageerde met status: ${response.status}`);
        }
    } catch (err) {
        console.error('Fout bij stoppen server:', err);
        showToast('Kon server niet stoppen', 'error');
        // Bij fout halen we de echte status weer op om de UI te resetten
        await checkServerStatus(); 
    }
};
        
        
        
        
// --- GEWIJZIGDE FUNCTIE: setActiveFile ---
const setActiveFile = (name) => {
    if (!name) return;
    // Als het bestand nog niet in de tabbladen staat, voeg het toe
    if (!openTabs.value.includes(name)) {
        openTabs.value.push(name);
    }
    activeFileName.value = name;
};
        const activeFile = computed(() => files.value.find(f => f.name === activeFileName.value));

        watch(activeFile.value?.content, (newContent, oldContent) => {
            if (activeFile.value && newContent !== oldContent) {
                activeFile.value.lastModified = Date.now();
            }
        });

        watch(showNewProjectModal, (val) => {
            if (val) {
                nextTick(() => projectNameInput.value?.focus());
            }
        });

        let timerInterval;
        onUnmounted(() => {
            if (timerInterval) clearInterval(timerInterval);
        });

        const pasteFromClipboard = async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (editorInstance) {
                    const doc = editorInstance.getDoc();
                    const cursor = doc.getCursor();
                    doc.replaceRange(text, cursor);
                    showToast('Code geplakt!', 'success');
                }
            } catch (err) {
                alert('Kon niet plakken. Gebruik CTRL+V / CMD+V.');
            }
        };

        const copyContent = () => {
            if (activeFile.value) {
                navigator.clipboard.writeText(activeFile.value.content);
                showToast('Gekopieerd!', 'success');
            }
        };

        const clearContent = () => {
            if (!activeFile.value) return;
            if (confirm(`Weet je zeker dat je ${activeFile.value.name} leeg wilt maken?`)) {
                activeFile.value.content = '';
                if (editorInstance) editorInstance.setValue('');
                activeFile.value.lastModified = Date.now();
                showToast('Inhoud gewist');
            }
        };

  
// --- VERVANG DE BESTAANDE restoreVersion FUNCTIE ---
const restoreVersion = async (backup) => {
    if (confirm(`Weet je zeker dat je projectversie ${backup.version} wilt herstellen?`)) {
        // Markeer welke versie de bron is
        lastRestoredVersion.value = backup.version;
        saveNote.value = `Herstart vanaf v${backup.version}`;

        // Bestanden overschrijven
        files.value = JSON.parse(JSON.stringify(backup.files));
        
        // Versiebeheer logica (zoals eerder besproken)
        const highestInHistory = history.value.length > 0 
            ? Math.max(...history.value.map(h => h.version)) 
            : backup.version;
        
        currentVersion.value = highestInHistory + 1;
        highestVersion.value = highestInHistory + 1;

        // FORCEER EDITOR UPDATE
        // We wachten tot Vue de data heeft verwerkt en herladen dan het actieve bestand in de editor
        await nextTick();
        if (activeFileName.value) {
            const currentFile = files.value.find(f => f.name === activeFileName.value);
            if (currentFile && editorInstance) {
                editorInstance.setValue(currentFile.content);
                editorInstance.clearHistory();
            }
        }
        
        updatePreview();
        await updateProjectInDB();
        
        showToast(`Versie ${backup.version} hersteld. Editor bijgewerkt.`, 'success');
        expandedProjectId.value = null;
    }
};
        const deleteBackup = async (version) => {
            if (!confirm(`Backup v${version} verwijderen?`)) return;
            history.value = history.value.filter(h => h.version !== version);
            await saveToCloud(true);
            showToast(`Backup v${version} verwijderd`);
        };

        const downloadZip = async () => {
            const zip = new JSZip();
            files.value.forEach(file => {
                zip.file(file.name, file.content);
            });
            const fileName = `${currentProjectName.value.replace(/\s+/g, '_')}_v${currentVersion.value}.zip`;
            zip.generateAsync({ type: 'blob' }).then(function (content) {
                saveAs(content, fileName);
                showToast('ZIP gedownload', 'success');
            });
        };

        const getFileIcon = (filename) => {
            if (filename.endsWith('.html')) return 'fas fa-globe text-orange-500';
            if (filename.endsWith('.css')) return 'fab fa-css3-alt text-blue-500';
            if (filename.endsWith('.js')) return 'fab fa-js text-yellow-400';
            return 'fas fa-file text-gray-400';
        };

        const formatTimeAgo = (timestamp) => {
            if (!timestamp) return '';
            const now = currentTime.value;
            const diff = now - timestamp;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);
            
            if (diff < 60000) return 'zojuist';
            if (minutes < 60) return `${minutes} min`;
            if (hours < 24) return `${hours} uur`;
            return `${days} dagen`;
        };

        const showToast = (msg, type = 'normal') => {
            savedMessage.value = msg;
            setTimeout(() => {
                savedMessage.value = '';
            }, 3000);
        };

        return {
            isLoading,
            showNewProjectModal,
            newProjectName,
            projectNameInput,
            createProject,
            openProject,
            closeProject,
            deleteProject,
            currentProjectName,
            projectActive,
            currentVersion,
            highestVersion,
            files,
            activeFileName,
            activeFile,
            history,
            showHistoryModal,
            showMobileMenu,
            savedMessage,
            setActiveFile,
            pasteFromClipboard,
            copyContent,
            clearContent,
            createBackup,
            restoreVersion,
            deleteBackup,
            downloadZip,
            getFileIcon,
            formatTimeAgo,
            fileInput,
            triggerUpload,
            handleFileUpload,
            viewMode,
            setViewMode,
            previewContent,
            insertVersionComment,
            editorContainer,
            projectList,
            refreshProjectList,
            clientId,
            openTabs,
  			setActiveFile,
    		closeTab,
            expandedProjectId,
   			toggleVersions,
            dirtyFiles,
    		getFileVersion,
    		saveSingleFile,
            activeFileHistoryTab,
  			toggleFileHistory,
		    restoreFileSubVersion,
            deleteProjectBackup,
            deleteFileHistoryItem,
            saveNote,
            lastRestoredVersion,
            showNewFileModal,
   			newFileName,
    		createNewFile,
            searchQuery,
    		replaceQuery,
    		searchMatches,
    		undo,
    		redo,
    		findNext,
    		replaceAll,
            showPublishModal,
			publishStatus,
			publishProject,
			stopServer,
            downloadSingleFileZip,
            isRefreshing,
            forcePreviewRefresh,
            apiUrl
        };
    }
}).mount('#app');
