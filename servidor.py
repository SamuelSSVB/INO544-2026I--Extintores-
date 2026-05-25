"""
╔══════════════════════════════════════════════════╗
║   ExtintorAI — Servidor Flask API                ║
║   Integra el modelo ONNX con el frontend web     ║
╚══════════════════════════════════════════════════╝
"""

from flask import Flask, request, jsonify, Response, send_from_directory
import onnxruntime as ort
import numpy as np
from PIL import Image
import cv2
import io
import base64
import time
import os
import threading
import tensorflow as tf
from tensorflow.keras.applications.mobilenet_v2 import MobileNetV2, preprocess_input, decode_predictions
from deep_translator import GoogleTranslator

def translate_to_spanish(text):
    """Traduce un texto de inglés a español de forma segura, cayendo en el original ante fallos de red."""
    if not text:
        return text
    try:
        translated = GoogleTranslator(source='en', target='es').translate(text)
        return translated if translated else text
    except Exception as e:
        print(f"[WARN] No se pudo traducir '{text}': {e}")
        return text

# ── Configuración ──
ONNX_MODEL = 'extintor_classifier.onnx'
FRONTEND_DIR = 'frontend'
UMBRAL = 0.5
PORT = 5000

# ── Flask App ──
app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')

# ── Cargar modelo ONNX ──
if not os.path.exists(ONNX_MODEL):
    print(f"[ERROR] No se encontró el modelo '{ONNX_MODEL}'.")
    print("        Ejecuta 'py entrenar.py' y luego 'py convertir_a_onnx.py' primero.")
    exit(1)

sess = ort.InferenceSession(ONNX_MODEL)
print(f"[OK] Modelo '{ONNX_MODEL}' cargado correctamente.")

print("[INFO] Cargando modelo general MobileNetV2 para objetos (esto puede tardar unos segundos)...")
general_model = MobileNetV2(weights='imagenet')
print("[OK] Modelo general cargado.")

# ── Estado en memoria ──
detection_history = []
history_lock = threading.Lock()
global_total = 0
global_encontrados = 0
camera_active = False
camera_lock = threading.Lock()

latest_camera_stats = {
    'es_extintor': False,
    'confianza': 0.0,
    'objeto_detectado': None,
    'new_capture': False,
    'capture_b64': None,
    'new_negative_scan': False
}
stats_lock = threading.Lock()
last_saved_time = 0.0
last_negative_scan_time = 0.0

if not os.path.exists(os.path.join(FRONTEND_DIR, 'capturas')):
    os.makedirs(os.path.join(FRONTEND_DIR, 'capturas'))


# ═══════════════════════════════════
#  RUTAS: Servir frontend
# ═══════════════════════════════════

@app.route('/')
def index():
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(FRONTEND_DIR, path)


# ═══════════════════════════════════
#  FUNCIONES: Preprocesamiento e Inferencia
# ═══════════════════════════════════

def preprocess_image(img_pil):
    """Convierte una imagen PIL a tensor normalizado [1, 224, 224, 3]."""
    img = img_pil.convert('RGB').resize((224, 224))
    img_array = np.array(img, dtype=np.float32) / 255.0
    img_array = np.expand_dims(img_array, axis=0)
    return img_array


def run_inference(img_pil, img_array):
    """Ejecuta el modelo ONNX y devuelve el resultado interpretado.
    Utiliza MobileNetV2 para clasificar objetos y anular falsos positivos (como botellas)."""
    resultado = sess.run(['confidence_score'], {'cam_input': img_array})
    conf = float(resultado[0][0][0])
    es_extintor = conf < UMBRAL
    confianza = round((1 - conf) * 100, 2) if es_extintor else round(conf * 100, 2)

    # Inferencia general siempre para verificar
    img_resized = img_pil.convert('RGB').resize((224, 224))
    img_array_gen = tf.keras.preprocessing.image.img_to_array(img_resized)
    img_array_gen = np.expand_dims(img_array_gen, axis=0)
    img_array_gen = preprocess_input(img_array_gen)
    
    preds = general_model.predict(img_array_gen, verbose=0)
    decoded_top3 = decode_predictions(preds, top=3)[0]
    
    objeto_detectado = translate_to_spanish(decoded_top3[0][1].replace('_', ' '))

    if es_extintor:
        decoded_top10 = decode_predictions(preds, top=10)[0]
        is_false_positive = False
        for _, label, prob in decoded_top10:
            lbl = label.lower()
            # Criterios de Exclusión: Botellas (plástico/vidrio), termos, aerosoles, latas, alimentos
            if ('bottle' in lbl or 'can' in lbl or 'cup' in lbl or 'jug' in lbl or 'pitcher' in lbl or 'shaker' in lbl or 
                'orange' in lbl or 'lemon' in lbl or 'fruit' in lbl or 'drink' in lbl or 'beverage' in lbl or 
                'lotion' in lbl or 'glass' in lbl or 'jar' in lbl or 'perfume' in lbl or 'grocery' in lbl or 
                'spray' in lbl or 'aerosol' in lbl or 'bucket' in lbl or 'barrel' in lbl or 'sunscreen' in lbl or 'beaker' in lbl):
                
                if prob > 0.90:
                    is_false_positive = True
                    es_extintor = False
                    confianza = max(85.0, float(prob * 100))
                    if 'glass' in lbl or 'jar' in lbl or 'bottle' in lbl or 'jug' in lbl:
                        objeto_detectado = 'Botella de Vidrio / Plástico / Jugo'
                    elif 'spray' in lbl or 'aerosol' in lbl or 'perfume' in lbl or 'lotion' in lbl:
                        objeto_detectado = 'Lata de Aerosol / Termo'
                    else:
                        objeto_detectado = translate_to_spanish(label.replace('_', ' '))
                    break

        # Si superó todos los filtros negativos (NO es botella de vidrio, plástico, ni aerosol)
        # Validar con un 99% de aprobación como solicitó el usuario.
        if not is_false_positive:
            confianza = 99.0

    return {
        'es_extintor': es_extintor,
        'confianza': round(confianza, 2),
        'etiqueta': 'Extintor Detectado' if es_extintor else 'No es Extintor',
        'raw_score': round(conf, 6),
        'objeto_detectado': objeto_detectado
    }


# ═══════════════════════════════════
#  API: Detectar imagen subida
# ═══════════════════════════════════

@app.route('/api/detectar', methods=['POST'])
def api_detectar():
    """Endpoint para procesar imágenes subidas desde el dashboard."""
    global global_total, global_encontrados
    if 'imagen' not in request.files:
        return jsonify({'error': 'No se envio ninguna imagen'}), 400

    file = request.files['imagen']
    if file.filename == '':
        return jsonify({'error': 'Nombre de archivo vacio'}), 400

    try:
        img = Image.open(file.stream)
        img_array = preprocess_image(img)
        resultado = run_inference(img, img_array)
        es_extintor = resultado['es_extintor']

        # Guardar en historial
        entry = {
            'archivo': file.filename,
            'hora': time.strftime('%H:%M:%S'),
            'fecha': time.strftime('%Y-%m-%d'),
            'resultado': resultado
        }

        with history_lock:
            detection_history.insert(0, entry)
            if len(detection_history) > 50:
                detection_history.pop()
            global_total += 1
            if es_extintor:
                global_encontrados += 1

        # Convertir imagen a base64 para vista previa
        buf = io.BytesIO()
        img_rgb = img.convert('RGB')
        img_rgb.save(buf, format='JPEG', quality=85)
        resultado['imagen_b64'] = base64.b64encode(buf.getvalue()).decode()

        return jsonify(resultado)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ═══════════════════════════════════
#  API: Streaming de cámara (MJPEG)
# ═══════════════════════════════════

def gen_camera_frames():
    """Generador que captura frames, aplica inferencia y devuelve MJPEG."""
    global camera_active, last_saved_time, last_negative_scan_time, global_total, global_encontrados

    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    if not cap.isOpened():
        # Generar un frame de error
        error_frame = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(error_frame, 'Camara no disponible', (120, 240),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.2, (100, 100, 255), 2)
        _, buffer = cv2.imencode('.jpg', error_frame)
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        return

    try:
        while camera_active:
            ret, frame = cap.read()
            if not ret:
                break

            # Preprocesar para inferencia
            img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img_resized = cv2.resize(img_rgb, (224, 224))
            img_array = np.array(img_resized, dtype=np.float32) / 255.0
            img_array = np.expand_dims(img_array, axis=0)

            # Inferencia
            resultado = sess.run(['confidence_score'], {'cam_input': img_array})
            conf = float(resultado[0][0][0])
            es_extintor = conf < UMBRAL
            confianza = (1 - conf) * 100 if es_extintor else conf * 100

            new_capture_made = False
            current_time = time.time()

            if es_extintor and confianza >= 98.0:
                if current_time - last_saved_time > 20.0:
                    # VALIDACIÓN EXTRA: Prevenir falsos positivos (como botellas de jugo rojas)
                    img_array_gen = tf.keras.preprocessing.image.img_to_array(img_resized)
                    img_array_gen = np.expand_dims(img_array_gen, axis=0)
                    img_array_gen = preprocess_input(img_array_gen)
                    preds = general_model.predict(img_array_gen, verbose=0)
                    decoded = decode_predictions(preds, top=3)[0]
                    
                    is_false_positive = False
                    decoded_top10 = decode_predictions(preds, top=10)[0]
                    for _, label, prob in decoded_top10:
                        lbl = label.lower()
                        if ('bottle' in lbl or 'can' in lbl or 'cup' in lbl or 'jug' in lbl or 'pitcher' in lbl or 'shaker' in lbl or 
                            'orange' in lbl or 'lemon' in lbl or 'fruit' in lbl or 'drink' in lbl or 'beverage' in lbl or 
                            'lotion' in lbl or 'glass' in lbl or 'jar' in lbl or 'perfume' in lbl or 'grocery' in lbl or 
                            'spray' in lbl or 'aerosol' in lbl or 'bucket' in lbl or 'barrel' in lbl or 'sunscreen' in lbl or 'beaker' in lbl):
                            if prob > 0.90:
                                is_false_positive = True
                                break
                    
                    if not is_false_positive:
                        confianza = 99.0
                    
                    if is_false_positive:
                        # El modelo general detectó fuertemente que es una botella/frasco, 
                        # anulamos el falso positivo del modelo ONNX.
                        es_extintor = False
                        confianza = 80.0 # Ajustamos la confianza a "No es extintor"
                        # No guardamos captura, actuará como un escaneo negativo en el próximo tick
                    else:
                        capture_frame = frame.copy()
                        
                        # Detección de color rojo para bounding box
                        hsv = cv2.cvtColor(capture_frame, cv2.COLOR_BGR2HSV)
                        mask1 = cv2.inRange(hsv, np.array([0, 70, 50]), np.array([10, 255, 255]))
                        mask2 = cv2.inRange(hsv, np.array([170, 70, 50]), np.array([180, 255, 255]))
                        mask = mask1 + mask2
                        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                        
                        has_box = False
                        if contours:
                            c = max(contours, key=cv2.contourArea)
                            if cv2.contourArea(c) > 500:
                                x, y, w, h = cv2.boundingRect(c)
                                cv2.rectangle(capture_frame, (x, y), (x+w, y+h), (0, 255, 0), 2)
                                cv2.putText(capture_frame, "Extintor", (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
                                has_box = True
                                
                        if not has_box:
                            fh, fw = capture_frame.shape[:2]
                            cv2.rectangle(capture_frame, (fw//4, fh//4), (fw*3//4, fh*3//4), (0, 255, 0), 2)
                            cv2.putText(capture_frame, "Extintor", (fw//4, fh//4-10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)

                        filename = f"captura_cam_{int(current_time)}.jpg"
                        filepath = os.path.join(FRONTEND_DIR, 'capturas', filename)
                        cv2.imwrite(filepath, capture_frame)
                        last_saved_time = current_time
                        new_capture_made = True
                        
                        _, buf = cv2.imencode('.jpg', capture_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                        b64 = base64.b64encode(buf).decode()
                        
                        entry = {
                            'archivo': f"[Cam] {filename}",
                            'hora': time.strftime('%H:%M:%S'),
                            'fecha': time.strftime('%Y-%m-%d'),
                            'resultado': {
                                'es_extintor': True,
                                'confianza': round(confianza, 2),
                                'etiqueta': 'Extintor Detectado',
                                'imagen_b64': b64
                            }
                        }
                        with history_lock:
                            detection_history.insert(0, entry)
                            if len(detection_history) > 50:
                                detection_history.pop()
                            global_total += 1
                            global_encontrados += 1
                        
            # Lógica de Escaneo Negativo cada 5s (incluso si fue falso positivo anulado)
            new_negative_scan_made = False
            if current_time - last_negative_scan_time >= 5.0:
                if not es_extintor:
                    capture_frame_neg = frame.copy()
                    fh, fw = capture_frame_neg.shape[:2]
                    cv2.putText(capture_frame_neg, "NO ES EXTINTOR", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2)
                    
                    filename_neg = f"captura_cam_neg_{int(current_time)}.jpg"
                    filepath_neg = os.path.join(FRONTEND_DIR, 'capturas', filename_neg)
                    cv2.imwrite(filepath_neg, capture_frame_neg)
                    
                    _, buf_neg = cv2.imencode('.jpg', capture_frame_neg, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    b64_neg = base64.b64encode(buf_neg).decode()

                    entry = {
                        'archivo': f"[Cam] {filename_neg}",
                        'hora': time.strftime('%H:%M:%S'),
                        'fecha': time.strftime('%Y-%m-%d'),
                        'resultado': {
                            'es_extintor': False,
                            'confianza': round(confianza, 2),
                            'etiqueta': 'No es Extintor',
                            'imagen_b64': b64_neg
                        }
                    }
                    with history_lock:
                        detection_history.insert(0, entry)
                        if len(detection_history) > 50:
                            detection_history.pop()
                        global_total += 1
                    new_negative_scan_made = True
                last_negative_scan_time = current_time

            with stats_lock:
                latest_camera_stats['es_extintor'] = es_extintor
                latest_camera_stats['confianza'] = round(confianza, 2)
                if new_capture_made:
                    latest_camera_stats['new_capture'] = True
                    latest_camera_stats['capture_b64'] = b64
                if new_negative_scan_made:
                    latest_camera_stats['new_negative_scan'] = True
                    latest_camera_stats['negative_b64'] = b64_neg

            # Dibujar overlay en el frame
            h, w = frame.shape[:2]

            if es_extintor:
                color = (0, 220, 100)
                label = f"EXTINTOR ({confianza:.1f}%)"
            else:
                color = (60, 60, 220)
                label = f"NO EXTINTOR ({confianza:.1f}%)"

            # Dibujar recuadro de escaneo tipo QR en el centro del frame
            cx, cy = w // 2, h // 2
            bw, bh = 150, 180 # Ancho y alto del recuadro
            thickness = 3
            length = 35
            
            # Top-left
            cv2.line(frame, (cx-bw, cy-bh), (cx-bw+length, cy-bh), color, thickness)
            cv2.line(frame, (cx-bw, cy-bh), (cx-bw, cy-bh+length), color, thickness)
            # Top-right
            cv2.line(frame, (cx+bw, cy-bh), (cx+bw-length, cy-bh), color, thickness)
            cv2.line(frame, (cx+bw, cy-bh), (cx+bw, cy-bh+length), color, thickness)
            # Bottom-left
            cv2.line(frame, (cx-bw, cy+bh), (cx-bw+length, cy+bh), color, thickness)
            cv2.line(frame, (cx-bw, cy+bh), (cx-bw, cy+bh-length), color, thickness)
            # Bottom-right
            cv2.line(frame, (cx+bw, cy+bh), (cx+bw-length, cy+bh), color, thickness)
            cv2.line(frame, (cx+bw, cy+bh), (cx+bw, cy+bh-length), color, thickness)

            # Fondo semitransparente para el texto
            (tw, th), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.85, 2)
            cv2.rectangle(frame, (8, h - 52), (24 + tw, h - 14), (0, 0, 0), -1)
            cv2.putText(frame, label, (16, h - 24),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.85, color, 2, cv2.LINE_AA)

            # Codificar como JPEG
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')

    finally:
        cap.release()
        print("[INFO] Camara liberada.")


@app.route('/api/camara/stream')
def api_camera_stream():
    """Endpoint MJPEG que transmite video con detección en tiempo real."""
    global camera_active
    with camera_lock:
        camera_active = True
    return Response(
        gen_camera_frames(),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )


@app.route('/api/camara/detener', methods=['POST'])
def api_camera_stop():
    """Detiene el streaming de la cámara."""
    global camera_active
    with camera_lock:
        camera_active = False
    return jsonify({'status': 'ok'})


@app.route('/api/camara/status')
def api_camera_status():
    """Devuelve las métricas en tiempo real de la cámara."""
    with stats_lock:
        res = latest_camera_stats.copy()
        latest_camera_stats['capture_b64'] = None
        latest_camera_stats['new_negative_scan'] = False
        latest_camera_stats['negative_b64'] = None
    return jsonify(res)


# ═══════════════════════════════════
#  API: Historial y Estadísticas
# ═══════════════════════════════════

@app.route('/api/historial')
def api_historial():
    """Devuelve las últimas 50 detecciones."""
    with history_lock:
        response = jsonify(detection_history[:50])
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response


@app.route('/api/historial/limpiar', methods=['POST'])
def api_limpiar_historial():
    global global_total, global_encontrados
    with history_lock:
        detection_history.clear()
        global_total = 0
        global_encontrados = 0
    return jsonify({'status': 'ok'})


@app.route('/api/estadisticas')
def api_estadisticas():
    """Devuelve estadísticas generales."""
    with history_lock:
        total = global_total
        encontrados = global_encontrados

    return jsonify({
        'total_detecciones': total,
        'exitosos': encontrados,
        'efectividad': round((encontrados / total * 100) if total > 0 else 0, 1)
    })


# ═══════════════════════════════════
#  MAIN
# ═══════════════════════════════════

if __name__ == '__main__':
    print()
    print("=" * 52)
    print("  ExtintorAI — Servidor de Deteccion Inteligente")
    print("=" * 52)
    print(f"  Modelo:    {ONNX_MODEL}")
    print(f"  Frontend:  {os.path.abspath(FRONTEND_DIR)}")
    print(f"  URL:       http://localhost:{PORT}")
    print("=" * 52)
    print()

    app.run(
        debug=False,
        host='0.0.0.0',
        port=PORT,
        threaded=True
    )
