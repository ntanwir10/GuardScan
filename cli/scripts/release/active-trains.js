'use strict';

// Dependency-free so the canary discover job can load it without installing packages.
const RC_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-rc\.(0|[1-9][0-9]*)$/;

// Only the newest rc.N of a stable version can still be promoted; older candidates are superseded.
function supersededVersions(trains) {
  const newest = new Map();
  const parse = version => {
    const match = RC_VERSION.exec(version || '');
    return match && {stable: match.slice(1, 4).join('.'), rc: BigInt(match[4])};
  };
  for (const {version} of trains) {
    const parsed = parse(version);
    if (parsed && !(newest.get(parsed.stable)?.rc >= parsed.rc)) newest.set(parsed.stable, {version, rc: parsed.rc});
  }
  return new Set(trains.map(train => train.version)
    .filter(version => parse(version) && newest.get(parse(version).stable).version !== version));
}

module.exports = {RC_VERSION, supersededVersions};
