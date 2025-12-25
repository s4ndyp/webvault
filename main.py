import os
import shutil
import threading
import traceback
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
        print(f"[*] Ontvangen: {len(files)} bestanden voor publicatie.")
        
        # STAP 1: Maak de map leeg zonder de hoofdmap zelf te verwijderen
        # Dit is veel veiliger voor Docker-mounts en voorkomt 500 errors
        if os.path.exists(PUBLISH_DIR):
            for filename in os.listdir(PUBLISH_DIR):
                file_path = os.path.join(PUBLISH_DIR, filename)
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        os.unlink(file_path)
                    elif os.path.isdir(file_path):
                        shutil.rmtree(file_path)
                except Exception as e:
                    print(f"  [!] Waarschuwing: Kon {filename} niet verwijderen: {e}")
        else:
            os.makedirs(PUBLISH_DIR, exist_ok=True)
        
        # STAP 2: Schrijf de nieuwe bestanden
        for file in files:
            name = file.get('name', '').lstrip('/')
            if not name:
                continue
                
            content = file.get('content', '')
            file_path = os.path.join(PUBLISH_DIR, name)
            
            # Maak submappen aan (bijv. voor css/style.css)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            
            # Zet rechten op 644 zodat de webserver ze kan lezen
            os.chmod(file_path, 0o644)
        
        server_status = "Running"
        print("[*] Publicatie succesvol voltooid.")
        return jsonify({"success": True, "message": "Gepubliceerd!"})
        
    except Exception as e:
        print("[!] CRASH in /api/publish:")
        traceback.print_exc() # Dit print de exacte regelcode van de fout in Docker logs
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
