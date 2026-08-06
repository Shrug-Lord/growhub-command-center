# Use verified tagged releases as the Command Center update channel

Command Center detects and installs appliance updates only from verified, tagged GitHub Releases, not from every commit on the repository's main branch. Releases pass the repository's release checks and provide versioned ARM64 artifacts, while main may contain unshipped or bench-only work; dismissing an update is therefore recorded per release tag so a later release can still prompt.

Automatic installation crosses the container/host boundary through a narrow request directory watched by a one-time-installed Linux host service. The authenticated web application may request only a discovered release tag; it does not receive the Docker socket or arbitrary host-command capability. The host service independently validates the requested tag, runs the existing backup-first release update from the clean checkout, records the result, and survives the application container restart.
