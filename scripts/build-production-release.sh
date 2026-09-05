#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
commitish=${1:-HEAD}
output_dir=${2:-}

if [[ -z ${output_dir} ]]; then
  echo "usage: $0 <commit> <new-output-directory>" >&2
  exit 2
fi

commit=$(git -C "${repo_root}" rev-parse --verify "${commitish}^{commit}")
if [[ -e ${output_dir} ]]; then
  echo "output directory already exists: ${output_dir}" >&2
  exit 3
fi

mkdir -p "${output_dir}"
archive="${output_dir}/source.tar.gz"
manifest="${output_dir}/source-manifest.sha256"
metadata="${output_dir}/release-metadata.json"

git -C "${repo_root}" archive --format=tar.gz --output="${archive}" "${commit}"

python3 - "${repo_root}" "${commit}" "${manifest}" "${metadata}" <<'PY'
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys

repo, commit, manifest_path, metadata_path = sys.argv[1:]
tree = subprocess.check_output(
    ['git', '-C', repo, 'ls-tree', '-rz', '--full-tree', commit]
)
entries = []
for raw in tree.split(b'\0'):
    if not raw:
        continue
    header, path = raw.split(b'\t', 1)
    mode, kind, object_id = header.decode().split(' ')
    if kind != 'blob':
        raise SystemExit(f'unsupported git tree entry: {kind} {path!r}')
    if mode == '120000':
        raise SystemExit(f'symlinks are not allowed in production releases: {path!r}')
    content = subprocess.check_output(
        ['git', '-C', repo, 'cat-file', 'blob', object_id]
    )
    decoded_path = path.decode('utf-8')
    if '\n' in decoded_path or '\r' in decoded_path:
        raise SystemExit('release paths may not contain newlines')
    entries.append((decoded_path, hashlib.sha256(content).hexdigest()))

entries.sort()
pathlib.Path(manifest_path).write_text(
    ''.join(f'{digest}  {path}\n' for path, digest in entries),
    encoding='utf-8'
)
metadata = {
    'formatVersion': 1,
    'commit': commit,
    'trackedFileCount': len(entries),
    'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'construction': 'git archive from one exact commit; no previous release overlay'
}
pathlib.Path(metadata_path).write_text(
    json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
)
PY

if command -v sha256sum >/dev/null 2>&1; then
  (cd "${output_dir}" && sha256sum source.tar.gz > source.tar.gz.sha256)
else
  (cd "${output_dir}" && shasum -a 256 source.tar.gz > source.tar.gz.sha256)
fi

verify_tree=$(mktemp -d "${TMPDIR:-/tmp}/pojia-release-verify.XXXXXX")
trap 'rm -rf "${verify_tree}"' EXIT
tar -xzf "${archive}" -C "${verify_tree}"
"${repo_root}/scripts/verify-production-release.sh" \
  "${verify_tree}" "${manifest}"

echo "release_commit=${commit}"
echo "release_bundle=${output_dir}"
echo "release_manifest=${manifest}"
