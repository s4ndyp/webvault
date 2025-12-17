// CONFIGURATIE
const API_CONFIG = {
    // De BASE_URL is nu een lege string. Dit zorgt ervoor dat API-requests
    // relatief zijn aan het huidige domein. De gateway die deze frontend serveert,
    // zal de requests (bijv. /api/sitebuilder) opvangen en doorsturen.
    BASE_URL: '',
    ENDPOINTS: {
        // De gateway gebruikt een generieke endpoint structuur. We specificeren hier de collectienaam.
        BASE_API: '/api/sitebuilder'
    },
    CLIENT_ID_KEY: 'SITEBUILDER_CLIENT_ID' // Vervangt de JWT token key
};

// STATE
let clientId = localStorage.getItem(API_CONFIG.CLIENT_ID_KEY);

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
    // De gateway levert consistent een '_id' veld.
    const id = doc._id || doc.id || coreData._id || coreData.id;

    // 3. Naam Mapping
    const name = coreData.name || coreData.title || 'Naamloos Project';
    
    // 4. Tijd Mapping (aangepast voor de gateway)
    // De gateway levert een '_updated_at' of '_created_at' ISO string.
    let lastModified = coreData._updated_at || coreData._created_at || coreData.lastModified;

    // Converteer string datum naar een numerieke timestamp
    if (typeof lastModified === 'string') {
        const date = new Date(lastModified);
        lastModified = isNaN(date.getTime()) ? 0 : date.getTime();
    } else if (typeof lastModified !== 'number') {
        lastModified = 0;
    }

    // 5. Combineer en garandeer array-structuren
    return {
        ...coreData,      
        id: id,           
        _id: id,          
        name: name,
        lastModified: lastModified,
        files: Array.isArray(coreData.files) ? coreData.files : [],
        history: Array.isArray(coreData.history) ? coreData.history : [],
    };
}

// --- AUTH FUNCTIES ---
async function loginUser(username, _password) {
    // De gateway gebruikt geen wachtwoord, maar een 'x-client-id'.
    // We simuleren hier de login door de gebruikersnaam als client-id in te stellen.
    // In een productieomgeving zou een aparte auth-service dit ID bepalen.
    if (username) {
        clientId = username;
        localStorage.setItem(API_CONFIG.CLIENT_ID_KEY, clientId);
        console.log(`Client ID ingesteld op: ${clientId}`);
        return { success: true };
    }
    return { success: false, message: 'Gebruikersnaam (Client ID) is verplicht' };
}

function logoutUser() {
    clientId = null;
    localStorage.removeItem(API_CONFIG.CLIENT_ID_KEY);
    window.location.reload(); 
}

// GENERIC FETCH MET AUTH HEADER
async function fetchWithAuth(endpoint, options = {}) {
    if (!clientId) return null;

    const defaultHeaders = {
        'x-client-id': clientId, // Gebruik de x-client-id header die de gateway verwacht
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
            console.warn('Niet geautoriseerd, uitloggen...');
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
        
        // De gateway retourneert direct een array.
        const projectsArray = rawData;
        
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
        // Bij een PUT request retourneert de gateway alleen een status.
        // Bij een POST request een nieuw object met _id.
        // We geven de originele data terug, aangevuld met een eventueel nieuw ID.
        const finalData = { ...projectData, ...result };
        return normalizeProjectData(finalData);
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