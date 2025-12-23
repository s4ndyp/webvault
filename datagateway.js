/**
 * DataGateway - Communicates with backend API
 * ✅ NO IMPORTS - Works with classic <script> tags
 */
class DataGateway {
    constructor(baseUrl, clientId, appName) {
        this.baseUrl = baseUrl;
        this.clientId = clientId;
        this.appName = appName;
    }

    async saveDocument(collectionName, data) {
        const fullCollectionName = `${this.appName}_${collectionName}`;
        const url = `${this.baseUrl}/api/${fullCollectionName}${data._id ? '/' + data._id : ''}`;
        const method = data._id ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'x-client-id': this.clientId
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error(`[${method}] ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (err) {
            console.error(`[DataGateway] ${method} ${url}:`, err);
            throw err;
        }
    }

    async getCollection(collectionName) {
        const fullCollectionName = `${this.appName}_${collectionName}`;
        const url = `${this.baseUrl}/api/${fullCollectionName}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'x-client-id': this.clientId
                }
            });

            if (!response.ok) {
                throw new Error(`[GET] ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            return Array.isArray(data) ? data : data.data || [];
        } catch (err) {
            console.error(`[DataGateway] GET ${url}:`, err);
            return [];
        }
    }

    async deleteDocument(collectionName, documentId) {
        const fullCollectionName = `${this.appName}_${collectionName}`;
        const url = `${this.baseUrl}/api/${fullCollectionName}/${documentId}`;

        try {
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'x-client-id': this.clientId
                }
            });

            if (!response.ok) {
                throw new Error(`[DELETE] ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (err) {
            console.error(`[DataGateway] DELETE ${url}:`, err);
            throw err;
        }
    }
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.DataGateway = DataGateway;
}
