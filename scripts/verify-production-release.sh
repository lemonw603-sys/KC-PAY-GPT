#!/usr/bin/env bash
set -euo pipefail

release_dir=${1:-}
manifest=${2:-}

if [[ ! -d ${release_dir} || ! -f ${manifest} ]]; then
  echo "usage: $0 <release-directory> <source-manifest.sha256>" >&2
  exit 2
fi

python3 - "${release_dir}" "${manifest}" <<'PY'
import hashlib
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
manifest_path = pathlib.Path(sys.argv[2])
expected = {}
for number, line in enumerate(manifest_path.read_text(encoding='utf-8').splitlines(), 1):
    try:
        digest, relative = line.split('  ', 1)
    except ValueError as error:
        raise SystemExit(f'invalid manifest line {number}') from error
    if len(digest) != 64 or any(char not in '0123456789abcdef' for char in digest):
        raise SystemExit(f'invalid digest on manifest line {number}')
    path = pathlib.PurePosixPath(relative)
    if path.is_absolute() or '..' in path.parts or relative in expected:
        raise SystemExit(f'unsafe or duplicate manifest path on line {number}')
    expected[relative] = digest

actual = {}
for path in root.rglob('*'):
    relative_path = path.relative_to(root)
    relative = relative_path.as_posix()
    if 'node_modules' in relative_path.parts:
        continue
    if path.is_symlink():
        raise SystemExit(f'release contains forbidden symlink: {relative}')
    if path.is_file():
        actual[relative] = hashlib.sha256(path.read_bytes()).hexdigest()

missing = sorted(set(expected) - set(actual))
changed = sorted(path for path in set(expected) & set(actual)
                 if expected[path] != actual[path])
extra = sorted(set(actual) - set(expected))
if missing or changed or extra:
    print(f'release_manifest=FAILED missing={len(missing)} changed={len(changed)} extra={len(extra)}')
    for label, paths in [('missing', missing), ('changed', changed), ('extra', extra)]:
        for path in paths[:100]:
            print(f'{label}={path}')
    raise SystemExit(1)

print(f'release_manifest=OK tracked_files={len(expected)}')
PY
