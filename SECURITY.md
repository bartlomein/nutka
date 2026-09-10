# Security reports

Report credential exposure, authorization bypasses, and signer vulnerabilities
privately through GitHub's
[Report a vulnerability](https://github.com/bartlomein/nutka/security/advisories/new)
form. If private reporting is unavailable, ask the maintainer to enable it
without including vulnerability details in a public issue.

Include the affected commit, reproduction steps using dummy credentials, and
the expected and observed behavior. Never send Apple private keys, developer
tokens, Music User Tokens, keyring exports, or browser profile data.

Nutka is pre-release software. Security fixes target the current `main` branch;
there are no maintained release branches yet. Credential handling and process
boundaries are documented in
[Apple Music integration boundaries](docs/APPLE_COMPLIANCE.md).
