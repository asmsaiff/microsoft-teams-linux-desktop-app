# Releasing

Releases are built and published by GitHub Actions. You never upload files by hand.
Push a version tag and [`.github/workflows/release.yml`](.github/workflows/release.yml)
does the rest:

1. Checks that the tag matches `version` in `package.json`.
2. Installs dependencies from `package-lock.json` (`npm ci`) and syntax-checks the code.
3. Renders the icons from `src/assets/icon.svg`.
4. Builds `teams-desktop_<version>_amd64.deb` and `Teams-<version>-x86_64.AppImage`.
5. Writes `SHA256SUMS.txt` and signs a
   [build-provenance attestation](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations)
   for both packages.
6. Creates the GitHub release. Notes come from that version's section of
   [`CHANGELOG.md`](CHANGELOG.md), plus install and verification steps.

Tags containing a hyphen, such as `v1.1.0-beta.1`, are published as **pre-releases**.

---

## One-time setup

### 1. Create the GitHub repository

On github.com, create a new, empty repository named `microsoft-teams-linux-desktop-app`. Don't add a
README, license or `.gitignore`: this project already has them.

> The docs and `package.json` point to `github.com/asmsaiff/microsoft-teams-linux-desktop-app`. If you
> rename the repository, update that path in `package.json`, `README.md` and
> `scripts/release-notes.js`.

### 2. Push the code

```bash
cd ~/Documents/Projects/teams
git add .
git commit -m "Initial release"
git remote add origin https://github.com/asmsaiff/microsoft-teams-linux-desktop-app.git
git push -u origin master
```

The **CI** workflow runs on every push to `master` and on every pull request. It
syntax-checks and packages the app, so problems show up before you tag a release.

### 3. Recommended repository settings

- **Settings → Actions → General → Workflow permissions**: leave on *Read repository
  contents*. The release job asks for write access itself, only for that job.
- **Settings → Rules → Rulesets → New tag ruleset**: target `v*` and restrict
  creation, update and deletion to maintainers. Anyone who can push a `v*` tag can
  publish a release.
- **Settings → Code security**: turn on Dependabot alerts and security updates.
  [`.github/dependabot.yml`](.github/dependabot.yml) already opens weekly PRs for
  Electron and the Actions. Merge Electron updates promptly: they carry Chromium
  security fixes.

---

## Publishing a release

Versions follow [Semantic Versioning](https://semver.org/):

- **patch** (1.0.1): fixes
- **minor** (1.1.0): new features
- **major** (2.0.0): breaking changes

### 1. Test locally

```bash
npm start
```

Sign in, send a message, and make a test call with screen sharing.

```bash
npm run dist
sudo apt install ./dist/teams-desktop_*_amd64.deb
```

Launch the installed app from the app grid and check that it starts and remembers
its window size.

### 2. Update the changelog

In `CHANGELOG.md`, move the items under `## [Unreleased]` into a new section:

```markdown
## [Unreleased]

## [1.1.0] - 2026-10-15

### Added
- ...

### Fixed
- ...
```

Commit it:

```bash
git add CHANGELOG.md
git commit -m "Changelog for 1.1.0"
```

### 3. Bump the version and tag

`npm version` updates `package.json` and `package-lock.json`, commits them, and
creates the matching `v1.1.0` tag. The working tree must be clean.

```bash
npm version minor
```

Use `patch`, `minor`, `major`, or an exact version such as `npm version 1.1.0-beta.1`.

### 4. Push

```bash
git push --follow-tags
```

### 5. Watch it publish

Open the repository's **Actions** tab and follow the **Release** run (about 5–10
minutes). When it finishes, the release appears under **Releases** with:

- `teams-desktop_1.1.0_amd64.deb`
- `Teams-1.1.0-x86_64.AppImage`
- `SHA256SUMS.txt`

Download the `.deb` from the release page and install it once, as a final check.

---

## Fixing problems

**The workflow failed before publishing.** Fix the problem on `master`, then move the
tag to the fixed commit and push it again:

```bash
git tag -f v1.1.0
git push -f origin v1.1.0
```

**Re-upload files to an existing release.** Go to **Actions → Release → Run
workflow** and enter the tag, e.g. `v1.1.0`. The files on that release are replaced.

**A published release is broken.** Don't reuse its version number: people may
already have installed it. Fix the bug and release the next patch version (`npm
version patch`). If needed, delete the bad release from the Releases page, or mark it
as a pre-release to hide it from "latest".

**"Tag vX does not match package.json version Y".** The tag was created by hand
without bumping the version. Delete the tag (`git push origin :refs/tags/vX` and `git
tag -d vX`), then use `npm version`.

---

## Building a release by hand

If Actions is unavailable, build locally and upload through the web UI:

```bash
npm ci
npm run dist
cd dist
sha256sum *.deb *.AppImage > SHA256SUMS.txt
```

Create a release for the tag on GitHub and attach the `.deb`, `.AppImage` and
`SHA256SUMS.txt`. Manual builds have no provenance attestation.

---

## How users verify a download

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

The second check proves the file was built by this repository's release workflow
from a tagged commit. It needs the GitHub CLI.

```bash
gh attestation verify teams-desktop_1.1.0_amd64.deb --repo asmsaiff/microsoft-teams-linux-desktop-app
```
