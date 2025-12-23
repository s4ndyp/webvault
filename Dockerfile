# Gebruik NGINX als basis
FROM nginx:alpine

# Installeer Node.js en NPM
RUN apk add --no-cache nodejs npm

# Maak de mappen aan
RUN mkdir -p /var/www/published
RUN mkdir -p /usr/src/app

# Kopieer de Editor bestanden (HTML, JS, CSS) naar de NGINX map
COPY ./index.html /usr/share/nginx/html/
COPY ./core.js /usr/share/nginx/html/
COPY ./render.js /usr/share/nginx/html/
COPY ./styles.css /usr/share/nginx/html/
COPY ./offline_managerv2.js /usr/share/nginx/html/
COPY ./tailwind.js /usr/share/nginx/html/

# Kopieer de API server bestanden
COPY ./server.js /usr/src/app/
COPY ./package.json /usr/src/app/

# Installeer Node dependencies
WORKDIR /usr/src/app
RUN npm install

# Kopieer de NGINX configuratie
COPY ./nginx.conf /etc/nginx/nginx.conf

# Start script maken om zowel NGINX als Node te starten
RUN echo "#!/bin/sh" > /start.sh && \
    echo "node /usr/src/app/server.js &" >> /start.sh && \
    echo "nginx -g 'daemon off;'" >> /start.sh && \
    chmod +x /start.sh

# Open de poorten: 80 (Builder), 8080 (Live Site), 5000 (API)
EXPOSE 80 8080 5000

CMD ["/start.sh"]
