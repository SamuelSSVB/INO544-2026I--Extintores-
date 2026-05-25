import cv2
import numpy as np
import onnxruntime as ort

# Cargar modelo ONNX
sess = ort.InferenceSession('extintor_classifier.onnx')

# Umbral de decisión (puedes ajustarlo)
UMBRAL = 0.5

# Iniciar cámara (0 = cámara por defecto)
cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("Error: No se pudo acceder a la cámara.")
    exit()

print("Presiona 'q' para salir. Reconociendo extintores en tiempo real...")

while True:
    # Leer frame
    ret, frame = cap.read()
    if not ret:
        break

    # Preprocesar: redimensionar a 224x224, convertir a RGB, normalizar
    img = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    img_resized = cv2.resize(img, (224, 224))
    img_array = np.array(img_resized, dtype=np.float32) / 255.0
    img_array = np.expand_dims(img_array, axis=0)   # [1,224,224,3]

    # Inferencia
    resultado = sess.run(['confidence_score'], {'cam_input': img_array})
    confianza = resultado[0][0][0]   # probabilidad de NO EXTINTOR

    # Interpretar
    if confianza < UMBRAL:
        etiqueta = "EXTINTOR"
        color = (0, 255, 0)   # verde
    else:
        etiqueta = "NO EXTINTOR"
        color = (0, 0, 255)   # rojo

    # Mostrar resultado en el frame
    texto = f"{etiqueta} (conf: {1-confianza if confianza<UMBRAL else confianza:.2f})"
    cv2.putText(frame, texto, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)

    # Mostrar frame
    cv2.imshow('Reconocimiento de Extintores - ONNX', frame)

    # Salir con 'q'
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

# Liberar recursos
cap.release()
cv2.destroyAllWindows()