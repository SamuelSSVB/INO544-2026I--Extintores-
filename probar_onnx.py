import onnxruntime as ort
import numpy as np
from PIL import Image
import sys

def predecir(ruta):
    sess = ort.InferenceSession('extintor_classifier.onnx')
    img = Image.open(ruta).convert('RGB').resize((224, 224))
    img_array = np.array(img, dtype=np.float32) / 255.0
    img_array = np.expand_dims(img_array, axis=0)
    resultado = sess.run(['confidence_score'], {'cam_input': img_array})
    conf = resultado[0][0][0]
    
    if conf < 0.5:
        print(f"[Extintor] Es un Extintor (confianza en NO Extintor: {conf:.4f})")
    else:
        print(f"[NO Extintor] NO es un Extintor (confianza en NO Extintor: {conf:.4f})")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        predecir(sys.argv[1])
    else:
        print("Uso: python probar_onnx.py <ruta_imagen>")