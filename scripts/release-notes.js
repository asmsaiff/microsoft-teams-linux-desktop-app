'use strict';

// Prints the release notes for a tag: that version's section of CHANGELOG.md plus
// install and verification instructions. Used by the release workflow.

const fs = require('node:fs');
const path = require('node:path');

const tag = process.argv[2] || '';
const version = tag.replace(/^v/, '');
const repo = process.env.GH_REPO || 'asmsaiff/teams-desktop';

const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const lines = changelog.split('\n');
const start = lines.findIndex((l) => new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`).test(l));
let notes = 'See CHANGELOG.md for details.';
if (start !== -1) {
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  notes = lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
}

const deb = `teams-desktop_${version}_amd64.deb`;
process.stdout.write(`${notes}

## Install

Download **${deb}** below, then:

\`\`\`bash
sudo apt install ./${deb}
\`\`\`

Or use the portable **Teams-${version}-x86_64.AppImage** (\`chmod +x\` it, then run it).

## Verify the download

\`\`\`bash
sha256sum -c SHA256SUMS.txt --ignore-missing
gh attestation verify ${deb} --repo ${repo}
\`\`\`
`);
