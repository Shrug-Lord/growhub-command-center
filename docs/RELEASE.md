# Release Process

Tagged releases are intentionally blocked until automated checks and the
documented CE hardware contract have passed.

## Prepare

1. Complete `docs/release-evidence/CE-1.1.0C.md` with observed hardware results,
   a Command Center commit, date, broker version, and `Status: passed`.
2. Complete `docs/release-evidence/HOST-COMPATIBILITY.md` from a clean checkout,
   including the reference Raspberry Pi result. The pre-publication ARM64 macOS
   result is in `docs/release-evidence/HOST-macos-arm64-2026-07-13.md`.
3. Update `CHANGELOG.md` and the versions in the root and server package files.
4. Run the local release checks:

       npm run verify
       npm run test:e2e
       npm run security:signatures
       RELEASE_TAG=v0.1.0 npm run release:validate
       npm run compose:config
       npm run compose:build

5. Commit from a clean checkout and create the matching tag:

       git tag -a v0.1.0 -m "Growhub Command Center v0.1.0"
       git push origin main v0.1.0

## Published Artifacts

The tag workflow:

- Repeats quality, browser, accessibility, security, and build checks
- Builds and publishes a Linux AMD64/ARM64 image to GitHub Container Registry
- Publishes a source/deployment archive and `SHA256SUMS`
- Generates GitHub artifact attestations for the image and archive
- Creates a GitHub Release from the verified tag

The image is published as `ghcr.io/shrug-lord/growhub-command-center:<version>`. Repository
owners may need to set the package visibility to public after the first push.

Verify a downloaded source archive with:

    sha256sum --check SHA256SUMS

Verify GitHub provenance with:

    gh attestation verify growhub-command-center-0.1.0.tar.gz --repo Shrug-Lord/growhub-command-center

The release notes must identify the tested CE firmware version and link to both
completed evidence files.
