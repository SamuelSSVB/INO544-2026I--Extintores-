import tf2onnx
import tensorflow as tf
import onnx

model = tf.keras.models.load_model('extintor_classifier.keras')
input_signature = [tf.TensorSpec([1, 224, 224, 3], tf.float32, name='cam_input')]
output_path = 'extintor_classifier.onnx'
model_proto, _ = tf2onnx.convert.from_keras(
    model,
    input_signature=input_signature,
    opset=13,
    output_path=output_path
)
onnx_model = onnx.load(output_path)
onnx.checker.check_model(onnx_model)
print("[OK] ONNX guardado correctamente.")
print(f"Input : {onnx_model.graph.input[0].name}  shape: {[d.dim_value for d in onnx_model.graph.input[0].type.tensor_type.shape.dim]}")
print(f"Output: {onnx_model.graph.output[0].name} shape: {[d.dim_value for d in onnx_model.graph.output[0].type.tensor_type.shape.dim]}")