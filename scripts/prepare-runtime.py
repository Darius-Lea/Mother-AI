#!/usr/bin/env python3
"""Prepare a verified CPU Ollama bundle at build time, never on the user's desktop.

The installer includes this output as resources/runtime. No shell installers,
package managers, model weights or GPU driver downloads are invoked here.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

VERSION = "0.40.11"
BASE = f"https://github.com/ollama/ollama/releases/download/v{VERSION}/"
LICENSE_URL = f"https://raw.githubusercontent.com/ollama/ollama/v{VERSION}/LICENSE"
LICENSE_SHA256 = "5934ed2ce0d15154bcdb9c85203210abac0da4314af34081e36df4599f90b226"
# Pinned against the separately published official sha256sum.txt. A changed
# archive or checksum document fails the build rather than silently updating it.
ASSETS = {
    ("linux", "x64"): ("ollama-linux-amd64.tar.zst", "7bedab90dd122661be78798e9f0edf37fccf0cccf2699d2c58ea1a3afdc04b6d"),
    ("win32", "x64"): ("ollama-windows-amd64.zip", "bda4a493ba8a7c24d57263cd843cd68cee84f44aed4299eeed532acad7eda12a"),
    ("win32", "arm64"): ("ollama-windows-arm64.zip", "a43eeaea23bef3157b0f7d42216fe8a8fecdd7a9f06722f7f8e623470308bd9a"),
    ("darwin", "x64"): ("ollama-darwin.tgz", "aea7d3f2e32371b7644a6e2ec8d4f26820a0e3965918cce8a46cef3e947f6291"),
    ("darwin", "arm64"): ("ollama-darwin.tgz", "aea7d3f2e32371b7644a6e2ec8d4f26820a0e3965918cce8a46cef3e947f6291"),
}
ROOT = Path(__file__).resolve().parent.parent
MAX_FILE_BYTES = 300 * 1024 * 1024
MAX_BUNDLE_BYTES = 700 * 1024 * 1024


def sha256(file):
    result = hashlib.sha256()
    with open(file, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def safe_name(name):
    while name.startswith("./"):
        name = name[2:]
    value = PurePosixPath(name)
    if not name or "\\" in name or "\x00" in name or value.is_absolute() or any(part in ("..", ":") or ":" in part for part in value.parts):
        raise ValueError("An upstream archive contains an unsafe filename.")
    return str(value)


def selected_name(raw_name, platform, arch="x64"):
    name = safe_name(raw_name)
    parts = PurePosixPath(name).parts
    if platform == "darwin":
        # The CLI and helpers are universal Mach-O; CPU dynamic libraries are
        # Intel-only. Apple Silicon requires its bundled native MLX backend.
        # Keep both official Metal generations, selected by upstream at runtime.
        keep = len(parts) == 1 or (arch == "arm64" and parts[0] in ("mlx_metal_v3", "mlx_metal_v4"))
        return f"bin/{name}" if keep and not parts[-1].startswith("._") else None
    if name == ("ollama.exe" if platform == "win32" else "bin/ollama"):
        return "bin/ollama.exe" if platform == "win32" else "bin/ollama"
    if len(parts) == 3 and parts[:2] == ("lib", "ollama"):
        return name
    # Preserve the official redistributable CPU dependencies on Windows too;
    # users must not need to install a compiler or a separate VC runtime.
    if platform == "win32" and len(parts) == 4 and parts[:3] == ("lib", "ollama", "cuda_v13"):
        if parts[3].startswith(("vcruntime", "msvcp", "concrt", "vccorlib")) and parts[3].endswith(".dll"):
            return f"lib/ollama/{parts[3]}"
    return None


def download(url, target, expected_sha=None, max_bytes=3 * 1024 ** 3):
    if not url.startswith("https://"):
        raise ValueError("Runtime assets must use HTTPS.")
    request = urllib.request.Request(url, headers={"User-Agent": "Mother-AI-runtime-builder/1"})
    total = 0
    digest = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=90) as response, open(target, "wb") as output:
        if response.status != 200 or not response.url.startswith("https://"):
            raise ValueError("The official runtime asset could not be retrieved securely.")
        for chunk in iter(lambda: response.read(1024 * 1024), b""):
            total += len(chunk)
            if total > max_bytes:
                raise ValueError("The official runtime asset exceeds the build download limit.")
            digest.update(chunk)
            output.write(chunk)
    if expected_sha and digest.hexdigest() != expected_sha:
        raise ValueError("The official runtime archive failed its pinned SHA-256 check.")


def verify_cache(directory, platform, arch, asset_sha):
    try:
        manifest_path = directory / "manifest.json"
        if manifest_path.is_symlink() or manifest_path.stat().st_size > 256 * 1024:
            return False
        manifest = json.loads(manifest_path.read_text(encoding="utf8"))
        expected = {record["path"] for record in manifest["files"]}
        actual = {file.relative_to(directory).as_posix() for file in directory.rglob("*") if file.is_file() and file != manifest_path}
        if manifest["schema"] != 1 or manifest["version"] != VERSION or manifest["platform"] != platform or manifest["arch"] != arch or manifest["upstreamSha256"] != asset_sha or expected != actual:
            return False
        for record in manifest["files"]:
            name = safe_name(record["path"])
            file = directory / name
            if file.is_symlink() or file.stat().st_size != record["size"] or sha256(file) != record["sha256"]:
                return False
        return not any(file.is_symlink() for file in directory.rglob("*"))
    except (OSError, KeyError, TypeError, ValueError):
        return False


class Extractor:
    def __init__(self, directory, platform, arch="x64"):
        self.directory = directory
        self.platform = platform
        self.arch = arch
        self.names = set()
        self.source_names = {}
        self.links = []
        self.bytes = 0

    def add(self, raw_name, size, source=None, mode=0o644, linkname=None, hardlink=False):
        name = selected_name(raw_name, self.platform, self.arch)
        if name is None:
            return
        if name in self.names:
            raise ValueError("Duplicate retained runtime filename.")
        if size < 0 or size > MAX_FILE_BYTES or self.bytes + size > MAX_BUNDLE_BYTES:
            raise ValueError("The extracted runtime exceeds its expected size limit.")
        self.names.add(name)
        self.source_names[safe_name(raw_name)] = name
        destination = self.directory / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if linkname is not None:
            if linkname.startswith("/") or "\\" in linkname or "\x00" in linkname:
                raise ValueError("The upstream runtime contains an unsafe link.")
            relative = linkname if hardlink else posixpath.join(posixpath.dirname(safe_name(raw_name)), linkname)
            resolved = safe_name(posixpath.normpath(relative))
            self.links.append((name, resolved))
            return
        if source is None:
            raise ValueError("An upstream runtime member is not a regular file.")
        with open(destination, "xb") as output:
            copied = 0
            while chunk := source.read(1024 * 1024):
                copied += len(chunk)
                if copied > size:
                    raise ValueError("An upstream runtime member exceeds its recorded size.")
                output.write(chunk)
        if copied != size:
            raise ValueError("An upstream runtime member was truncated.")
        self.bytes += size
        # Read/execute permissions only; no archive owner, setuid or write flags.
        destination.chmod(0o755 if mode & 0o111 or destination.name in ("ollama", "ollama.exe", "llama-server", "llama-quantize") else 0o644)

    def materialize_links(self):
        pending = self.links
        for _ in range(len(pending) + 1):
            remaining = []
            for destination, raw_target in pending:
                target_name = self.source_names.get(raw_target)
                target = self.directory / target_name if target_name else None
                if target and target.is_file() and not target.is_symlink():
                    size = target.stat().st_size
                    if self.bytes + size > MAX_BUNDLE_BYTES:
                        raise ValueError("Runtime links exceed the bundle size limit.")
                    shutil.copyfile(target, self.directory / destination)
                    shutil.copymode(target, self.directory / destination)
                    self.bytes += size
                else:
                    remaining.append((destination, raw_target))
            if not remaining:
                return
            if len(remaining) == len(pending):
                raise ValueError("An upstream runtime link does not resolve to a retained regular file.")
            pending = remaining
        raise ValueError("The upstream runtime contains an unresolved link cycle.")


def extract_tar(fileobj, extractor):
    with tarfile.open(fileobj=fileobj, mode="r|*") as archive:
        for member in archive:
            safe_name(member.name)
            if member.isdir():
                continue
            if selected_name(member.name, extractor.platform, extractor.arch) is None:
                continue
            if member.issym() or member.islnk():
                extractor.add(member.name, 0, linkname=member.linkname, hardlink=member.islnk())
            elif member.isfile():
                with archive.extractfile(member) as source:
                    extractor.add(member.name, member.size, source=source, mode=member.mode)
            else:
                raise ValueError("An upstream runtime member is not a regular file or confined link.")


def extract_archive(archive_path, directory, platform, arch="x64"):
    extractor = Extractor(directory, platform, arch)
    if archive_path.name.endswith(".zip"):
        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.infolist():
                safe_name(member.filename)
                if member.is_dir() or selected_name(member.filename, platform, arch) is None:
                    continue
                mode = member.external_attr >> 16
                if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                    raise ValueError("An upstream ZIP runtime member is not a regular file.")
                with archive.open(member) as source:
                    extractor.add(member.filename, member.file_size, source=source, mode=mode)
    elif archive_path.name.endswith(".tar.zst"):
        # Python3.12 has no stdlib zstd codec. Native Ubuntu CI provides zstd;
        # use a fixed executable and arguments, never a shell command string.
        zstd = shutil.which("zstd")
        if not zstd:
            raise ValueError("Build prerequisite missing: zstd is required on the Linux build runner.")
        with tempfile.TemporaryFile() as errors:
            process = subprocess.Popen([zstd, "-d", "-c", "--", str(archive_path)], stdout=subprocess.PIPE, stderr=errors)
            try:
                extract_tar(process.stdout, extractor)
                process.stdout.close()
                if process.wait() != 0:
                    raise ValueError("The verified upstream runtime archive could not be decompressed.")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
    else:
        with open(archive_path, "rb") as source:
            extract_tar(source, extractor)
    extractor.materialize_links()


def prepare(platform, arch, output):
    asset, expected_sha = ASSETS[(platform, arch)]
    if output.is_dir() and not output.is_symlink() and verify_cache(output, platform, arch, expected_sha):
        print(f"Verified cached Ollama {VERSION} CPU bundle ({platform}/{arch}).")
        return
    if asset.endswith(".tar.zst") and not shutil.which("zstd"):
        raise ValueError("Build prerequisite missing: zstd is required on the Linux build runner.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mother-runtime-", dir=output.parent) as temp:
        temporary = Path(temp)
        checksums = temporary / "sha256sum.txt"
        download(BASE + "sha256sum.txt", checksums, max_bytes=128 * 1024)
        records = {}
        for line in checksums.read_text(encoding="utf8").splitlines():
            fields = line.split()
            if len(fields) == 2:
                records[fields[1].removeprefix("./")] = fields[0]
        if records.get(asset) != expected_sha:
            raise ValueError("The published checksum document differs from the pinned runtime release.")
        archive = temporary / asset
        print(f"Downloading official Ollama {VERSION} build asset for {platform}/{arch}; installer users do not perform this step.", flush=True)
        download(BASE + asset, archive, expected_sha)
        bundle = temporary / "bundle"
        bundle.mkdir()
        extract_archive(archive, bundle, platform, arch)
        # The binary archives carry dependency notices but omit Ollama's own
        # top-level MIT license. Include its independently pinned source text.
        (bundle / "licenses").mkdir()
        download(LICENSE_URL, bundle / "licenses" / "OLLAMA_LICENSE", LICENSE_SHA256, max_bytes=32 * 1024)
        executable = "bin/ollama.exe" if platform == "win32" else "bin/ollama"
        library_directory = "bin" if platform == "darwin" else "lib/ollama"
        if not (bundle / executable).is_file() or not any((bundle / library_directory).glob("*LICENSE*")):
            raise ValueError("The upstream runtime is missing its executable or license notices.")
        files = [{"path": file.relative_to(bundle).as_posix(), "size": file.stat().st_size, "sha256": sha256(file)}
                 for file in sorted(bundle.rglob("*")) if file.is_file()]
        manifest = {"schema": 1, "name": "Ollama CPU runtime", "version": VERSION, "platform": platform, "arch": arch,
                    "executable": executable, "libraryDirectory": library_directory,
                    "upstreamUrl": BASE + asset, "upstreamSha256": expected_sha, "files": files}
        (bundle / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
        if not verify_cache(bundle, platform, arch, expected_sha):
            raise ValueError("Prepared runtime failed its final integrity check.")
        if output.exists() or output.is_symlink():
            if output.is_symlink() or not output.is_dir():
                raise ValueError("Refusing to replace a runtime output that is not a regular directory.")
            shutil.rmtree(output)
        bundle.rename(output)
        print(f"Prepared verified Ollama {VERSION} CPU bundle: {len(files)} files, {sum(file['size'] for file in files) // (1024 * 1024)} MiB.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", required=True, choices=("win32", "darwin", "linux"))
    parser.add_argument("--arch", required=True, choices=("x64", "arm64"))
    parser.add_argument("--output", type=Path, default=ROOT / ".runtime" / "ollama")
    args = parser.parse_args()
    if (args.platform, args.arch) not in ASSETS:
        parser.error("This release does not bundle an engine for that platform/architecture.")
    try:
        prepare(args.platform, args.arch, args.output.absolute())
    except (OSError, ValueError, tarfile.TarError, zipfile.BadZipFile) as failure:
        print(f"Runtime preparation failed: {failure}", file=sys.stderr)
        sys.exit(1)
