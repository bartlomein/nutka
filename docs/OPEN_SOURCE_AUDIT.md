# Open-source readiness review

Reviewed September 11, 2026, against commit `ca4dc89` and the local working tree.

No confirmed credential exposure or source-publication blocker was found in
the reviewed files and locally available Git history. This is a scoped review,
not a guarantee that the software has no vulnerabilities. Publishing the source
and operating a public Apple Music service are separate decisions.

## Secret checks

- Gitleaks 8.30.1 scanned all 16 commits reachable from local Git refs, including
  remote-tracking refs, and a copy of the tracked and unignored working files.
- The only initial finding was the literal `not base64!` invalid PEM fixture in
  `services/apple-token/test/token.test.ts`. It is not a private key. The scanner
  configuration now documents that specific exception. Both scans then passed.
- A freshly generated private key placed in a temporary copy of the same test
  path was still detected, verifying that the exception does not exempt the file.
- Three secret fragments read locally from the development configuration were
  compared against 434 reachable Git blob and commit objects. None matched.
  Credential values were not printed or sent to a remote scanner.
- `.env`, `.dev.vars`, private-key extensions, and Wrangler runtime data are
  ignored by Git. The local `.env` permissions were tightened from `0644` to
  `0600`, so other local users cannot read it through ordinary file permissions.

## Code and automation review

The reviewed authentication flow keeps signing keys in the Worker and user
tokens in the OS credential store. Credential subprocesses receive tokens on
standard input, and playback uses private process/browser pipes. Browser child
environments are filtered and Chromium sandboxing is not disabled.

The authorization broker uses random, expiring, single-use browser capabilities,
CSRF checks, and exact browser-origin checks. Its server binds to IPv4 loopback.
Apple pagination URLs are checked against the expected API origin and path;
credential-bearing HTTP requests do not automatically follow redirects.

The signer defaults to disabled, uses short-lived signatures, returns generic
errors, disables response caching, and fails closed if rate limiting fails.
Its public developer tokens can still be reused until expiry. The per-location
rate limiter is not a global quota or proof that a requester is Nutka.

GitHub Actions already uses read-only repository permissions, pinned action
commits, frozen lockfile installs, and no persisted checkout credentials. Added
a checksum-pinned Gitleaks job with full-history scanning and redacted output.
Extended Dependabot from GitHub Actions to both Bun packages. This uses GitHub's
[documented Bun ecosystem support](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).
The scan configuration follows the [Gitleaks configuration format](https://github.com/gitleaks/gitleaks#configuration).

MIT licensing, contribution instructions, architecture documentation, and a
security reporting policy are present. Direct runtime package metadata declares
MIT for OpenTUI and Hono and Apache-2.0 for Puppeteer. A packaged release still
needs an inventory of bundled dependencies and their required notices.

## Validation

- Both TypeScript checks passed.
- All 400 client/script tests and 36 signer tests passed.
- Both `bun audit --json` checks returned no known advisories at review time.
- Workflow and Dependabot YAML parsed successfully; `git diff --check` passed.
- Two loopback tests initially failed in the restricted sandbox. The complete
  suite passed when local port binding was allowed.

The new workflow has been checked locally but has not run on GitHub yet. This
review did not repeat interactive Apple login, Linux playback, or macOS playback.

## GitHub settings to finish when publishing

The repository is currently private. The GitHub API did not expose private
vulnerability reporting for this repository, so the reporting link in
`SECURITY.md` is not yet verified usable. Enable and verify private vulnerability
reporting when making the repository public.

GitHub rejected the branch-protection read with a plan/visibility restriction.
After publication, configure protection for `main`, require the check jobs, and
enable available secret scanning and push protection. These account settings
were not changed during this audit.

The audit covers local refs and files, not deleted remote branches, historical
CI artifacts, issue attachments, or other people's copies. No repository
visibility change, commit, push, or deployment was performed.
