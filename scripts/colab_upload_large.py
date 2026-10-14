#!/usr/bin/env python3
"""Upload a large private file through Colab CLI in verified 32 MiB pieces.

Avoids Jupyter's request-size limit. Requires an authenticated, running session.
Remote temporary pieces are deleted only after a verified reassembly.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
import uuid
from pathlib import Path


def command(args):
    result = subprocess.run(['colab', *args], capture_output=True, text=True)
    if result.returncode:
        # CLI errors can contain a runtime proxy token in their URL.
        raise RuntimeError(f'Colab {args[0]} failed (exit {result.returncode}); check session status.')
    return result.stdout


def upload(source, remote, session):
    source = Path(source)
    prefix = '/content/cbcter-upload-' + uuid.uuid4().hex
    digest = hashlib.sha256()
    parts = []
    with tempfile.TemporaryDirectory(prefix='cbcter-upload-') as temporary:
        with source.open('rb') as file:
            while block := file.read(32 * 1024 * 1024):
                digest.update(block)
                part = Path(temporary) / f'part-{len(parts)}'
                part.write_bytes(block)
                target = f'{prefix}-{len(parts)}'
                command(['upload', '-s', session, str(part), target])
                parts.append(target)
                print(f'Uploaded {len(parts)} piece(s)', flush=True)
        if not parts:
            raise ValueError('Cannot upload an empty scan')
        script = Path(temporary) / 'assemble.py'
        script.write_text(f'''from pathlib import Path
import hashlib
parts = {parts!r}
output = Path({remote!r})
output.parent.mkdir(parents=True, exist_ok=True)
digest = hashlib.sha256()
with output.open('wb') as target:
    for name in parts:
        with Path(name).open('rb') as source:
            for block in iter(lambda: source.read(8*1024*1024), b''):
                digest.update(block)
                target.write(block)
if digest.hexdigest() != {digest.hexdigest()!r}:
    raise ValueError('Upload checksum mismatch')
for name in parts:
    Path(name).unlink()
print('Verified upload SHA256: ' + digest.hexdigest())
''')
        result = command(['exec', '-s', session, '-f', str(script), '--timeout', '60'])
        # Some CLI versions return zero on a remote Python exception.
        if 'Verified upload SHA256: ' + digest.hexdigest() not in result:
            raise RuntimeError('Remote reassembly was not confirmed')
        print(json.dumps({'remote': remote, 'sha256': digest.hexdigest()}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('remote')
    parser.add_argument('--session', required=True)
    upload(**vars(parser.parse_args()))
