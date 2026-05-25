import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
import os

# Configuración
IMG_HEIGHT, IMG_WIDTH = 224, 224
BATCH_SIZE = 32
EPOCHS = 20
SEED = 42

# Verificar que existan las carpetas
if not os.path.exists('dataset/extintores') or not os.path.exists('dataset/no_extintores'):
    raise Exception("ERROR: No se encuentran las carpetas 'dataset/extintores' o 'dataset/no_extintores'")

# Cargar datos (80% entrenamiento, 20% validación)
train_ds, val_ds = tf.keras.utils.image_dataset_from_directory(
    'dataset',
    validation_split=0.2,
    subset='both',
    seed=SEED,
    image_size=(IMG_HEIGHT, IMG_WIDTH),
    batch_size=BATCH_SIZE,
    label_mode='binary'
)

# Normalizar
normalization_layer = layers.Rescaling(1./255)
train_ds = train_ds.map(lambda x, y: (normalization_layer(x), y))
val_ds = val_ds.map(lambda x, y: (normalization_layer(x), y))

# Optimizar
AUTOTUNE = tf.data.AUTOTUNE
train_ds = train_ds.cache().shuffle(1000).prefetch(AUTOTUNE)
val_ds = val_ds.cache().prefetch(AUTOTUNE)

# Capas de aumento de datos
data_augmentation = keras.Sequential([
    layers.RandomFlip("horizontal"),
    layers.RandomRotation(0.15),
    layers.RandomZoom(0.15),
], name="data_augmentation")

# Construir CNN usando MobileNetV2 preentrenado
def create_model():
    inputs = keras.Input(shape=(IMG_HEIGHT, IMG_WIDTH, 3), name='cam_input')
    
    # Aplicar Data Augmentation (solo se ejecuta durante el entrenamiento)
    x = data_augmentation(inputs)
    
    # Rescalar de [0, 1] a [-1, 1] (rango esperado por MobileNetV2)
    # Ya que los datos de entrada ya están normalizados a [0, 1], aplicamos la transformación lineal
    x = layers.Rescaling(scale=2.0, offset=-1.0)(x)
    
    # Modelo base MobileNetV2
    base_model = tf.keras.applications.MobileNetV2(
        input_tensor=x,
        weights='imagenet',
        include_top=False,
        pooling='avg'
    )
    
    # Congelar el extractor de características inicialmente
    base_model.trainable = False
    
    # Clasificador personalizado encima
    x = base_model.output
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(128, activation='relu')(x)
    x = layers.Dropout(0.3)(x)
    outputs = layers.Dense(1, activation='sigmoid', name='confidence_score')(x)
    
    return keras.Model(inputs, outputs), base_model

model, base_model = create_model()
model.summary()

# --- ENTRENAMIENTO ---

# Fase 1: Feature Extraction (entrenar solo las capas densas añadidas)
print("\n=== Fase 1: Entrenando el clasificador con MobileNetV2 congelado ===")
model.compile(
    optimizer=keras.optimizers.Adam(learning_rate=1e-3),
    loss='binary_crossentropy',
    metrics=['accuracy']
)

# Entrenar por 10 épocas para estabilizar el clasificador
model.fit(train_ds, validation_data=val_ds, epochs=10, verbose=1)

# Fase 2: Fine-Tuning (descongelar capas superiores de MobileNetV2)
print("\n=== Fase 2: Fine-Tuning (descongelando capas de MobileNetV2) ===")
base_model.trainable = True

# Congelar todas las capas inferiores, dejar solo las capas a partir de la 100
for layer in base_model.layers[:100]:
    layer.trainable = False

# Volver a compilar con un learning rate muy pequeño
model.compile(
    optimizer=keras.optimizers.Adam(learning_rate=1e-5),
    loss='binary_crossentropy',
    metrics=['accuracy']
)

# Continuar entrenando por otras 10 épocas (20 épocas en total)
history = model.fit(train_ds, validation_data=val_ds, epochs=10, verbose=1)

# Evaluar
loss, acc = model.evaluate(val_ds)
print(f"\nPrecisión final en validación: {acc:.4f}")

# Guardar en formato .keras (Keras 3)
model.save('extintor_classifier.keras')
print("Modelo guardado como 'extintor_classifier.keras'")