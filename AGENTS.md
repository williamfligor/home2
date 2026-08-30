# Agent Instructions

Do not run `.test.sh` proactively. Run the smoke tests (`bash .test.sh`) only when the user explicitly asks for a test run. When asked, note that the script depends on docker (or podman) with the `buildx` plugin and BuildKit available, which this environment often cannot provide (e.g. missing buildx, sandbox without root to install it); missing buildx / BuildKit should be reported rather than worked around.
