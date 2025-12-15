// CONFIGURATIE
const API_CONFIG = {
    BASE_URL: 'http://10.10.2.20:8080',
    ENDPOINTS: {
        LOGIN: '/api/auth/login',
        BASE_API: '/api/sitebuilder'
    },
    TOKEN_KEY: 'SITEBUILDER_JWT_TOKEN'
};

// STATE
let isLoggedIn = false;
let authToken = localStorage.getItem(API_CONFIG.TOKEN_KEY);

// --- HULP FUNCTIES VOOR DATA MAPPING ---
// Zorgt ervoor dat alle projectobjecten dezelfde structuur hebben: id, name, lastModified, etc.
function normalizeProjectData(doc) {
    if (!doc) return null;

    let coreData = doc;
    // 1. Check of de data in een 'data' wrapper zit (dit is de fix voor de lijst)
    if (doc.data && typeof doc.data === 'object') {
        coreData = doc.data;
    }

    // 2. ID Mapping
    const id = doc.id || doc._id || coreData.id || coreData._id;

    // 3. Naam Mapping
    const name = coreData.name || coreData.title || 'Naamloos Project';
    
    // 4. Tijd Mapping (Sterkere logica om de laatste wijzigingstijd te vinden)
    let lastModified = coreData.lastModified || 0; 
    
    // NIEUW: Fallback 1: Controleer de meta data van de backend
    if (!lastModified && coreData.meta && coreData.meta.updated_at) {
        lastModified = coreData.meta.updated_at; // Pakt "Mon, 15 Dec 2025 20:29:48 GMT"
    }

    // Fallback 2: Standaard database velden
    if (!lastModified) {
        lastModified = coreData.updatedAt || coreData.createdAt || 0;
    }

    // Convert string date (zoals uit 'meta.updated_at') to timestamp
    if (typeof lastModified === 'string') {
        const date = new Date(lastModified);
        // lastModified wordt een millisecond timestamp (dit is cruciaal)
        lastModified = isNaN(date.getTime()) ? 0 : date.getTime();
    }
    
    // 5. Combineer en garandeer array-structuren
    return {
        ...coreData,      
        id: id,           
        _id: id,          
        name: name, // Nu gegarandeerd aanwezig
        lastModified: lastModified, // Nu gegarandeerd een timestamp
        files: Array.isArray(coreData.files) ? coreData.files : [],
        history: Array.isArray(coreData.history) ? coreData.history : [],
    };
}

// --- AUTH FUNCTIES ---
async function loginUser(username, password) {
    try {
        console.log('Poging tot inloggen op:', `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.LOGIN}`);
        const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.LOGIN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.token) {
                authToken = data.token;
                localStorage.setItem(API_CONFIG.TOKEN_KEY, authToken);
                isLoggedIn = true;
                return { success: true };
            }
        }
        return { success: false, message: 'Ongeldige inloggegevens' };
    } catch (error) {
        console.error('Login error:', error);
        return { success: false, message: 'Kan geen verbinding maken met server' };
    }
}

function logoutUser() {
    authToken = null;
    isLoggedIn = false;
    localStorage.removeItem(API_CONFIG.TOKEN_KEY);
    window.location.reload(); 
}

// GENERIC FETCH MET AUTH HEADER
async function fetchWithAuth(endpoint, options = {}) {
    if (!authToken) return null;

    const defaultHeaders = {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
    };

    const config = {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers
        }
    };

    try {
        const url = `${API_CONFIG.BASE_URL}${endpoint}`;
        const response = await fetch(url, config);
        
        if (response.status === 401) {
            console.warn('Token verlopen, uitloggen...');
            logoutUser();
            return null;
        }
        
        return response;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// --- PROJECT API'S ---

// 1. Haal lijst van alle projecten op
async function fetchProjectList() {
    console.log('Ophalen projectlijst...');
    const response = await fetchWithAuth(API_CONFIG.ENDPOINTS.BASE_API, {
        method: 'GET'
    });
    
    if (response && response.ok) {
        const rawData = await response.json();
        console.log('Ruwe lijst data van server:', rawData);
        
        let projectsArray = rawData;
        
        // VEILIGHEIDSCHECK: haal de array uit een eventuele wrapper (zoals { data: [...] })
        if (rawData && Array.isArray(rawData.projects)) {
             projectsArray = rawData.projects;
        } else if (rawData && Array.isArray(rawData.data)) {
             projectsArray = rawData.data;
        }

        if (Array.isArray(projectsArray)) {
            // Pas normalisatie toe op elk lijst-item
            return projectsArray.map(item => normalizeProjectData(item)).filter(p => p && p.id);
        }
        return [];
    }
    return [];
}

// 2. Haal specifiek project op
async function fetchProjectDetails(projectId) {
    console.log(`Ophalen details voor project ID: ${projectId}`);
    const response = await fetchWithAuth(`${API_CONFIG.ENDPOINTS.BASE_API}/${projectId}`, {
        method: 'GET'
    });
    
    if (response && response.ok) {
        const rawData = await response.json();
        console.log('Ruwe project details van server:', rawData);
        
        // Normaliseer de details
        return normalizeProjectData(rawData);
    }
    return null;
}

// 3. Sla project op
async function saveProjectToCloud(projectData) {
    let url = API_CONFIG.ENDPOINTS.BASE_API;
    let method = 'POST';

    if (projectData.id) {
        url = `${API_CONFIG.ENDPOINTS.BASE_API}/${projectData.id}`;
        method = 'PUT'; 
    }

    console.log(`Opslaan project (${method}):`, projectData);

    const response = await fetchWithAuth(url, {
        method: method,
        body: JSON.stringify(projectData)
    });

    if (response && response.ok) {
        const result = await response.json();
        return normalizeProjectData(result);
    }
    throw new Error('Opslaan mislukt');
}

// 4. Verwijder project
async function deleteProjectFromCloud(projectId) {
    await fetchWithAuth(`${API_CONFIG.ENDPOINTS.BASE_API}/${projectId}`, {
        method: 'DELETE'
    });
}

function hasToken() {
    return !!authToken;
}