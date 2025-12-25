# Gebruik Python als basis
FROM python:3.11-slim

# Werkmap aanmaken
WORKDIR /usr/src/app

# Installeer Flask en CORS
RUN pip install flask flask-cors

# Mappen aanmaken voor de editor en de output
RUN mkdir -p /usr/src/app/builder
RUN mkdir -p /var/www/published

# Kopieer de Editor bestanden naar de builder map
COPY ./index.html ./builder/
COPY ./core.js ./builder/
COPY ./render.js ./builder/
COPY ./styles.css ./builder/
COPY ./offline_managerv2.js ./builder/
COPY ./tailwind.js ./builder/

# Kopieer het Python script
COPY ./main.py .

# Open de poorten
EXPOSE 80 8080

# Start de Python server
CMD ["python", "main.py"]
