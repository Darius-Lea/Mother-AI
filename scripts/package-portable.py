"""Package source + built web app for copying to a USB drive. No credentials or runtime."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
destination = root / 'releases' / f'Mother-AI-{version}.zip'
destination.parent.mkdir(exist_ok=True)
include_dirs = ['src', 'server', 'public', 'scripts', 'docs', 'tests', 'dist']
include_files = ['README.md', 'package.json', 'package-lock.json', 'index.html', 'vite.config.js', 'playwright.config.js', '.gitignore']
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for name in include_files:
        source = root / name
        if source.is_file(): archive.write(source, f'Mother-AI/{name}')
    for name in include_dirs:
        for source in sorted((root / name).rglob('*')):
            if source.is_file() and not source.is_symlink() and '__pycache__' not in source.parts:
                archive.write(source, f'Mother-AI/{source.relative_to(root)}')
print(f'Created {destination} ({destination.stat().st_size:,} bytes). Requires Node 24.5+; models are separate.')
