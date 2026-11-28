#!/usr/bin/env python3
"""Apply the KCN adaptation set to build output before packaging."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ADAPTERS = Path(__file__).resolve().parent
MANIFEST = ADAPTERS / "manifest.json"
RECEIPT = "kcn-patches.json"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def inside(root, relative):
    path = root / relative
    if Path(relative).is_absolute() or '..' in Path(relative).parts or path.is_symlink():
        raise ValueError(f'unsafe patch path: {relative}')
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f'patch path escapes root: {relative}')
    return path


def load_manifest(path):
    manifest = json.loads(path.read_text())
    if manifest.get('schema') != 1 or not manifest.get('patches'):
        raise ValueError('unsupported or empty patch manifest')
    ids = [p['id'] for p in manifest['patches']]
    if len(ids) != len(set(ids)):
        raise ValueError('duplicate patch id')
    return manifest


def resolve_targets(dist, manifest):
    # Resolve every selector before any adapter runs. Never guess the first match.
    sources = {p: p.read_text() for p in dist.glob('*.js') if not p.is_symlink()}
    resolved = []
    for patch in manifest['patches']:
        targets = []
        for spec in patch['targets']:
            if 'path' in spec:
                path = inside(dist, spec['path'])
                if not path.is_file():
                    raise ValueError(f"{patch['id']}: missing {spec['path']}")
            else:
                matches = [p for p, text in sources.items() if spec['selector'] in text]
                if len(matches) != 1:
                    raise ValueError(f"{patch['id']}: selector matched {len(matches)} bundles: {spec['selector']}")
                path = matches[0]
            targets.append((path.relative_to(dist).as_posix(), spec))
        resolved.append((patch, targets))
    return resolved


def verify(stage_dist, resolved):
    files = set()
    for patch, targets in resolved:
        for relative, spec in targets:
            path = inside(stage_dist, relative)
            text = path.read_text()
            if any(marker not in text for marker in spec.get('required', [])):
                raise ValueError(f"{patch['id']}: incomplete postconditions in {relative}")
            if spec.get('any_of') and not any(marker in text for marker in spec['any_of']):
                raise ValueError(f"{patch['id']}: no supported implementation in {relative}")
            files.add(path)
    for path in sorted(files):
        if path.suffix == '.js':
            subprocess.run(['node', '--input-type=module', '--check'], input=path.read_bytes(),
                           check=True, capture_output=True)
        elif path.suffix == '.json':
            json.loads(path.read_text())


def prepare(install, stage, manifest):
    dist = install / 'dist'
    resolved = resolve_targets(dist, manifest)
    originals = {}
    for _, targets in resolved:
        for relative, _ in targets:
            if relative in originals:
                continue
            source = inside(dist, relative)
            originals[relative] = source.read_bytes()
            dest = inside(stage / 'dist', relative)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, dest)
    (stage / 'package.json').write_text(json.dumps({'type': 'module'}))
    backup = stage / 'backups'
    backup.mkdir()
    env = {
        **os.environ,
        'PYTHONDONTWRITEBYTECODE': '1',
        'CLAWOCK_PATCH_STAGE': str(stage),
        'CLAWOCK_PATCH_BACKUP_DIR': str(backup),
    }
    for patch, _ in resolved:
        script = inside(ADAPTERS, patch['script'])
        command = ['bash', str(script)] if script.suffix == '.sh' else [
            sys.executable, str(script), '--dist', str(stage / 'dist')]
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise ValueError(f"{patch['id']}: staging failed: {result.stderr.strip() or result.stdout.strip()}")
    verify(stage / 'dist', resolved)
    return {name: inside(stage / 'dist', name).read_bytes() for name in originals}


def expected_identity(install, manifest):
    version = json.loads((install / "package.json").read_text()).get("version")
    commit = json.loads((install / "dist/build-info.json").read_text()).get("commit")
    if version not in manifest["validated_versions"]:
        raise ValueError(f"{version}: no reviewed patch set for this package version")
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("dist/build-info.json has no full build commit")
    return {"schema": 1, "version": version, "commit": commit,
            "patches": [patch["id"] for patch in manifest["patches"]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("build", "check"))
    parser.add_argument("package", type=Path)
    args = parser.parse_args()
    install = args.package.resolve()
    manifest = load_manifest(MANIFEST)
    identity = expected_identity(install, manifest)
    if github_sha := os.environ.get("GITHUB_SHA"):
        if identity["commit"] != github_sha:
            raise ValueError("build-info commit differs from the CI checkout")
    dist = install / "dist"
    receipt_path = dist / RECEIPT

    if args.mode == "build":
        # Adapters run only against a private staging tree. The package inventory
        # sees only final outputs, never an adapter's intermediate backup files.
        with tempfile.TemporaryDirectory(prefix="kcn-package-") as staging:
            files = prepare(install, Path(staging), manifest)
        for relative, content in files.items():
            inside(dist, relative).write_bytes(content)

    targets = resolve_targets(dist, manifest)
    verify(dist, targets)
    files = sorted({relative for _, specs in targets for relative, _ in specs})
    receipt = {**identity, "files": {p: sha(inside(dist, p).read_bytes()) for p in files}}
    if args.mode == "build":
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    elif json.loads(receipt_path.read_text()) != receipt:
        raise ValueError("installed package differs from the KCN build receipt")
    print(f"{args.mode}: verified {len(receipt['patches'])} patches for {identity['commit']}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise SystemExit(f"KCN package patches: {exc}") from exc
