# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.1] - 2026-09-23

### Fixed

- Mouse clicks did nothing inside Teams. The Teams web app marks its loading screen
  as a window-drag area (meant for Microsoft's own desktop app), which turned the whole
  window into a drag handle. Pages can no longer declare drag areas; only the app's
  title bar can.
- When maximized, the title bar and page were laid out 32 px too wide, pushing part of
  the close button off-screen.

## [1.0.0] - 2026-09-23

### Added

- First release: Microsoft Teams web client in a hardened Electron 44 shell for Ubuntu.
- Frameless, square-cornered window with a slim custom title bar.
- Window size, position, maximized state and zoom are restored on launch.
- Faster start: early page load, pre-opened connections, persistent cache.
- Tray icon with close-to-tray, unread badge, screen-share picker, `msteams:` links.
- Security: sandboxed renderers, Microsoft-only navigation allowlist, permission
  gate, blocked plain HTTP, Electron fuses, encrypted cookies, and remote debugging
  refused in release builds.
- `.deb` (with AppArmor profile) and AppImage packages.
