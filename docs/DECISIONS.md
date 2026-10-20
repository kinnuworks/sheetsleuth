# Decisions

## Session 0

- `docker info` was attempted on October 20, 2026, but Docker is not installed in the sandbox. The lockfile fallback is the direct Linux command `npm install --package-lock-only`; the native CI judge jobs remain the rebuild proof.
- `soffice --version` was initially unavailable, so `libreoffice-calc-nogui` was installed with apt. The recorded version is `LibreOffice 7.4.7.2 40(Build:2)`.
- The `node:22.23.3-bookworm-slim` tag returned a multi-arch OCI index on October 20, 2026. Its index digest is `sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`; this is the digest used in the Dockerfile. The local Docker CLI was unavailable, so the registry API supplied the same tag/index evidence that `docker buildx imagetools inspect` would provide.
