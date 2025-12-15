const { createApp, ref, computed, onMounted, onUnmounted, watch, nextTick } = Vue;

createApp({
    setup() {
        // STATE INITIALISATIE
        const isAuthenticated = ref(false);
        const isLoading = ref(false);
        const loginForm = ref({ username: '', password: '' });
        const loginError = ref('');
        const showNewProjectModal = ref(false);
        const newProjectName = ref('');
        const projectNameInput = ref(null);
        
        const fileInput = ref(null);
        const editorContainer = ref(null);
        let editorInstance = null; // CodeMirror instantie

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

        const REQUIRED_FILES = [
            'index.html', 'styles.css', 'tailwind.js', 'core.js', 'render.js', 'auth.js'
        ];

        // --- INIT ---
        onMounted(async () => {
            if (hasToken()) {
                isAuthenticated.value = true;
                await refreshProjectList();
            }
            timerInterval = setInterval(() => { currentTime.value = Date.now(); }, 60000);
        });

        // --- CODEMIRROR EDITOR SETUP ---
        const initEditor = () => {
            if (!editorContainer.value) return;
            
            // Als er al een editor is, maak leeg (veiligheid)
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

            // Sync: Editor -> Data
            editorInstance.on('change', (cm) => {
                if (activeFile.value) {
                    const val = cm.getValue();
                    if (activeFile.value.content !== val) {
                        activeFile.value.content = val;
                        // Trigger preview update (handled by watcher)
                    }
                }
            });
        };

        // Update Editor mode op basis van bestandsextensie
        const updateEditorMode = (filename) => {
            if (!editorInstance) return;
            let mode = 'htmlmixed';
            if (filename.endsWith('.css')) mode = 'css';
            if (filename.endsWith('.js')) mode = 'javascript';
            editorInstance.setOption('mode', mode);
        };

        // Update Editor inhoud als bestand wisselt (Data -> Editor)
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

        // Als we naar edit mode gaan, zorg dat editor laadt
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
            const authJs = getFileContent('auth.js');
            const coreJs = getFileContent('core.js');
            const renderJs = getFileContent('render.js'); 
            
            const completeHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <script src="https://cdn.tailwindcss.com"><\/script>
                    <script>
                        ${tailwindConfig}
                    <\/script>
                    <style>
                        ${css}
                    </style>
                </head>
                <body>
                    ${html}
                    
                    <script>
                        ${authJs}
                    <\/script>
                    <script>
                        ${coreJs}
                    <\/script>
                    <script>
                        ${renderJs}
                    <\/script>
                </body>
                </html>
            `;
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

        // --- VERSIE INSERTIE (AANGEPAST) ---
        const insertVersionComment = () => {
            if (!activeFile.value || !editorInstance) return;

            // Zorg EERST dat de editor focus heeft, anders weet hij de cursorpositie niet
            editorInstance.focus();

            const fileName = activeFile.value.name.toLowerCase();
            const versionString = `v${currentVersion.value}`;
            let comment = '';

            if (fileName.endsWith('.html')) {
                comment = ``;
            } else {
                comment = `/* ${versionString} */`;
            }

            const doc = editorInstance.getDoc();
            const cursor = doc.getCursor();
            
            // Veilig invoegen
            if(cursor) {
                doc.replaceRange(comment, cursor);
                showToast(`Versie ${versionString} ingevoegd!`);
            } else {
                // Fallback als cursor positie niet gevonden kan worden (bijv. helemaal begin)
                doc.replaceRange(comment, {line: 0, ch: 0});
                showToast(`Versie ${versionString} ingevoegd (start)!`);
            }
        };


        // --- UPLOAD LOGICA ---
        const triggerUpload = () => { fileInput.value.click(); };

        const handleFileUpload = async (event) => {
            const fileList = Array.from(event.target.files);
            if (!fileList.length) return;
            let uploadedCount = 0;
            for (const file of fileList) {
                const text = await file.text();
                const existingFile = files.value.find(f => f.name === file.name);
                if (existingFile) {
                    existingFile.content = text; existingFile.lastModified = Date.now();
                } else {
                    files.value.push({ name: file.name, content: text, lastModified: Date.now() });
                }
                uploadedCount++;
            }
            if (uploadedCount > 0) {
                showToast(`${uploadedCount} bestand(en) geüpload`);
                if (editorInstance && activeFile.value) {
                    editorInstance.setValue(activeFile.value.content);
                }
                updatePreview();
                event.target.value = '';
                await createBackup(); 
            }
        };

        // --- STANDAARD LOGICA ---
        const handleLogin = async () => {
            isLoading.value = true;
            loginError.value = '';
            const result = await loginUser(loginForm.value.username, loginForm.value.password);
            if (result.success) {
                isAuthenticated.value = true;
                showToast('Ingelogd!', 'success');
                await refreshProjectList();
            } else {
                loginError.value = result.message;
            }
            isLoading.value = false;
        };

        const handleLogout = () => { logoutUser(); };

        const refreshProjectList = async () => {
            isLoading.value = true;
            try { projectList.value = await fetchProjectList(); } 
            catch (e) { console.error(e); showToast('Kon projecten niet laden'); } 
            finally { isLoading.value = false; }
        };

        const openProject = async (projectId) => {
            isLoading.value = true;
            try {
                const projectData = await fetchProjectDetails(projectId);
                if (projectData) {
                    currentProjectId.value = projectData.id;
                    currentProjectName.value = projectData.name;
                    files.value = (projectData.files && projectData.files.length > 0) ? projectData.files : [];
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
                    showToast('Project data is leeg');
                }
            } catch (e) {
                console.error('Fout bij openen:', e); showToast('Fout bij openen project');
            } finally {
                isLoading.value = false;
            }
        };

        const closeProject = async () => {
            projectActive.value = false; currentProjectId.value = null; currentProjectName.value = '';
            files.value = []; previewContent.value = '';
            editorInstance = null; // Clean up
            await refreshProjectList(); 
        };

        let previewTimeout;
        watch(files, () => {
            if (projectActive.value) {
                clearTimeout(previewTimeout);
                previewTimeout = setTimeout(() => { updatePreview(); }, 300);
            }
        }, { deep: true });

        const createProject = async () => {
            if (!newProjectName.value) return;
            isLoading.value = true;
            const initialFiles = REQUIRED_FILES.map(name => ({ name: name, content: '', lastModified: Date.now() }));
            const newProjectData = { name: newProjectName.value, files: initialFiles, history: [], currentVersion: 1, highestVersion: 1 };
            try {
                const createdProject = await saveProjectToCloud(newProjectData);
                showNewProjectModal.value = false;
                if (createdProject && createdProject.id) {
                    currentProjectId.value = createdProject.id;
                    currentProjectName.value = newProjectName.value;
                    files.value = initialFiles; history.value = []; currentVersion.value = 1; highestVersion.value = 1;
                    projectActive.value = true; activeFileName.value = 'index.html'; newProjectName.value = '';
                    
                    nextTick(() => {
                        initEditor();
                        updatePreview();
                    });
                    await createBackup(true); 
                    showToast('Project aangemaakt!');
                }
            } catch (e) {
                console.error(e); showToast('Kon project niet aanmaken');
            } finally {
                isLoading.value = false;
            }
        };

        const deleteProject = async (id) => {
            if (!confirm('Weet je zeker dat je dit hele project wilt verwijderen?')) return;
            try { await deleteProjectFromCloud(id); showToast('Project verwijderd'); await refreshProjectList(); } catch (e) { showToast('Kon niet verwijderen'); }
        };

        const saveToCloud = async (isSilent = false) => {
            if (!currentProjectId.value) return;
            const dataPayload = { id: currentProjectId.value, name: currentProjectName.value, files: files.value, history: history.value, currentVersion: currentVersion.value, highestVersion: highestVersion.value };
            try { await saveProjectToCloud(dataPayload); if (!isSilent) showToast('Opgeslagen'); } catch (e) { showToast('Fout bij opslaan!'); }
        };

        const createBackup = async (isInitial = false) => {
            if (!projectActive.value) return;
            if (!isInitial) { highestVersion.value++; currentVersion.value = highestVersion.value; }
            const snapshot = JSON.parse(JSON.stringify(files.value));
            const backupRecord = { version: currentVersion.value, timestamp: new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), files: snapshot };
            history.value.unshift(backupRecord);
            await saveToCloud(isInitial);
            if (!isInitial) showToast(`Backup v${currentVersion.value}`);
        };

        const setActiveFile = (name) => { activeFileName.value = name; };
        const activeFile = computed(() => files.value.find(f => f.name === activeFileName.value));

        watch(() => activeFile.value?.content, (newContent, oldContent) => {
            if (activeFile.value && newContent !== oldContent) { activeFile.value.lastModified = Date.now(); }
        });

        watch(showNewProjectModal, (val) => { if (val) nextTick(() => projectNameInput.value?.focus()); });

        let timerInterval;
        onUnmounted(() => { if (timerInterval) clearInterval(timerInterval); });

        const pasteFromClipboard = async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (editorInstance) {
                    const doc = editorInstance.getDoc();
                    const cursor = doc.getCursor();
                    doc.replaceRange(text, cursor);
                    showToast('Code geplakt!');
                }
            } catch (err) { alert('Kon niet plakken. Gebruik CTRL+V / CMD+V.'); }
        };

        const copyContent = () => { if (activeFile.value) { navigator.clipboard.writeText(activeFile.value.content); showToast('Gekopieerd!'); } };

        const clearContent = () => {
            if (!activeFile.value) return;
            if (confirm(`Weet je zeker dat je "${activeFile.value.name}" leeg wilt maken?`)) {
                activeFile.value.content = ''; 
                if (editorInstance) editorInstance.setValue('');
                activeFile.value.lastModified = Date.now(); 
                showToast('Inhoud gewist');
            }
        };

        const restoreVersion = async (backup) => {
            if (!confirm(`Versie ${backup.version} herstellen?`)) return;
            files.value = JSON.parse(JSON.stringify(backup.files)); currentVersion.value = backup.version; 
            if(editorInstance && activeFile.value) editorInstance.setValue(activeFile.value.content);
            showToast(`Versie ${backup.version} hersteld`); showHistoryModal.value = false; await saveToCloud(true); updatePreview();
        };

        const deleteBackup = async (version) => {
            if(!confirm(`Backup v${version} verwijderen?`)) return;
            history.value = history.value.filter(h => h.version !== version); await saveToCloud(true); showToast(`Backup v${version} verwijderd`);
        };

        const downloadZip = () => {
            const zip = new JSZip(); files.value.forEach(file => { zip.file(file.name, file.content); });
            const fileName = `${currentProjectName.value.replace(/\s+/g, '_')}_v${currentVersion.value}.zip`;
            zip.generateAsync({type:"blob"}).then(function(content) { saveAs(content, fileName); showToast('Zip gedownload'); });
        };

        const getFileIcon = (filename) => {
            if (filename.endsWith('.html')) return 'fas fa-globe text-orange-500';
            if (filename.endsWith('.css')) return 'fab fa-css3-alt text-blue-500';
            if (filename.endsWith('.js')) return 'fab fa-js text-yellow-400';
            return 'fas fa-file text-gray-400';
        };

        const formatTimeAgo = (timestamp) => {
            if (!timestamp) return ''; const now = currentTime.value; const diff = now - timestamp;
            const minutes = Math.floor(diff / 60000); const hours = Math.floor(diff / 3600000); const days = Math.floor(diff / 86400000);
            if (diff < 60000) return 'zojuist'; if (minutes < 60) return `${minutes} min`; if (hours < 24) return `${hours} uur`; return `${days} dagen`;
        };

        const showToast = (msg, type = 'normal') => { savedMessage.value = msg; setTimeout(() => savedMessage.value = '', 3000); };

        return {
            isAuthenticated, isLoading, loginForm, loginError, handleLogin, handleLogout,
            projectList, showNewProjectModal, newProjectName, projectNameInput, createProject, openProject, closeProject, deleteProject, currentProjectName,
            projectActive, currentVersion, highestVersion, files, activeFileName, activeFile, history,
            showHistoryModal, showMobileMenu, savedMessage,
            setActiveFile, pasteFromClipboard, copyContent, clearContent,
            createBackup, restoreVersion, deleteBackup, downloadZip, getFileIcon, formatTimeAgo,
            // NIEUWE RETURNS
            fileInput, triggerUpload, handleFileUpload,
            viewMode, setViewMode, previewContent,
            insertVersionComment, editorContainer
        };
    }
}).mount('#app');