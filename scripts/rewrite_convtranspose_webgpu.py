#!/usr/bin/env python3
"""Rewrite 3D ConvTranspose nodes as Conv + pixel-shuffle so the model runs on
onnxruntime-web's WebGPU EP (which supports 3D Conv but NOT 3D ConvTranspose).

Only valid for kernel_size == stride, no padding / output_padding, group 1 — the
non-overlapping upsampling nnU-Net's decoder uses. For such a transposed conv:

    y[co, s*z+a, s*y+b, s*x+c] = sum_ci x[ci,z,y,x] * W[ci,co,a,b,c] + bias[co]

which is exactly: a 1x1x1 Conv producing Cout*S channels (S = sD*sH*sW), then a
3D pixel-shuffle (reshape -> transpose -> reshape). This is an algebraic
identity, so output is bit-for-bit equivalent (modulo float ordering).

Usage:
    python scripts/rewrite_convtranspose_webgpu.py \
        --input public/models/dentalsegmentator.onnx \
        --output public/models/dentalsegmentator-webgpu.onnx --validate
"""
import argparse

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def shapes_of(model):
    inferred = onnx.shape_inference.infer_shapes(model)
    out = {}
    for vi in list(inferred.graph.value_info) + list(inferred.graph.input) + list(
        inferred.graph.output
    ):
        dims = [d.dim_value if d.HasField("dim_value") else 0 for d in vi.type.tensor_type.shape.dim]
        out[vi.name] = dims
    return out


def rewrite(model):
    g = model.graph
    inits = {i.name: i for i in g.initializer}
    vshapes = shapes_of(model)
    new_nodes = []
    n_rewritten = 0

    for node in g.node:
        if node.op_type != "ConvTranspose":
            new_nodes.append(node)
            continue
        strides = next((list(a.ints) for a in node.attribute if a.name == "strides"), None)
        W = numpy_helper.to_array(inits[node.input[1]])  # [Cin, Cout, kD, kH, kW]
        Cin, Cout, kD, kH, kW = W.shape
        sD, sH, sW = strides
        assert (kD, kH, kW) == (sD, sH, sW), f"{node.name}: kernel!=stride"
        S = sD * sH * sW

        xname = node.input[0]
        dims = vshapes.get(xname, [0, 0, 0, 0, 0])
        D, H, Wd = dims[2], dims[3], dims[4]
        assert D and H and Wd, f"{node.name}: need static spatial dims, got {dims}"

        base = node.name or f"ct_{n_rewritten}"
        # 1x1x1 Conv weight: [Cout*S, Cin, 1,1,1]
        Wp = np.ascontiguousarray(
            W.transpose(1, 2, 3, 4, 0).reshape(Cout * S, Cin, 1, 1, 1)
        ).astype(W.dtype)
        wp_name = base + "_pw_w"
        g.initializer.append(numpy_helper.from_array(Wp, wp_name))
        conv_inputs = [xname, wp_name]
        if len(node.input) > 2:  # bias -> repeat per sub-pixel
            b = numpy_helper.to_array(inits[node.input[2]])
            bp = np.repeat(b, S).astype(b.dtype)
            bp_name = base + "_pw_b"
            g.initializer.append(numpy_helper.from_array(bp, bp_name))
            conv_inputs.append(bp_name)

        pw_out = base + "_pw_out"
        new_nodes.append(
            helper.make_node(
                "Conv", conv_inputs, [pw_out], name=base + "_pw",
                kernel_shape=[1, 1, 1], strides=[1, 1, 1],
                pads=[0, 0, 0, 0, 0, 0], dilations=[1, 1, 1], group=1,
            )
        )
        # pixel-shuffle: reshape -> transpose -> reshape
        sh1 = base + "_sh1"
        g.initializer.append(
            numpy_helper.from_array(
                np.array([-1, Cout, sD, sH, sW, D, H, Wd], dtype=np.int64), sh1
            )
        )
        r1 = base + "_r1"
        new_nodes.append(helper.make_node("Reshape", [pw_out, sh1], [r1], name=base + "_reshape1"))
        t1 = base + "_t1"
        new_nodes.append(
            helper.make_node(
                "Transpose", [r1], [t1], name=base + "_transpose",
                perm=[0, 1, 5, 2, 6, 3, 7, 4],
            )
        )
        sh2 = base + "_sh2"
        g.initializer.append(
            numpy_helper.from_array(
                np.array([-1, Cout, D * sD, H * sH, Wd * sW], dtype=np.int64), sh2
            )
        )
        new_nodes.append(
            helper.make_node("Reshape", [t1, sh2], [node.output[0]], name=base + "_reshape2")
        )
        n_rewritten += 1

    del g.node[:]
    g.node.extend(new_nodes)
    print(f"rewrote {n_rewritten} ConvTranspose nodes")
    return model


def validate(orig_path, new_path):
    import onnxruntime as ort
    # Infer the model's input spatial dims (patch size) instead of hardcoding;
    # batch (and any dynamic dim) falls back to 1.
    m = onnx.load(orig_path, load_external_data=False)
    dims = [d.dim_value if d.HasField("dim_value") and d.dim_value > 0 else 1
            for d in m.graph.input[0].type.tensor_type.shape.dim]
    rng = np.random.default_rng(0)
    x = rng.standard_normal(tuple(dims)).astype(np.float32)
    so = ort.SessionOptions()
    a = ort.InferenceSession(orig_path, so, providers=["CPUExecutionProvider"]).run(None, {"input": x})[0]
    b = ort.InferenceSession(new_path, so, providers=["CPUExecutionProvider"]).run(None, {"input": x})[0]
    print(f"orig {a.shape} vs rewritten {b.shape}")
    print(f"max abs diff: {np.abs(a - b).max():.3e}, argmax agreement: "
          f"{(a.argmax(1) == b.argmax(1)).mean()*100:.4f}%")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="public/models/dentalsegmentator.onnx")
    ap.add_argument("--output", default="public/models/dentalsegmentator-webgpu.onnx")
    ap.add_argument("--validate", action="store_true")
    args = ap.parse_args()
    model = onnx.load(args.input)
    model = rewrite(model)
    onnx.checker.check_model(model) if model.ByteSize() < 2**31 else print("skip checker (>2GB)")
    onnx.save_model(model, args.output)
    print(f"saved {args.output}")
    if args.validate:
        validate(args.input, args.output)


if __name__ == "__main__":
    main()
