#!/usr/bin/env python3
"""Set up the published OralSeg runtime without compiling against Colab's toolkit.

Run this on the Colab VM, through `colab exec` or a notebook cell. The upstream
CUDA 12.2 wheels match Python 3.10 / Torch 2.2 / the non-CXX11 PyTorch ABI.
"""
import subprocess
import sys
import hashlib
import urllib.request
from pathlib import Path

PYTHON = "/content/cbct-gpu-env/bin/python"


def setup():
    subprocess.run(["nvidia-smi"], check=True)
    subprocess.run([sys.executable, "-m", "pip", "install", "uv"], check=True)
    subprocess.run(["uv", "python", "install", "3.10"], check=True)
    subprocess.run(["uv", "venv", "--python", "3.10", "/content/cbct-gpu-env"], check=True)

    def install(*args):
        subprocess.run(["uv", "pip", "install", "--python", PYTHON, *args], check=True)

    install("torch==2.2.0", "--index-url", "https://download.pytorch.org/whl/cu121")
    install("numpy==1.26.4", "monai==1.4.0", "nibabel", "SimpleITK", "zstandard",
            "jcs==0.2.1", "einops==0.8.1", "packaging", "transformers==4.52.4",
            "scipy==1.15.3", "setuptools==75.8.0", "wheel")
    install("https://github.com/Dao-AILab/causal-conv1d/releases/download/v1.4.0/"
            "causal_conv1d-1.4.0%2Bcu122torch2.2cxx11abiFALSE-cp310-cp310-linux_x86_64.whl")
    install("https://github.com/state-spaces/mamba/releases/download/v2.2.0/"
            "mamba_ssm-2.2.0%2Bcu122torch2.2cxx11abiFALSE-cp310-cp310-linux_x86_64.whl")
    subprocess.run([PYTHON, "-c", "import torch, mamba_ssm, causal_conv1d; "
                    "assert torch.cuda.is_available(); "
                    "assert not torch._C._GLIBCXX_USE_CXX11_ABI; "
                    "print(torch.__version__, torch.cuda.get_device_name())"], check=True)
    source = Path('/content/OralSeg')
    if not source.exists():
        subprocess.run(['git', 'clone', 'https://github.com/OttoYouZhou/oralseg', str(source)], check=True)
    subprocess.run(['git', '-C', str(source), 'checkout', 'dd0eb05a97ed88e48da6f824fea2989bd4041c1c'], check=True)
    checkpoint = Path('/content/model_workstation39.pt')
    if not checkpoint.exists():
        urllib.request.urlretrieve('https://huggingface.co/aiadir/OralSeg/resolve/'
                                   'f5c60bf1aa05dfc791fdb07439f9141d7af10265/model_workstation39.pt', checkpoint)
    digest = hashlib.sha256()
    with checkpoint.open('rb') as file:
        for block in iter(lambda: file.read(8*1024*1024), b''):
            digest.update(block)
    if digest.hexdigest() != '1b4b5806a0d2019d1b58b274cbb64c9b9f7f6510ddeff0413974acca58863ed2':
        raise ValueError('OralSeg checkpoint fingerprint mismatch')


if __name__ == "__main__":
    setup()
