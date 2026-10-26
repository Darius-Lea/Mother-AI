# Public web research

Mother's desktop and trusted local modes can read public HTTPS webpages and use
free Bing RSS / DuckDuckGo HTML search endpoints. No paid API key is required.
Those public endpoints are not service guarantees: providers may block automated
access, require a browser check, change their format, or return no results. The
interface reports this rather than inventing web findings.

The web reader makes GET requests only. It does not sign in, execute website
JavaScript, submit forms, send messages, purchase items, or operate accounts.
Mother's separate desktop private browser handles normal website rendering in an
isolated session. See [private browser](PRIVATE-BROWSER.md).

## Internet status and research context

`GET /api/web/status` performs a real bounded HTTPS request to `https://example.com/`,
with `https://github.com/` as a second fixed probe if the first is unavailable.
Successful status identifies the tested URL and time. It does not establish that
all websites are reachable. Status is cached for one minute and cannot become
available merely because the local app is running.

Search results contain actual source titles/URLs. The text reader returns a page
title, source URL, bounded plain text, links, fetch time and SHA-256 of the
retrieved response. Executable elements, scripts, forms and hidden content are
excluded from the extracted reference. HTML is never inserted into the app.
Sites requiring client-side JavaScript may provide little or no readable text;
use the normal browser for those sites.

Reviewing and attaching a source passes it to conversation as **untrusted
reference text**, not system instructions or tool authorization. Web text can be
wrong, adversarial or poisoned. A successful HTTPS request and checksum do not
certify truth, licensing or trust. Research does not retrain model weights.

## Network boundaries

- Public HTTPS only, without embedded credentials or nonstandard ports.
- Every DNS answer is checked for local, private and reserved address ranges.
- Each direct TLS connection pins the validated addresses, preventing a second
  DNS lookup from changing its destination.
- Redirects undergo the same URL and DNS checks, with at most three redirects.
- Requests have a deadline and a 2 MiB encoded/decoded response limit.
- No browser/account cookies, authorization tokens, local paths or private
  application session credentials are sent to websites.
- HTML, XHTML, plain text, XML/RSS and JSON are readable; executable/media
  downloads are refused by this reader.

In managed proxy-only environments, unavailable public DNS may fall back through
the configured verified HTTPS proxy **only** for the fixed established search,
probe and GitHub source hosts. Arbitrary supplied domains never gain remotely resolved proxy
access. A validated private DNS answer is always blocked. Ordinary desktops can
resolve public websites directly and are not restricted to a domain catalog.

The public hosted Render preview denies these computer-owned APIs. The server
must mount `createWebRouter` after the owner-session gate and include its
shutdown hook. Do not expose the unauthenticated local developer server publicly.

## Owner activity

`GET /api/web/activity` returns the latest 100 retained request records for the
owner. Research records contain timestamps, operation/status, search queries or
URLs, and bounded result metadata. Page bodies, passwords and cookies are not
stored in this log. Requests made by automatic conversation research are logged
through the same endpoints. The log is not included in model prompts or the
reference library; the model has no tool for reading it.

The local `web-activity.json` is written atomically with owner-only file mode
where the OS supports it. It retains at most 300 records and 192 KiB, dropping
oldest entries as necessary. `DELETE /api/web/activity` clears retained local
records; it cannot erase website/network logs. This is a bounded activity view,
not a tamper-proof forensic archive.

The private browser maintains its own bounded owner log, which the Web workspace
can display through a separate narrow native bridge. Local private sessions do
not make requests anonymous: websites can still record IP addresses, visits,
browser characteristics and account activity. No untraceable-browser promise is
made.

## Validation

Controlled tests cover URL/DNS/redirect restrictions, TLS address pinning,
untrusted HTML extraction, compression bounds, search-provider fallback, actual
response-based status, and owner-log persistence/privacy/clearing. Test fixtures
do not establish that a third-party search provider is reachable in a particular
deployment. Confirm the live status and a real source read on the target device.
