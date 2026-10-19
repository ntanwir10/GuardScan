"""Fail-closed Chocolatey package retry check; no credentials or third-party modules."""
import argparse
import hashlib
import io
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

MAX_PACKAGE_BYTES = 16 * 1024 * 1024
MAX_EXPANDED_BYTES = 8 * 1024 * 1024
CORE_PROPERTIES = re.compile(r"package/services/metadata/core-properties/[0-9a-fA-F]{32}\.psmdcp")


def package_inventory(data, version):
    if not data or len(data) > MAX_PACKAGE_BYTES:
        raise ValueError("Chocolatey package size is outside the supported limit")
    inventory, seen, expanded, core_properties = {}, set(), 0, 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if not 1 <= len(entries) <= 128:
            raise ValueError("Chocolatey package entry count is invalid")
        names = {entry.filename for entry in entries}
        for entry in entries:
            name = entry.filename
            parts = name.rstrip('/').split('/')
            if (not name or '\\' in name or ':' in name or '\x00' in name
                    or any(part in ('', '.', '..') for part in parts)
                    or name.casefold() in seen or (entry.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("Chocolatey package contains unsafe or duplicate paths")
            seen.add(name.casefold())
            expanded += entry.file_size
            if expanded > MAX_EXPANDED_BYTES:
                raise ValueError("Chocolatey package expanded size exceeds its limit")
            if entry.is_dir():
                continue
            payload = archive.read(entry)
            metadata = name in ('_rels/.rels', '[Content_Types].xml') or CORE_PROPERTIES.fullmatch(name)
            if metadata:
                if CORE_PROPERTIES.fullmatch(name):
                    core_properties += 1
                    if core_properties > 1:
                        raise ValueError("Chocolatey package has duplicate core properties")
                # NuGet emits a fresh GUID for OPC core properties on every pack.
                # These are packaging descriptors, not installable payload files.
                if b'<!DOCTYPE' in payload.upper() or b'<!ENTITY' in payload.upper():
                    raise ValueError("Chocolatey packaging metadata contains XML declarations")
                document = ET.fromstring(payload)
                expected_root = ('Relationships' if name == '_rels/.rels' else
                                 'Types' if name == '[Content_Types].xml' else 'coreProperties')
                if document.tag.split('}')[-1] != expected_root:
                    raise ValueError("Chocolatey packaging metadata has an unexpected root")
                if name == '_rels/.rels':
                    for relation in document:
                        target = relation.get('Target', '').lstrip('/')
                        if (relation.get('TargetMode', 'Internal') != 'Internal' or target not in names
                                or not (target == 'guardscan.nuspec' or CORE_PROPERTIES.fullmatch(target))):
                            raise ValueError("Chocolatey package has an unexpected OPC relationship")
                continue
            inventory[name] = hashlib.sha256(payload).hexdigest()
            if name == 'guardscan.nuspec':
                if b'<!DOCTYPE' in payload.upper() or b'<!ENTITY' in payload.upper():
                    raise ValueError("Chocolatey identity contains XML declarations")
                document = ET.fromstring(payload)
                identity = document.find('.//{*}metadata/{*}id')
                release = document.find('.//{*}metadata/{*}version')
                if identity is None or (identity.text or '').lower() != 'guardscan' or release is None or release.text != version:
                    raise ValueError("Chocolatey package identity/version mismatch")
        if 'guardscan.nuspec' not in inventory or 'tools/chocolateyinstall.ps1' not in inventory:
            raise ValueError("Chocolatey package lacks the required identity or installer")
    return inventory


def fetch_package(version):
    # Explicit versions are downloadable even while unlisted/under moderation.
    url = 'https://community.chocolatey.org/api/v2/package/guardscan/' + version
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read(MAX_PACKAGE_BYTES + 1)


def preflight(package, version, fetch=fetch_package):
    version = version[1:] if version.startswith('v') else version
    if not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version):
        raise ValueError("Chocolatey publication requires an exact stable version")
    package = pathlib.Path(package)
    if package.stat().st_size > MAX_PACKAGE_BYTES:
        raise ValueError("Chocolatey package size exceeds its limit")
    local = package_inventory(package.read_bytes(), version)
    digest = hashlib.sha256(json.dumps(local, sort_keys=True).encode()).hexdigest()
    try:
        remote = fetch(version)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        return {'publishRequired': True, 'payloadDigest': digest}
    if package_inventory(remote, version) != local:
        raise ValueError("Existing Chocolatey version has conflicting package payloads")
    return {'publishRequired': False, 'payloadDigest': digest}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(preflight(args.package, args.version)))
    except (urllib.error.URLError, TimeoutError) as error:
        if isinstance(error, urllib.error.HTTPError) and error.code not in (429, 500, 502, 503, 504):
            raise
        # Pre-push remains fail-closed; only post-push polling may retry this code.
        print('Chocolatey registry is temporarily unavailable', file=sys.stderr)
        sys.exit(75)
