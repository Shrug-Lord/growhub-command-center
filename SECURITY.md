# Security Policy

## Supported Versions

Until the first stable release, only the latest commit on the default branch is
supported. After tagged releases begin, security fixes will target the latest
published release.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's
GitHub `Security` tab to submit a private vulnerability report. Include:

- Affected version or commit
- Deployment topology and operating system
- Reproduction steps
- Expected and observed impact
- Any suggested mitigation

Avoid including real passwords, session cookies, CSRF values, MQTT credentials,
diagnostics bundles, private LAN addresses, or device MAC addresses unless the
private report specifically requires them.

## Deployment Boundary

Growhub Command Center is intended for a trusted local network. The reference
deployment uses plain HTTP and an anonymous MQTT listener because CE firmware
1.1.0C does not support broker credentials. Do not forward ports 80 or 1883 to
the public internet.

For remote access, use a VPN. An HTTPS reverse proxy is an advanced alternative;
configure `TRUSTED_PROXIES` only for proxy addresses you control and do not
publish MQTT through it.

## Secrets

First-run admin setup is completed in the UI. The project does not ship default
credentials or require secrets in source-controlled environment files. Keep
runtime app data, backups, `.env` files, cookies, and diagnostics exports out of
issues and commits.

Run the local security gates with:

    npm run security
    npm run security:signatures
