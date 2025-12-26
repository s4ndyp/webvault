// ============================================
// CONFIGURATIE - PAS DEZE VARIABELEN AAN!
// ============================================
const API_URL = 'http://10.10.2.20:5000'; // Backend API URL
const CLIENT_ID = 'sandman'; // Unieke gebruiker ID
const APP_NAME = 'sitebuilder';
const SERVER_API = window.location.origin.includes('null') ?
    `${window.location.protocol}//${window.location.hostname}` :
    window.location.origin;
const PUBLISH_API = `${window.location.protocol}//${window.location.hostname}:8080`;
// ============================================
// OFFLINE MANAGER INITIALISATIE
// ============================================
let manager = null;

async function initManager() {
    if (!manager) {
        manager = new OfflineManager(API_URL, CLIENT_ID, APP_NAME);
        console.log(`[Manager] Geïnitialiseerd: ${APP_NAME}`);

        // --- DE TOEVOEGING: Forceer ophalen bij start ---
        try {
            console.log('[Manager] Initiële data ophalen uit cloud...');
            // We refreshen de 'projects' collectie direct bij het opstarten
            await manager.refreshCache('projects');
            console.log('[Manager] Cloud data succesvol gesynchroniseerd.');
        } catch (e) {
            console.warn('[Manager] Kon initiële data niet ophalen (offline?), we werken verder met lokale cache.');
        }

        // Sync outbox wanneer verbinding hersteld
        window.addEventListener('online', async () => {
            console.log('[Manager] Verbinding hersteld, syncing...');
            await manager.syncOutbox();
            await refreshProjectList();
        });

        // De bestaande setInterval voor auto-sync
        setInterval(async () => {
            if (navigator.onLine && manager) {
                try {
                    console.log('[Manager] Automatische cache refresh...');
                    await manager.refreshCache('projects');

                    // Only check server status if we're interested in it
                    if (publishStatus.value !== 'Stopped' && publishStatus.value !== 'Stopping...') {
                        await checkServerStatus();
                    }
                } catch (err) {
                    console.error('[Manager] Auto-sync fout:', err);
                    // Niet fataal - ga door met volgende poging
                }
            }
        }, 60000);

    }
}
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
        const newFileName = ref(''); // De naam die je typt
        const searchQuery = ref('');
        const replaceQuery = ref('');
        const searchMatches = ref('');
        const showPublishModal = ref(false);
        const publishStatus = ref('Stopped'); // 'Stopped' of 'Running'
        const hostname = window.location.hostname; // Maak de hostname beschikbaar voor de HTML
        const selectedPublishVersion = ref(null);
        const isRefreshing = ref(false);
        const totalMatches = ref(0);
        const currentMatchIndex = ref(0);
        const showSymbolList = ref(false);
        const symbols = ref([]);
        const showDiff = ref(false);
        let diffWidgets = []; // Om de rode 'verwijderd' blokjes bij te houden
        let originalContent = ""; // Dit wordt ons "nulpunt"
        const activePublishVersion = ref(null);

        const toggleSymbolList = () => {
            if (!activeFile.value || !editorInstance) return;

            const content = editorInstance.getValue();
            const lines = content.split('\n');
            const foundSymbols = [];

            // Regex om functies te vinden (JS & Python stijl)
            const funcRegex = /(?:function\s+([a-zA-Z0-9_$]+)|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|def\s+([a-zA-Z0-9_$]+)\s*\(|class\s+([a-zA-Z0-9_$]+))/g;

            lines.forEach((line, index) => {
                let match;
                while ((match = funcRegex.exec(line)) !== null) {
                    // Pak de naam uit de juiste groep van de regex
                    const name = match[1] || match[2] || match[3] || match[4];
                    if (name) {
                        foundSymbols.push({ name, line: index });
                    }
                }
            });

            symbols.value = foundSymbols;
            showSymbolList.value = !showSymbolList.value;
        };

        const jumpToSymbol = (line) => {
            if (!editorInstance) return;

            // Verplaats de cursor naar de juiste regel
            editorInstance.setCursor(line, 0);
            editorInstance.focus();

            // Markeer de regel heel even met een selectie zodat de gebruiker ziet waar hij is
            editorInstance.setSelection({ line: line, ch: 0 }, { line: line + 1, ch: 0 });

            // We halen showSymbolList.value = false; hier weg. 
            // De lijst blijft dus gewoon staan in de zijbalk!
            console.log(`[Navigation] Sprong naar regel ${line + 1}`);
        };

        const toggleFileHistory = (tab) => {
            activeFileHistoryTab.value = activeFileHistoryTab.value === tab ? null : tab;
        };
        // Config display
        const clientId = ref(CLIENT_ID);
        const apiUrl = ref(API_URL);

        window.appStatus = publishStatus;

        const REQUIRED_FILES = [
            'index.html', 'styles.css', 'tailwind.js', 'core.js', 'render.js'
        ];

        // --- INIT ---
        // --- INIT ---
        onMounted(async () => {
            try {
                isLoading.value = true; // Toon een spinner tijdens het laden

                // 1. Start de manager (deze wacht nu op de cloud data)
                await initManager();

                // 2. Pas als de manager klaar is, vullen we de projectList in de UI
                await refreshProjectList();

                console.log(`[App] Klaar! ${projectList.value.length} projecten geladen.`);
            } catch (e) {
                console.error('[Init Error]', e);
                showToast('Fout bij starten manager', 'error');
            } finally {
                isLoading.value = false;
            }

            // Start de timers voor status checks
            timerInterval = setInterval(async () => {
                currentTime.value = Date.now();
                if (navigator.onLine) {
                    await checkServerStatus();
                }
            }, 60000);

            await checkServerStatus();
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
                tabSize: 4,
                gutters: ["CodeMirror-lint-markers"],
                // VERVANG lint: true DOOR DIT:
                lint: {
                    options: {
                        esversion: 11, // Hiermee herkent hij const, let en =>
                        asi: true, // Optioneel: dit negeert waarschuwingen over ontbrekende puntkomma's
                        browser: true,
                        devel: true
                    }
                }
            });

            if (editorInstance) {
                editorInstance.on('change', (cm) => {
                    if (!activeFileName.value || !activeFile.value) return;

                    const currentVal = cm.getValue();
                    const file = files.value.find(f => f.name === activeFileName.value);

                    if (file) {
                        // Als Diff Mode aan staat, herbereken de highlights
                        if (showDiff.value) {
                            renderDiff();
                        }

                        // Save-knop logica (bestaand)
                        if (file.savedContent === undefined) file.savedContent = file.content;
                        if (currentVal !== file.savedContent) {
                            file.content = currentVal;
                            dirtyFiles.value.add(activeFileName.value);
                        } else {
                            dirtyFiles.value.delete(activeFileName.value);
                        }
                        updatePreview();
                    }
                });
            } // Einde if(editorInstance)
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

            // We slaan nu ook de 'major' versie op voor het volledige nummer (bijv 8.1)
            file.fileHistory.unshift({
                majorVersion: currentVersion.value,
                subVersion: file.subVersion || 0,
                content: file.content,
                note: saveNote.value || (lastRestoredVersion.value ? `Herstart vanaf v${lastRestoredVersion.value}` : 'Wijziging opgeslagen'),
                timestamp: new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
            });

            if (file.fileHistory.length > 20) file.fileHistory.pop();
            file.subVersion = (file.subVersion || 0) + 1;

            file.savedContent = file.content;
            dirtyFiles.value.delete(fileName);
            saveNote.value = '';

            // Direct opslaan in de database
            await updateProjectInDB();

            // Als de editor open is voor dit bestand, resetten we de weergave
            if (editorInstance && activeFileName.value === fileName) {
                editorInstance.clearHistory();

                // 1. Het nieuwe nulpunt instellen (vergelijken met wat we nú hebben)
                originalContent = editorInstance.getValue();

                // 2. Alle kleuren en rode widgets wissen
                clearDiff();

                // 3. Als Diff Mode aan stond, herberekenen (geeft nu 0 verschillen)
                if (showDiff.value) {
                    renderDiff();
                }
            }
            showToast(`${fileName} opgeslagen als v${currentVersion.value}.${file.subVersion - 1}`, 'success');
        };

        // --- VERVANG DE INHOUD VAN restoreFileSubVersion ---
        const restoreFileSubVersion = (fileName, historyItem) => {
            const file = files.value.find(f => f.name === fileName);
            if (file) {
                // 1. De inhoud herstellen
                file.content = historyItem.content;
                file.savedContent = historyItem.content;

                // 2. Bepaal het nieuwe subnummer binnen de HUIDIGE hoofdversie
                // We filteren de historie op versies die hetzelfde hoofdnummer hebben als nu
                const matchesInCurrentRange = file.fileHistory ? file.fileHistory.filter(h => h.majorVersion === currentVersion.value) : [];

                let nextSub;
                if (matchesInCurrentRange.length > 0) {
                    // Hoogste subnummer in de huidige reeks + 1
                    const maxSub = Math.max(...matchesInCurrentRange.map(h => h.subVersion));
                    nextSub = maxSub + 1;
                } else {
                    // Eerste wijziging in deze nieuwe hoofdversie reeks
                    nextSub = 1;
                }

                file.subVersion = nextSub;
                file.activeSubVersion = historyItem.subVersion; // Voor de blauwe badge in de tab

                // 3. Editor updaten
                if (activeFileName.value === fileName && editorInstance) {
                    editorInstance.setValue(file.content);
                    showToast(`${fileName} hersteld (wordt v${currentVersion.value}.${nextSub} bij opslaan)`, 'info');
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

        // --- ZOEK & VERVANG (GEOPTIMALISEERD) ---
        const findNext = () => {
            if (!editorInstance || !searchQuery.value) return;

            editorInstance.focus();

            // Pak de huidige cursorpositie
            const currentCursor = editorInstance.getCursor("to");

            // FIX: Voeg { caseFold: true } toe zodat hij ook 'Body' vindt als je 'body' zoekt
            const cursor = editorInstance.getSearchCursor(searchQuery.value, currentCursor, { caseFold: true });

            if (!cursor.findNext()) {
                // Wrap around: begin weer bovenaan
                const startCursor = { line: 0, ch: 0 };
                const wrapCursor = editorInstance.getSearchCursor(searchQuery.value, startCursor, { caseFold: true });
                if (wrapCursor.findNext()) {
                    editorInstance.setSelection(wrapCursor.from(), wrapCursor.to());
                    try {
                        editorInstance.scrollIntoView({ from: wrapCursor.from(), to: wrapCursor.to() }, 150);
                    } catch (e) { /* Negeer scrollfouten bij Diff mode */ }
                }
            } else {
                // Gevonden!
                editorInstance.setSelection(cursor.from(), cursor.to());
                try {
                    editorInstance.scrollIntoView({ from: cursor.from(), to: cursor.to() }, 150);
                } catch (e) { /* Negeer scrollfouten */ }
            }

            setTimeout(updateMatchCounters, 50);
        };

        const findPrev = () => {
            if (!editorInstance || !searchQuery.value) return;

            editorInstance.focus();
            const currentCursor = editorInstance.getCursor("from");

            // FIX: Ook hier { caseFold: true }
            const cursor = editorInstance.getSearchCursor(searchQuery.value, currentCursor, { caseFold: true });

            if (!cursor.findPrevious()) {
                // Wrap around: ga naar onderen
                const endCursor = { line: editorInstance.lineCount() - 1 };
                const wrapCursor = editorInstance.getSearchCursor(searchQuery.value, endCursor, { caseFold: true });
                if (wrapCursor.findPrevious()) {
                    editorInstance.setSelection(wrapCursor.from(), wrapCursor.to());
                    try {
                        editorInstance.scrollIntoView({ from: wrapCursor.from(), to: wrapCursor.to() }, 150);
                    } catch (e) { /* Negeer scrollfouten */ }
                }
            } else {
                editorInstance.setSelection(cursor.from(), cursor.to());
                try {
                    editorInstance.scrollIntoView({ from: cursor.from(), to: cursor.to() }, 150);
                } catch (e) { /* Negeer scrollfouten */ }
            }

            setTimeout(updateMatchCounters, 50);
        };

        const updateMatchCounters = () => {
            if (!editorInstance || !searchQuery.value) {
                totalMatches.value = 0;
                currentMatchIndex.value = 0;
                return;
            }

            const content = editorInstance.getValue();
            const query = searchQuery.value;

            // 1. Tel totaal aantal matches (Regex was al case-insensitive door 'gi')
            try {
                const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                const matches = content.match(regex);
                totalMatches.value = matches ? matches.length : 0;
            } catch (e) {
                totalMatches.value = 0;
            }

            if (totalMatches.value > 0) {
                // 2. Bepaal welke match geselecteerd is
                const cursorFrom = editorInstance.getCursor("from");

                // FIX: Ook hier caseFold toevoegen, anders klopt de "3/5" teller niet met de werkelijkheid
                const allCursor = editorInstance.getSearchCursor(query, { line: 0, ch: 0 }, { caseFold: true });

                let count = 0;
                let foundIndex = 0;

                while (allCursor.findNext()) {
                    count++;
                    // Check of deze match overlapt met de huidige selectie
                    const from = allCursor.from();
                    if (from.line === cursorFrom.line && from.ch === cursorFrom.ch) {
                        foundIndex = count;
                    }
                }
                currentMatchIndex.value = foundIndex || 0; // Zet op 0 als we er 'tussenin' staan
            } else {
                currentMatchIndex.value = 0;
            }
        };

        const replaceAll = () => {
            if (!editorInstance || !searchQuery.value) return;
            const content = editorInstance.getValue();
            // Maak een case-insensitive regex voor de replace
            const regex = new RegExp(searchQuery.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            const newContent = content.replace(regex, replaceQuery.value);

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

            // 1. Verwijder oude highlights
            if (editorInstance.state.searchOverlay) {
                editorInstance.removeOverlay(editorInstance.state.searchOverlay);
            }

            // 2. Reset tellers bij leeg veld
            if (!newQuery || newQuery.length < 2) {
                totalMatches.value = 0;
                currentMatchIndex.value = 0;
                return;
            }

            // 3. Teken de highlights (zonder focus te verplaatsen!)
            editorInstance.state.searchOverlay = {
                token: function(stream) {
                    const query = newQuery.toLowerCase();
                    if (stream.string.toLowerCase().slice(stream.pos).indexOf(query) == 0) {
                        for (var i = 0; i < query.length; i++) stream.next();
                        return "searching";
                    }
                    stream.next();
                }
            };
            editorInstance.addOverlay(editorInstance.state.searchOverlay);

            // 4. Update alleen de tellers, maar GEEN findNext() aanroepen tijdens het typen
            // Hierdoor blijft je cursor gewoon in het invoerveld staan.
            setTimeout(() => {
                updateMatchCounters();
            }, 20);
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

        const resetProjectHistory = async (proj) => {
            const msg = `Weet je zeker dat je alle historie van '${proj.name}' wilt wissen?\n\nJe krijgt eerst een volledige ZIP van alle versies, daarna wordt het project gereset naar v1.`;
            if (!confirm(msg)) return;

            isLoading.value = true;
            try {
                // 1. MAAK DE ARCHIEF-ZIP (Bestaande code)
                const zip = new JSZip();
                const mainFolder = zip.folder(`archive_${proj.name}_v${proj.currentVersion}`);

                if (proj.history) {
                    proj.history.forEach(backup => {
                        const versionFolder = mainFolder.folder(`v${backup.version}_${backup.timestamp.replace(/:/g, '-')}`);
                        backup.files.forEach(file => {
                            versionFolder.file(file.name, file.content);
                        });
                    });
                }

                const content = await zip.generateAsync({ type: 'blob' });
                saveAs(content, `FULL_ARCHIVE_${proj.name}.zip`);
                showToast("Archief gedownload, nu opschonen...", "info");

                // ============================================================
                // 2. PROJECT RESETTEN NAAR v1 (MET FILE HISTORY WISSEN)
                // ============================================================

                // HIER ZIT DE FIX: We schonen elk bestand individueel op
                const resetFiles = proj.files.map(f => ({
                    ...f,
                    subVersion: 0, // Zet teller op 0
                    fileHistory: [], // GOOI DE GESCHIEDENIS LEEG!
                    activeSubVersion: null, // Haal blauwe badges weg
                    savedContent: f.content // Markeer huidige content als 'saved'
                }));

                const resetProject = {
                    ...proj,
                    files: resetFiles, // Sla de opgeschoonde bestanden op
                    currentVersion: 1,
                    highestVersion: 1,
                    history: [], // Wis project historie
                    lastRestoredVersion: null
                };

                await manager.saveSmartDocument('projects', resetProject);

                // Als we dit project open hadden, direct de UI updaten
                if (currentProjectId.value === proj._id) {
                    currentVersion.value = 1;
                    highestVersion.value = 1;
                    history.value = [];
                    files.value = resetFiles; // <--- Update de bestanden in beeld!
                    dirtyFiles.value.clear(); // Wis eventuele openstaande wijzigingen

                    // Reset ook de Diff baselines
                    fileBaselines = {};
                    if (activeFileName.value) {
                        setActiveFile(activeFileName.value); // Herlaad huidige bestand
                    }
                }

                await refreshProjectList();
                showToast("Project en alle bestandshistorie gereset naar v1", "success");
            } catch (e) {
                console.error(e);
                showToast("Reset mislukt", "error");
            } finally {
                isLoading.value = false;
            }
        };

        const forcePreviewRefresh = () => {
            isRefreshing.value = true;

            // 1. Haal de allernieuwste code direct uit de editor (net als bij typen)
            if (editorInstance && activeFileName.value) {
                const currentContent = editorInstance.getValue();
                const fileToUpdate = files.value.find(f => f.name === activeFileName.value);
                if (fileToUpdate) {
                    fileToUpdate.content = currentContent;
                    fileToUpdate.lastModified = Date.now();
                }
            }

            // 2. Geef de browser even de tijd en dwing dan een update af
            setTimeout(() => {
                updatePreview();
                isRefreshing.value = false;
                showToast('Preview volledig gesynchroniseerd', 'success');
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

        const beautifyCode = () => {
            if (!editorInstance || !activeFileName.value) return;

            const content = editorInstance.getValue();
            const fileName = activeFileName.value.toLowerCase();
            let beautified = content;

            const options = {
                indent_size: 4,
                indent_char: " ",
                max_preserve_newlines: 2,
                preserve_newlines: true,
                keep_array_indentation: false,
                break_chained_methods: false,
                indent_scripts: "normal",
                brace_style: "collapse,preserve-inline",
                space_before_conditional: true,
                unescape_strings: false,
                jslint_happy: false,
                end_with_newline: true,
                wrap_line_length: 0,
                indent_inner_html: true,
                comma_first: false,
                e4x: false,
                indent_empty_lines: false
            };

            // VOEG HIER HET TRY BLOK TOE
            try {
                if (fileName.endsWith('.html')) {
                    beautified = html_beautify(content, options);
                } else if (fileName.endsWith('.css')) {
                    beautified = css_beautify(content, options);
                } else if (fileName.endsWith('.js')) {
                    beautified = js_beautify(content, options);
                }

                editorInstance.setValue(beautified);
                showToast('Code gestructureerd!', 'success');
            } catch (e) {
                // EN HIER HET CATCH BLOK (deze vangt fouten op)
                console.error("Beautify error:", e);
                showToast("Kon code niet structureren", "error");
            }
        }; // Sluit de functie af

        const clearDiff = () => {
            if (!editorInstance) return;
            // Verwijder groene regels
            for (let i = 0; i < editorInstance.lineCount(); i++) {
                editorInstance.removeLineClass(i, "background", "line-added-highlight");
            }
            // Verwijder rode blokjes (widgets)
            diffWidgets.forEach(w => w.clear());
            diffWidgets = [];
        };

        const renderDiff = () => {
            if (!editorInstance || !showDiff.value) return;

            clearDiff();
            const currentVal = editorInstance.getValue();

            // Gebruik de Diff library om regels te vergelijken
            const diff = Diff.diffLines(originalContent, currentVal);

            let currentLine = 0;

            editorInstance.operation(() => {
                diff.forEach(part => {
                    if (part.added) {
                        // Markeer toegevoegde regels (groen)
                        for (let i = 0; i < part.count; i++) {
                            editorInstance.addLineClass(currentLine + i, "background", "line-added-highlight");
                        }
                        currentLine += part.count;
                    } else if (part.removed) {
                        // Toon verwijderde regels (rood) als een widget
                        const widgetNode = document.createElement("div");
                        widgetNode.className = "diff-removed-widget";
                        widgetNode.innerText = part.value.replace(/\n$/, "");

                        // Voeg het rode blokje in boven de huidige regel
                        const widget = editorInstance.addLineWidget(currentLine, widgetNode, {
                            above: true,
                            noHScroll: true
                        });
                        diffWidgets.push(widget);
                    } else {
                        // Geen wijziging, gewoon doortellen
                        currentLine += part.count;
                    }
                });
            });
        };

        const toggleDiffMode = () => {
            showDiff.value = !showDiff.value;
            if (showDiff.value) {
                renderDiff();
            } else {
                clearDiff();
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
                const highestInHistory = history.value.length > 0 ?
                    Math.max(...history.value.map(h => h.version)) :
                    currentVersion.value;

                // 3. Maak het backup-record van de huidige werkversie
                const backupRecord = {
                    version: currentVersion.value,
                    note: saveNote.value || (lastRestoredVersion.value ? `Herstart vanaf v${lastRestoredVersion.value}` : 'Project Backup'),
                    timestamp: new Date().toLocaleTimeString('nl-NL', {
                        hour: '2-digit',
                        minute: '2-digit'
                    }),
                    files: snapshot
                };

                // Reset de 'hersteld' indicators voor de UI
                lastRestoredVersion.value = null;
                saveNote.value = '';

                files.value.forEach(f => {
                    f.activeSubVersion = null;
                });

                // 4. Voeg toe aan geschiedenis
                history.value.unshift(backupRecord);

                // 5. BEPAAL DE VOLGENDE VERSIE
                const nextVer = Math.max(currentVersion.value, highestInHistory) + 1;
                currentVersion.value = nextVer;
                highestVersion.value = nextVer;

                // 6. Reset bestanden voor de nieuwe hoofdversie
                files.value.forEach(f => {
                    f.subVersion = 0;
                });

                if (dirtyFiles.value) {
                    dirtyFiles.value.clear();
                }

                // 7. Reset de tijdelijke variabelen
                saveNote.value = '';
                lastRestoredVersion.value = null;

                // 8. Opslaan in database
                await updateProjectInDB();

                // ============================================================
                // UPDATE: Nulpunt resetten voor de nieuwe Diff Mode
                // ============================================================
                if (editorInstance) {
                    // 1. De huidige inhoud is vanaf nu ons nieuwe 'origineel'
                    originalContent = editorInstance.getValue();

                    // 2. Verwijder alle markeringen (Groene regels EN rode widgets)
                    // We gebruiken de nieuwe clearDiff() functie die we hiervoor hebben gemaakt
                    clearDiff();

                    // 3. Als de gebruiker de Diff-mode aan heeft staan, direct verversen
                    // (Er zal nu geen kleur te zien zijn omdat alles gelijk is aan het nulpunt)
                    if (showDiff.value) {
                        renderDiff();
                    }

                    console.log(`[Diff] Nulpunt gereset naar v${backupRecord.version}`);
                }

                // ============================================================  

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

        // NIEUWE FUNCTIE (COMPLETE REPLACEMENT):
        const checkServerStatus = async () => {
            try {
                // 1. Haal de data op
                const res = await fetch(`${SERVER_API}/api/server-status?t=${Date.now()}`);
                if (!res.ok) return;
                const data = await res.json();

                // 2. Update de status (lampje) - doe dit alleen als het echt veranderd is
                if (publishStatus.value !== data.status) {
                    console.log("[Status] UI Update naar:", data.status);
                    publishStatus.value = data.status;
                }

                // 3. Iframe beheer - BUITEN de Vue reactivity als het kan
                if (data.status === 'Running') {
                    const iframe = document.getElementById('preview-iframe');
                    if (iframe) {
                        const host = window.location.hostname;
                        const targetSrc = `http://${host}:8080/?t=${Date.now()}`;

                        // CRUCIAAL: Alleen de src aanpassen als de poort nog niet 8080 is
                        // Dit voorkomt de oneindige lus en het vastlopen
                        if (!iframe.src.includes(':8080')) {
                            console.log("[Status] Iframe veilig overzetten naar poort 8080");
                            iframe.removeAttribute('srcdoc');
                            iframe.src = targetSrc;
                        }
                    }
                }
            } catch (e) {
                console.warn("[Status] Check hapering...");
            }
        };

        const publishProject = async (project, backup) => {
            isLoading.value = true;
            // Direct de modal sluiten zodat de gebruiker weer verder kan
            showPublishModal.value = false;

            try {
                const response = await fetch(`${SERVER_API}/api/publish`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        projectId: project._id,
                        version: backup.version,
                        files: backup.files
                    })
                });

                if (!response.ok) throw new Error('Publicatie server fout');

                const result = await response.json();

                if (result.success) {
                    publishStatus.value = 'Running';
                    activePublishVersion.value = backup.version; // Zet direct de versie in de UI

                    const iframe = document.querySelector('iframe');
                    if (iframe) {
                        iframe.removeAttribute('srcdoc');
                        iframe.src = `http://${window.location.hostname}:8080?v=${backup.version}&t=${Date.now()}`;
                    }
                    showToast(result.message, 'success');
                }
            } catch (e) {
                console.error("Publish fout:", e);
                showToast("Publicatie mislukt: " + e.message, "error");
                // Bij fout de status checken om te zien wat de server doet
                await checkServerStatus();
            } finally {
                isLoading.value = false;
            }
        };

        const stopServer = async () => {
            try {
                // Direct visueel op 'Stopping' zetten
                publishStatus.value = 'Stopping...';

                const response = await fetch(`${SERVER_API}/api/stop-server`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                if (response.ok) {
                    // FORCEER de status op Stopped
                    publishStatus.value = 'Stopped';
                    showToast('Server succesvol gestopt', 'info');

                    // Optioneel: Update de lokale manager cache direct zodat de interval 
                    // niet een oude status ophaalt
                    if (manager) {
                        await manager.updateCache('serverStatus', { status: 'Stopped' });
                    }
                }
            } catch (err) {
                console.error('Fout bij stoppen server:', err);
                showToast('Kon server niet stoppen', 'error');
                // Bij fout halen we de echte status weer op
                checkServerStatus();
            }
        };

        // --- GEWIJZIGDE FUNCTIE: setActiveFile ---
        const setActiveFile = (name) => {
            if (!name) return;

            // 1. Tabblad beheer (bestaande logica)
            if (!openTabs.value.includes(name)) {
                openTabs.value.push(name);
            }
            activeFileName.value = name;

            // 2. Nulpunt instellen voor de Diff Mode
            const file = files.value.find(f => f.name === name);
            if (file) {
                // We gebruiken nextTick om te wachten tot Vue de editor 
                // daadwerkelijk heeft gevuld met de tekst van het nieuwe bestand.
                nextTick(() => {
                    if (editorInstance) {
                        // Sla de inhoud van het NIEUWE bestand op als het 'origineel'
                        originalContent = editorInstance.getValue();

                        // Wis alle markeringen (groen en rode widgets) van het vorige bestand
                        clearDiff();

                        // Als Diff Mode aan staat, bereken direct de verschillen voor dit bestand
                        if (showDiff.value) {
                            renderDiff();
                        }

                        console.log(`[Diff] Nulpunt ingesteld voor nieuw bestand: ${name}`);
                    }
                });
            }

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

        const publishCurrentState = async () => {
            isLoading.value = true;
            try {
                // We pakken de huidige files direct uit de editor (met de laatste wijzigingen)
                const currentFiles = JSON.parse(JSON.stringify(files.value));

                const response = await fetch(`${SERVER_API}/api/publish`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        projectId: currentProjectId.value,
                        version: "Experiment", // Speciale marker voor de server
                        note: "Niet-opgeslagen wijzigingen (Live Experiment)",
                        files: currentFiles
                    })
                });

                const result = await response.json();
                if (result.success) {
                    publishStatus.value = 'Running';
                    showPublishModal.value = false;

                    const iframe = document.querySelector('iframe');
                    if (iframe) {
                        iframe.removeAttribute('srcdoc');
                        iframe.src = `http://${window.location.hostname}:8080?t=${Date.now()}`;
                    }
                    showToast("Experiment gestart op poort 8080", "success");
                }
            } catch (e) {
                showToast("Experiment mislukt", "error");
            } finally {
                isLoading.value = false;
            }
        };
        // --- VERVANG DE BESTAANDE restoreVersion FUNCTIE ---
        const restoreVersion = async (backup) => {
            if (confirm(`Weet je zeker dat je projectversie ${backup.version} wilt herstellen?`)) {
                // 1. Markeer herkomst voor de UI
                lastRestoredVersion.value = backup.version;
                saveNote.value = `Herstart vanaf v${backup.version}`;

                // 2. Bestanden overschrijven
                files.value = JSON.parse(JSON.stringify(backup.files));

                // 3. WATERDICHTE VERSIELOGICA:
                // We kijken naar: 
                // - Alle versienummers in de geschiedenis
                // - Én het nummer van de versie waar we net in werkten (currentVersion)
                // - Én het nummer van de backup die we nu herstellen
                const versionsInHistory = history.value.map(h => h.version);
                const maxVersionEver = Math.max(0, ...versionsInHistory, currentVersion.value, backup.version);

                // De nieuwe reeks krijgt ALTIJD het hoogste nummer ooit + 1
                const nextMainVersion = maxVersionEver + 1;

                currentVersion.value = nextMainVersion;
                highestVersion.value = nextMainVersion;

                // 4. RESET sub-versies: De bestanden beginnen in de nieuwe reeks weer bij .0
                files.value.forEach(f => {
                    f.subVersion = 0;
                    f.activeSubVersion = null;
                });

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

                showToast(`Versie ${backup.version} hersteld als basis voor v${nextMainVersion}.0`, 'success');
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
            zip.generateAsync({ type: 'blob' }).then(function(content) {
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
            publishCurrentState,
            resetProjectHistory,
            findPrev,
            totalMatches,
            currentMatchIndex,
            updateMatchCounters,
            beautifyCode,
            hostname,
            showSymbolList,
            symbols,
            toggleSymbolList,
            jumpToSymbol,
            showDiff, // De nieuwe variabele voor aan/uit
            toggleDiffMode, // De functie voor het knopje
            renderDiff,
            activePublishVersion,
            apiUrl
        };
    }
}).mount('#app');
