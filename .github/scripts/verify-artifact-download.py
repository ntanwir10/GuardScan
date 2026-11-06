#!/usr/bin/env python3
"""Bind action-downloaded files to the current run's immutable artifact-service ZIP."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tempfile
import zipfile

MAX_ARCHIVE_BYTES = 768 * 1024 * 1024
MAX_EXPANDED_BYTES = 512 * 1024 * 1024
MAX_ENTRIES = 10000


def file_digest(stream):
    digest = hashlib.sha256()
    while True:
        chunk = stream.read(1024 * 1024)
        if not chunk:
            return digest.hexdigest()
        digest.update(chunk)


def verify_download(name, directory):
    repository = os.environ.get('GITHUB_REPOSITORY', '')
    run = os.environ.get('GITHUB_RUN_ID', '')
    if repository != 'ntanwir10/GuardScan' or not re.fullmatch(r'[1-9][0-9]{0,19}', run):
        raise ValueError('Invalid current artifact run identity')
    if not name or len(name) > 256 or any(ord(char) < 32 for char in name):
        raise ValueError('Invalid artifact name')
    pages = json.loads(subprocess.check_output(['gh', 'api', '--paginate', '--slurp',
        'repos/{}/actions/runs/{}/artifacts?per_page=100'.format(repository, run)]))
    artifacts = [artifact for page in pages for artifact in page['artifacts'] if artifact.get('name') == name]
    if len(artifacts) != 1:
        raise ValueError('Expected exactly one current-run named artifact')
    artifact = artifacts[0]
    identity = artifact.get('id')
    digest = artifact.get('digest', '')
    if type(identity) is not int or identity < 1 or artifact.get('expired') is not False:
        raise ValueError('Invalid or expired artifact identity')
    if str(artifact.get('workflow_run', {}).get('id')) != run or not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise ValueError('Missing current-run artifact digest binding')
    # gh follows the authenticated API redirect; no token enters the argument list.
    with tempfile.TemporaryFile() as transport:
        digest_state = hashlib.sha256()
        size = 0
        command = ['gh', 'api', 'repos/{}/actions/artifacts/{}/zip'.format(repository, identity)]
        with subprocess.Popen(command, stdout=subprocess.PIPE) as download:
            while True:
                chunk = download.stdout.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_ARCHIVE_BYTES:
                    download.kill()
                    raise ValueError('Artifact-service ZIP size limit exceeded')
                digest_state.update(chunk)
                transport.write(chunk)
            if download.wait() != 0:
                raise ValueError('Artifact-service ZIP download failed')
        if size == 0 or 'sha256:' + digest_state.hexdigest() != digest:
            raise ValueError('Artifact-service ZIP digest mismatch')
        transport.seek(0)
        verify_zip(transport, directory)


def verify_zip(transport, directory):
    root = Path(directory)
    if not stat.S_ISDIR(root.lstat().st_mode) or root.is_symlink():
        raise ValueError('Artifact destination is not a regular directory')
    actual = {}
    for parent, directories, files in os.walk(str(root), followlinks=False):
        for entry in directories + files:
            target = Path(parent) / entry
            mode = target.lstat().st_mode
            if not stat.S_ISDIR(mode) and not stat.S_ISREG(mode):
                raise ValueError('Artifact destination contains a link or special file')
            if stat.S_ISREG(mode):
                actual[target.relative_to(root).as_posix()] = target
    seen = set()
    expected = set()
    expanded = 0
    with zipfile.ZipFile(transport) as archive:
        entries = archive.infolist()
        if not 0 < len(entries) <= MAX_ENTRIES:
            raise ValueError('Artifact ZIP entry limit exceeded')
        for entry in entries:
            raw = entry.orig_filename
            name = raw[:-1] if entry.is_dir() else raw
            parts = PurePosixPath(name).parts
            if not name or '\\' in raw or ':' in raw or raw.startswith('/') or any(ord(c) < 32 for c in raw) \
                    or any(part in ('', '.', '..') for part in name.split('/')) or not parts:
                raise ValueError('Unsafe artifact ZIP path')
            folded = name.casefold()
            if folded in seen:
                raise ValueError('Duplicate artifact ZIP path')
            seen.add(folded)
            mode = (entry.external_attr >> 16) & 0xffff
            file_type = stat.S_IFMT(mode)
            if file_type not in (0, stat.S_IFDIR if entry.is_dir() else stat.S_IFREG) \
                    or entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError('Artifact ZIP contains a link, encrypted, or unsupported entry')
            expanded += entry.file_size
            if expanded > MAX_EXPANDED_BYTES:
                raise ValueError('Artifact ZIP expanded size limit exceeded')
            if entry.is_dir():
                continue
            expected.add(name)
            if name not in actual or actual[name].stat().st_size != entry.file_size:
                raise ValueError('Artifact ZIP and action output inventories differ')
            with archive.open(entry) as member, actual[name].open('rb') as downloaded:
                if file_digest(member) != file_digest(downloaded):
                    raise ValueError('Action-downloaded bytes differ from authenticated artifact ZIP')
    if expected != set(actual):
        raise ValueError('Artifact ZIP and action output inventories differ')


if __name__ == '__main__':
    verify_download(*sys.argv[1:])
