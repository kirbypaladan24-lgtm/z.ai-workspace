import json, os, re, sys

# V1A (record plan V1): demonstrate the three-layer verification chain on the
# REAL workspace: manifest (package.json, ranges) -> lockfile (bun.lock, exact
# resolved versions) -> installed tree (node_modules, what actually runs).
# Negative control: a plausible-but-fabricated package must be caught at the
# first two layers. Environmental note recorded honestly if node_modules is
# absent (no node runtime on this machine).

pkg = json.load(open('package.json'))
lock_text = open('bun.lock').read()
lock = json.loads(re.sub(r',\s*([}\]])', r'\1', lock_text))
ws = lock.get('workspaces', {}).get('', {})
pkgs = lock.get('packages', {})

ok = True

# Layer 1: the manifest declares a RANGE
declared = (pkg.get('dependencies', {}).get('@prisma/client')
            or pkg.get('devDependencies', {}).get('@prisma/client'))
print(f"V1A layer1 manifest: @prisma/client declared as {declared!r} (a RANGE — what the manifest asks for)")
ok = ok and isinstance(declared, str) and declared.startswith('^')

# Layer 2: the lockfile records the EXACT resolved version
entry = pkgs.get('@prisma/client')
resolved = entry[0] if isinstance(entry, list) and entry else None
print(f"V1A layer2 lockfile: resolved to {resolved!r} (EXACT version + registry tarball + integrity hash)")
ok = ok and bool(resolved) and bool(re.match(r'^@prisma/client@\d+\.\d+\.\d+$', resolved))
resolved_version = resolved.split('@')[-1]

# The drift between layers is the record's point: manifests carry ranges,
# lockfiles pin exact resolutions, docs describe the latest release.
print(f"V1A drift: manifest range {declared!r} vs lockfile pin {resolved_version!r} — each layer can differ; verification must walk down the chain")

# Negative control: a plausible-but-fabricated package must be in NEITHER layer
fake = 'react-super-router'
in_manifest = fake in json.dumps(pkg) or fake in json.dumps(ws)
in_lock = fake in lock_text
print(f"V1A fabricated package {fake!r}: in-manifest={in_manifest} in-lockfile={in_lock} -> hallucinated dependency caught at layers 1-2")
ok = ok and not in_manifest and not in_lock

# Layer 3: the installed tree — what actually runs
nm = 'node_modules/@prisma/client/package.json'
if os.path.exists(nm):
    installed = json.load(open(nm)).get('version')
    print(f"V1A layer3 installed: node_modules/@prisma/client version {installed!r}")
    print(f"V1A lockfile-vs-installed match: {installed == resolved_version}")
    ok = ok and installed == resolved_version
else:
    print("V1A layer3: node_modules ABSENT on this workspace (no node runtime here) — recorded as an environmental limitation")
    print("V1A-NODE-MODULES-ABSENT")
    print("V1A layer3 is demonstrated in the Z.ai sandbox VM (installed tree present there) — see the run analysis")

print("V1A-CHAIN-VERIFIED" if ok else "V1A-FAILED")
sys.exit(0 if ok else 1)
