# Mother's private browser

Open **Web & browser**, enter a public HTTPS address, then choose **Open private
browser** in the desktop app. Mother opens her own address bar, back/forward,
reload and close controls. Remote pages run in a separate sandboxed Chromium
view without Node, a preload bridge, Mother's model, her application protocol
handler, or the desktop API token.

Each window uses fresh, memory-only browsing and toolbar sessions. Cookies,
cache, local storage and HTTP authentication are cleared when it closes. The
browser does not keep a persistent browsing profile. Pop-ups, downloads, device
permissions, private networks and non-HTTPS navigation are blocked. Existing
local application integrations remain a separate, explicitly authorized feature.

The browser is not an anonymity network. Websites and network operators can
record IP addresses, requests, account activity and browser characteristics.
Mother cannot delete or prevent logs on remote websites. Do Not Track and Global
Privacy Control signals are sent, but do not guarantee compliance by a site.

## Owner activity

**Your activity log** shows recent research and browser request metadata. Native
browser logs omit query strings, fragments, credentials, headers, page contents
and form bodies. Paths can still contain private information. Research logs may
include your search queries. Keep this device and its application data private.

Browser metadata rotates across two files of at most 512 KiB each in the private
app-data `audit` folder. Heavy activity can exceed the queue; a truncation record
reports dropped events. This is a bounded investigation aid, not an immutable
or complete forensic archive. The log can be cleared through Mother.

Only the trusted Mother window can read or clear owner logs through narrow IPC.
Remote pages and browser controls have no log-reading method. These records are
not included in model prompts, reference memory, exports or the app integration
API. This controls what context the model receives; it is not a claim that an AI
is conscious or can be prevented from inferring that software may be audited.

## Connection policy

A private, authenticated loopback CONNECT proxy validates every connection's
public DNS answers and pins the TCP connection to a validated IP. It tunnels raw
TLS without decrypting traffic; Chromium retains normal certificate and hostname
verification. Mixed private/public DNS, rebinding to private addresses, local
protocols and nonstandard ports are rejected. Other local apps cannot reuse the
proxy without its per-instance credentials. The proxy closes with its window.

This affects only the included browser. It does not change system proxy or
firewall settings. A managed cloud environment can still block ordinary outbound
connections; that is distinct from the browser's local isolation and from
Mother's separately tested web reader.

## Validation

Network tests cover authentication, all-answer DNS checks, IP pinning, rebinding,
timeouts, private addresses, IPv6, connection limits and shutdown. Audit tests
cover redaction, bounded rotation, clearing and trusted sender checks. The native
smoke script checks the actual controls, remote view isolation, blocked private
links, cleared cookies and owner activity. Native execution on every supported
operating system and independent privacy review remain separate work.
