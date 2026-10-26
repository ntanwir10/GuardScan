import path from 'path';
import {spawnSync} from 'child_process';
import fs from 'fs';
import yaml from 'js-yaml';

describe('Chocolatey publication idempotency', () => {
  it('compares rendered and NuGet-serialized nuspec metadata without weakening package payload equality', () => {
    const script = [
      'import importlib.util,io,pathlib,sys,tempfile,zipfile',
      's=importlib.util.spec_from_file_location("p",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
      `rendered='<package xmlns="http://schemas.microsoft.com/packaging/2015/06/nuspec.xsd"><metadata><id>guardscan</id><version>1.2.3</version><description>Exact description</description><dependencies><dependency id="safe" version="[1.0.0]" /></dependencies></metadata><files><file src="tools\\\\**" target="tools" /></files></package>'`,
      // PackageBuilder.WriteManifest reconstructs Manifest.Create(this), then
      // saves metadata without the source-only files packaging map.
      `packed='''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <version>1.2.3</version><id>guardscan</id>
    <dependencies><dependency version="[1.0.0]" id="safe" /></dependencies>
    <description>Exact description</description>
  </metadata>
</package>'''`,
      'def package(nuspec,installer="exact installer",extra=False):',
      '    data=io.BytesIO()',
      '    with zipfile.ZipFile(data,"w") as z:',
      '        z.writestr("guardscan.nuspec",nuspec);z.writestr("tools/chocolateyInstall.ps1",installer)',
      '        if extra: z.writestr("tools/extra.ps1","extra")',
      '    return data.getvalue()',
      'with tempfile.TemporaryDirectory() as root:',
      '    local=pathlib.Path(root)/"guardscan.nupkg";local.write_bytes(package(rendered))',
      '    result=m.preflight(local,"1.2.3",lambda _:package(packed))',
      '    assert result["publishRequired"] is False',
      '    assert result["payloadDigest"]==m.preflight(local,"1.2.3",lambda _:package(rendered))["payloadDigest"]',
      '    for remote in [package(packed,installer="changed"),package(packed,extra=True),package(packed.replace("Exact description","Changed metadata")),package(packed.replace("[1.0.0]","[9.0.0]")),package(packed.replace("<id>guardscan</id>","<id>guardscan</id><id>other</id>")),package(packed.replace("2013/05/nuspec.xsd","2099/01/nuspec.xsd")),package(packed.replace("</package>","<ignored>unsafe</ignored></package>"))]:',
      '        try: m.preflight(local,"1.2.3",lambda _:remote)',
      '        except ValueError: pass',
      '        else: raise AssertionError("changed or ambiguous metadata/payload accepted")',
      'print("NuGet metadata canonicalization preserves exact payload boundaries")',
    ].join('\n');
    const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script,
      path.resolve(__dirname, '../../scripts/release/chocolatey-preflight.py')], {encoding: 'utf8', timeout: 10000});
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
    expect(result.stdout).toContain('preserves exact payload boundaries');
  });

  it('compares complete package payloads and exact identity without timestamp/GUID churn', () => {
    const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', [
      'import contextlib, importlib.util, io, pathlib, runpy, sys, tempfile, urllib.error, zipfile',
      'from unittest.mock import patch',
      'helper = sys.argv[1]',
      'spec = importlib.util.spec_from_file_location("preflight", sys.argv[1])',
      'module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)',
      'def package(content="verified installer", version="1.2.3", extra=False, identity="guardscan", guid="a" * 32):',
      '    data = io.BytesIO()',
      '    with zipfile.ZipFile(data, "w") as archive:',
      '        archive.writestr("guardscan.nuspec", f"<package><metadata><id>{identity}</id><version>{version}</version></metadata></package>")',
      '        archive.writestr("tools/chocolateyInstall.ps1", content)',
      `        archive.writestr(f"package/services/metadata/core-properties/{guid}.psmdcp", '<coreProperties xmlns="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" />')`,
      '        if extra: archive.writestr("tools/extra.ps1", "unexpected")',
      '    return data.getvalue()',
      'def absent(_version): raise urllib.error.HTTPError("https://community.chocolatey.org", 404, "missing", {}, None)',
      'with tempfile.TemporaryDirectory() as root:',
      '    local = pathlib.Path(root) / "guardscan.1.2.3.nupkg"; local.write_bytes(package())',
      '    assert module.preflight(local, "1.2.3", lambda _version: package(guid="b" * 32))["publishRequired"] is False',
      '    assert module.preflight(local, "1.2.3", absent)["publishRequired"] is True',
      '    for remote in [package(content="different"), package(extra=True), package(version="1.2.4"), package(identity="other")]:',
      '        try: module.preflight(local, "1.2.3", lambda _version: remote)',
      '        except (ValueError, RuntimeError): pass',
      '        else: raise AssertionError("conflicting package accepted")',
      '    def failure(_version): raise urllib.error.HTTPError("https://community.chocolatey.org", 500, "error", {}, None)',
      '    try: module.preflight(local, "1.2.3", failure)',
      '    except module.RegistryUnavailable: pass',
      '    else: raise AssertionError("server failure became a publication request")',
      '    with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("https://community.chocolatey.org", 503, "temporary", {}, None)), contextlib.redirect_stderr(io.StringIO()):',
      '        sys.argv = [helper, "--package", str(local), "--version", "1.2.3"]',
      '        try: runpy.run_path(helper, run_name="__main__")',
      '        except SystemExit as error: assert error.code == 75',
      '        else: raise AssertionError("temporary failure has no retry exit code")',
      'print("Chocolatey identity, payload-set, duplicate, and server-error regressions passed")',
    ].join('\n'), path.resolve(__dirname, '../../scripts/release/chocolatey-preflight.py')], {
      encoding: 'utf8', timeout: 10000,
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
    expect(result.stdout).toContain('regressions passed');
  });

  it('classifies fetch-only dropped connections and truncated responses as retryable, not local conflicts', () => {
    const script = [
      'import http.client, importlib.util, io, pathlib, sys, tempfile, urllib.error, zipfile',
      'spec = importlib.util.spec_from_file_location("preflight", sys.argv[1])',
      'module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)',
      'data = io.BytesIO()',
      'with zipfile.ZipFile(data, "w") as archive:',
      '    archive.writestr("guardscan.nuspec", "<package><metadata><id>guardscan</id><version>1.2.3</version></metadata></package>")',
      '    archive.writestr("tools/chocolateyInstall.ps1", "installer")',
      'with tempfile.TemporaryDirectory() as root:',
      '    local = pathlib.Path(root) / "package.nupkg"; local.write_bytes(data.getvalue())',
      '    for failure in [ConnectionResetError("reset"), http.client.RemoteDisconnected("closed"), http.client.IncompleteRead(b"part", 42), urllib.error.HTTPError("url", 503, "unavailable", {}, None)]:',
      '        def fetch(_version): raise failure',
      '        try: module.preflight(local, "1.2.3", fetch)',
      '        except module.RegistryUnavailable: pass',
      '        else: raise AssertionError("transport failure was not retryable")',
      '    try: module.preflight(local, "1.2.3", lambda _: b"truncated ZIP")',
      '    except module.RegistryUnavailable: pass',
      '    else: raise AssertionError("truncated remote body was treated as a payload conflict")',
      '    for status in [401, 403, 409]:',
      '        def fatal(_version): raise urllib.error.HTTPError("url", status, "fatal", {}, None)',
      '        try: module.preflight(local, "1.2.3", fatal)',
      '        except urllib.error.HTTPError: pass',
      '        else: raise AssertionError("fatal HTTP status was retried")',
      '    local.write_bytes(b"broken local ZIP")',
      '    try: module.preflight(local, "1.2.3", lambda _: data.getvalue())',
      '    except zipfile.BadZipFile: pass',
      '    else: raise AssertionError("local corruption was classified as network failure")',
      'print("fetch-only retry boundary passed")',
    ].join('\n');
    const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script,
      path.resolve(__dirname, '../../scripts/release/chocolatey-preflight.py')], {encoding: 'utf8', timeout: 10000});
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
    expect(result.stdout).toContain('fetch-only retry boundary passed');
  });

  it('preflights before push and accepts retry/race success only with matching remote payloads', () => {
    const workflow: any = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/release-publish.yml'), 'utf8'));
    const submit = workflow.jobs.chocolatey.steps.find((step: any) => step.name === 'Preflight and submit Chocolatey package with exact evidence');
    expect(submit.env.RELEASE_TAG).toBe('${{ inputs.tag }}');
    expect(submit.run).toContain("$version = $env:RELEASE_TAG.TrimStart('v')");
    expect(submit.run).toContain('chocolatey-preflight.py');
    const preflight = submit.run.indexOf('$publicationState = Get-PublicationState\n');
    const push = submit.run.indexOf('choco push');
    expect(preflight).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(preflight);
    expect(submit.run).toContain('publishRequired');
    expect(submit.run).toContain('Chocolatey package did not converge');
    expect(submit.run).toContain('catch [System.IO.IOException]');
    expect(submit.run).toContain('$LASTEXITCODE -eq 75 -and $retryUnavailable');
    expect(submit.run.indexOf('Get-PublicationState $true')).toBeGreaterThan(submit.run.indexOf('choco push'));
    expect(submit.run).toContain('$packageDigest = $publicationState.payloadDigest');
  });
});
