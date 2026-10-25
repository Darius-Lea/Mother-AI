'use strict';
// electron-builder invokes this hook only after all requested artifact tasks succeed.
// Failed NSIS runs can leave executable stubs: no receipt is emitted for them.
const { verifyArtifacts } = require('../scripts/desktop-verify-artifacts.cjs');
module.exports = async context => {
  await verifyArtifacts(context.artifactPaths, require('../package.json').version);
  return [];
};
