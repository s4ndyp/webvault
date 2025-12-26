import os
import shutil
import threading
import traceback
import re
import time # Zorg dat deze import bovenaan staat
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# --- CONFIGURATIE ---
ADMIN_PORT = 80
PUBLIC_PORT = 8080
PUBLISH_DIR = '/var/www/published'
BUILDER_DIR = '/usr/src/app/builder'

# Zorg dat de mappen bestaan bij opstarten
os.makedirs(PUBLISH_DIR, exist_ok=True)
os.makedirs(BUILDER_DIR, exist_ok=True)

app_admin = Flask(__name__)
CORS(app_admin)
server_status = "Stopped"

# --- API ROUTES (ADMIN) ---

@app_admin.route('/api/server-status', methods=['GET'])
def get_status():
    return jsonify({"status": server_status})

@app_admin.route('/api/publish', methods=['POST'])
def publish():
    global server_status
    try:
        data = request.json
        if not data:
            return jsonify({"success": False, "error": "Geen data ontvangen"}), 400
            
        files = data.get('files', [])
        version_label = str(data.get('version', '0'))
        
        # --- DE UNIEKE TIMESTAMP LOGICA ---
        # We maken een tag die eruit ziet als: "1-1703581234" of "Experiment-1703581234"
        # Dit is altijd uniek voor de browser.
        timestamp = int(time.time())
        cache_buster_tag = f"{version_label}-{timestamp}"
        
        print(f"[*] Publiceren: {version_label} (Cache Tag: {cache_buster_tag})")
        
        # Map leegmaken (bestaande logica blijft hetzelfde)
        if os.path.exists(PUBLISH_DIR):
            for filename in os.listdir(PUBLISH_DIR):
                file_path = os.path.join(PUBLISH_DIR, filename)
                if os.path.isfile(file_path): os.unlink(file_path)
                elif os.path.isdir(file_path): shutil.rmtree(file_path)

        # Bestanden opslaan
        for file in files:
            name = file.get('name')
            content = file.get('content', '')
            
            if name == 'index.html':
                # We plakken de unieke cache_buster_tag achter de bestanden
                content = re.sub(r'(href="[^"]+\.css)', f'\\1?v={cache_buster_tag}', content)
                content = re.sub(r'(src="[^"]+\.js)', f'\\1?v={cache_buster_tag}', content)
            
            file_path = os.path.join(PUBLISH_DIR, name)
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            
        server_status = "Running"
        # We sturen het versienummer terug voor je UI, maar de bestanden zijn nu uniek getagd
        return jsonify({
            "success": True, 
            "message": f"Gepubliceerd met cache-tag {cache_buster_tag}",
            "version": version_label 
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app_admin.route('/api/stop-server', methods=['POST'])
def stop_server():
    global server_status
    try:
        # Alleen de inhoud wissen
        for filename in os.listdir(PUBLISH_DIR):
            file_path = os.path.join(PUBLISH_DIR, filename)
            if os.path.isfile(file_path): os.unlink(file_path)
            elif os.path.isdir(file_path): shutil.rmtree(file_path)
            
        server_status = "Stopped"
        return jsonify({"success": True})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

# --- BUILDER SERVING (PORT 80) ---

@app_admin.route('/')
def serve_builder_index():
    return send_from_directory(BUILDER_DIR, 'index.html')

@app_admin.route('/<path:filename>')
def serve_builder_files(filename):
    # Als het pad een API aanroep is, laat Flask de API routes gebruiken
    if filename.startswith('api/'):
        return None 
    return send_from_directory(BUILDER_DIR, filename)

# --- PUBLIC SERVER (PORT 8080) ---
app_public = Flask(__name__)

@app_public.route('/')
def serve_public_index():
    return send_from_directory(PUBLISH_DIR, 'index.html')

@app_public.route('/<path:filename>')
def serve_public_files(filename):
    return send_from_directory(PUBLISH_DIR, filename)

# --- STARTUP LOGICA ---

def run_admin():
    print(f"[*] Admin UI & API draait op poort {ADMIN_PORT}")
    app_admin.run(host='0.0.0.0', port=ADMIN_PORT, threaded=True)

def run_public():
    print(f"[*] Publieke site draait op poort {PUBLIC_PORT}")
    app_public.run(host='0.0.0.0', port=PUBLIC_PORT, threaded=True)

if __name__ == '__main__':
    # Start de Admin server in een aparte thread
    t = threading.Thread(target=run_admin)
    t.daemon = True
    t.start()
    
    # Start de Public server in de hoofd-thread
    run_public()
