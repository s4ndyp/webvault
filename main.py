import os
import shutil
import threading
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# --- CONFIGURATIE ---
ADMIN_PORT = 80
PUBLIC_PORT = 8080
PUBLISH_DIR = '/var/www/published'
BUILDER_DIR = '/usr/src/app/builder'

# Zorg dat de mappen bestaan
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
        files = data.get('files', [])
        
        # Maak map leeg voor schone installatie
        if os.path.exists(PUBLISH_DIR):
            shutil.rmtree(PUBLISH_DIR)
        os.makedirs(PUBLISH_DIR)
        
        for file in files:
            # Veilig pad maken (voorkom dat bestanden buiten de map schrijven)
            filename = file['name'].lstrip('/')
            file_path = os.path.join(PUBLISH_DIR, filename)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(file['content'])
        
        server_status = "Running"
        return jsonify({"success": True, "message": "Gepubliceerd!"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app_admin.route('/api/stop-server', methods=['POST'])
def stop_server():
    global server_status
    try:
        if os.path.exists(PUBLISH_DIR):
            shutil.rmtree(PUBLISH_DIR)
        os.makedirs(PUBLISH_DIR)
        server_status = "Stopped"
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# --- BUILDER SERVING (PORT 80) ---
# Deze route zorgt dat de hoofdmap de index.html pakt
@app_admin.route('/')
def serve_builder_index():
    return send_from_directory(BUILDER_DIR, 'index.html')

# Deze route zorgt dat ALLE bestanden (ook in submappen) gevonden worden
@app_admin.route('/<path:filename>')
def serve_builder_files(filename):
    return send_from_directory(BUILDER_DIR, filename)

# --- PUBLIC SERVER (PORT 8080) ---
app_public = Flask(__name__)

@app_public.route('/')
def serve_public_index():
    return send_from_directory(PUBLISH_DIR, 'index.html')

@app_public.route('/<path:filename>')
def serve_public_files(filename):
    return send_from_directory(PUBLISH_DIR, filename)

# --- STARTUP ---
def run_admin():
    # threaded=True is belangrijk om meerdere verzoeken tegelijk aan te kunnen
    app_admin.run(host='0.0.0.0', port=ADMIN_PORT, threaded=True)

def run_public():
    app_public.run(host='0.0.0.0', port=PUBLIC_PORT, threaded=True)

if __name__ == '__main__':
    print(f"[*] Builder UI & API op poort {ADMIN_PORT}")
    threading.Thread(target=run_admin, daemon=True).start()
    
    print(f"[*] Publieke site op poort {PUBLIC_PORT}")
    run_public() # De laatste draait in de main thread
