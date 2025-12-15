// Render logica placeholder
// In deze app wordt de render logica voornamelijk afgehandeld door Vue in core.js
// en de preview/zip functionaliteit.
// Dit bestand is aanwezig om de gevraagde structuur te behouden.

console.log('Render module geladen');

const formatDate = (date) => {
    return new Intl.DateTimeFormat('nl-NL', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    }).format(date);
};
