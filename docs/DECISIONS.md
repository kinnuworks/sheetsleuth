# Decisions

## Session 0

- `docker info` was attempted on October 20, 2026, but Docker is not installed in the sandbox. The lockfile fallback is the direct Linux command `npm install --package-lock-only`; the native CI judge jobs remain the rebuild proof.
- `soffice --version` was initially unavailable, so `libreoffice-calc-nogui` was installed with apt. The recorded version is `LibreOffice 7.4.7.2 40(Build:2)`.
- The Dockerfile will still use the required pinned `node:22.23.3-bookworm-slim` multi-arch image reference. The registry digest is recorded after the tag is checked because the local Docker CLI is unavailable.
