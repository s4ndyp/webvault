

// ============================================
// CONFIGURATIE - PAS DEZE VARIABELEN AAN!
// ============================================
const API_URL = 'http://10.10.2.20:5000';  // Backend API URL
const CLIENT_ID = 'sandman';                 // Unieke gebruiker ID
const APP_NAME = 'sitebuilder';              // App naam voor collectie-prefix

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
        setInterval(async () => {
            if (navigator.onLine && manager) {
                await manager.refreshCache('projects');
            }
        }, 60000);
    }
    return manager;
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
        
        // Config display
        const clientId = ref(CLIENT_ID);
        const apiUrl = ref(API_URL);

        const REQUIRED_FILES = [
            'index.html', 'styles.css', 'tailwind.js', 'core.js', 'render.js'
        ];

        // --- INIT ---
        onMounted(async () => {
            try {
                await initManager();
                await refreshProjectList();
            } catch (e) {
                console.error('[Init Error]', e);
                showToast('Fout bij starten manager', 'error');
            }
            
            timerInterval = setInterval(() => {
                currentTime.value = Date.now();
            }, 60000);
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

            editorInstance.on('change', (cm) => {
                if (activeFile.value) {
                    const val = cm.getValue();
                    if (activeFile.value.content !== val) {
                        activeFile.value.content = val;
                    }
                }
            });
        };

        const updateEditorMode = (filename) => {
            if (!editorInstance) return;
            let mode = 'htmlmixed';
            if (filename.endsWith('.css')) mode = 'css';
            if (filename.endsWith('.js')) mode = 'javascript';
            editorInstance.setOption('mode', mode);
        };

        watch(activeFileName, (newVal) => {
            if (newVal && editorInstance && activeFile.value) {
                const currentContent = editorInstance.getValue();
                if (currentContent !== activeFile.value.content) {
                    editorInstance.setValue(activeFile.value.content);
                }
                updateEditorMode(newVal);
                editorInstance.clearHistory();
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

        // --- PREVIEW LOGICA ---
        const updatePreview = () => {
            if (!files.value || files.value.length === 0) return;
            const getFileContent = (name) => {
                const f = files.value.find(file => file.name === name);
                return f ? f.content : '';
            };

            const html = getFileContent('index.html');
            const css = getFileContent('styles.css');
            const tailwindConfig = getFileContent('tailwind.js');
            const coreJs = getFileContent('core.js');
            const renderJs = getFileContent('render.js');

            const completeHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>${tailwindConfig}</script>
    <style>${css}</style>
</head>
<body>
    ${html}
    <script>${coreJs}</script>
    <script>${renderJs}</script>
</body>
</html>`;
            previewContent.value = completeHtml;
        };

        const setViewMode = (mode) => {
            viewMode.value = mode;
            if (mode !== 'preview') {
                nextTick(() => {
                    if (editorInstance) editorInstance.refresh();
                });
            }
        };

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

        // --- UPLOAD LOGICA ---
        const triggerUpload = () => fileInput.value.click();

        const handleFileUpload = async (event) => {
            const fileList = Array.from(event.target.files);
            if (!fileList.length) return;

            let uploadedCount = 0;
            for (const file of fileList) {
                const text = await file.text();
                const existingFile = files.value.find(f => f.name === file.name);
                if (existingFile) {
                    existingFile.content = text;
                    existingFile.lastModified = Date.now();
                } else {
                    files.value.push({
                        name: file.name,
                        content: text,
                        lastModified: Date.now()
                    });
                }
                uploadedCount++;
            }

            if (uploadedCount > 0) {
                showToast(`${uploadedCount} bestanden geupload`);
                if (editorInstance && activeFile.value) {
                    editorInstance.setValue(activeFile.value.content);
                }
                updatePreview();
                event.target.value = '';
                await createBackup(false);
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

        const openProject = async (projectId, projectName) => {
            if (!manager) return;
            isLoading.value = true;
            try {
                // Haal project detail op via OfflineManager
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
                    activeFileName.value = 'index.html';
                    
                    nextTick(() => {
                        initEditor();
                        updatePreview();
                    });
                } else {
                    showToast('Project data leeg', 'error');
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
                clearTimeout(previewTimeout);
                previewTimeout = setTimeout(updatePreview, 300);
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
        const createBackup = async (isInitial = false) => {
            if (!projectActive.value) return;

            if (!isInitial) {
                highestVersion.value = currentVersion.value + 1;
            }

            const snapshot = JSON.parse(JSON.stringify(files.value));
            const backupRecord = {
                version: currentVersion.value,
                timestamp: new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                files: snapshot
            };

            history.value.unshift(backupRecord);
            await saveToCloud(isInitial);

            if (!isInitial) {
                showToast(`Backup v${currentVersion.value}`, 'success');
            }
        };

        const setActiveFile = (name) => {
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

        const restoreVersion = async (backup) => {
            if (!confirm(`Versie v${backup.version} herstellen?`)) return;
            files.value = JSON.parse(JSON.stringify(backup.files));
            currentVersion.value = backup.version;
            if (editorInstance && activeFile.value) {
                editorInstance.setValue(activeFile.value.content);
            }
            showToast(`Versie v${backup.version} hersteld`, 'success');
            showHistoryModal.value = false;
            await saveToCloud(true);
            updatePreview();
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
            apiUrl
        };
    }
}).mount('#app');
