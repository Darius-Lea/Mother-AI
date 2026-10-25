# Mother on phones and tablets

Mother currently provides an installable web interface, not a native iOS or Android application with a bundled neural runtime. The mobile layout, offline cached interface, browser memory and offline guide are separate from the Node server and local Ollama model.

## The ordinary-user installation flow

1. Open a real, reachable Mother HTTPS address in a supported browser.
2. On Android, use **Install app** or **Add to Home screen**. When the browser offers a supported installation prompt, Mother's download center can open it.
3. On iPhone or iPad, open the site in Safari, tap **Share**, then **Add to Home Screen**.
4. Confirm installation with the operating system and launch Mother from her icon.

The operating system controls its installation confirmation. A website cannot silently install itself or another runtime on arbitrary devices. Installation support and menu names vary by browser and operating-system version.

No public hosted mobile URL, App Store listing or Play Store listing is included in this development build. A download catalog entry must not invent one.

## What works after installation

The production service worker can cache the interface after an initial successful visit. Cached access includes the visual interface and the explicitly labeled offline guide. Browser-local memory remains on that browser/device unless the user exports it.

Neural conversations, model downloads, application integration endpoints, URL-dataset inspection and server-side coding tools still require the Mother server. That server needs its own working Ollama runtime and installed model for neural conversation. A cached page is not evidence that the server or model is running on the phone.

## Deployment requirements

A phone needs a reachable server, appropriate authentication and HTTPS. `localhost` on a phone means the phone itself; it does not refer to the user's laptop. A private desktop's ephemeral loopback API is not a remote mobile service. Do not expose an unauthenticated development server to the public internet to make a phone connect.

Secure remote deployment, user/account authentication, private network access, and trusted device pairing need to be deliberately configured and tested. There is no automatic Bluetooth migration, universal Wi-Fi pairing, or shared-memory synchronization in this version. Memory transfer is explicit export/import.

## Browser capabilities

Speech output depends on installed device voices. Speech recognition is optional and may use an online service provided by the browser. WebGL availability and model hardware requirements differ. Browser installation does not confer access to other apps, smart-home equipment, files, microphones or Bluetooth devices without the relevant permission and supported interface.

## Native stores and signing

Native Android packages and iOS app signing are separate deliverables and are not claimed here. Store publication, developer-account requirements, platform review and code signing are different from building a web app. The mobile web option avoids an app-store dependency but still needs real hosting and secure connectivity for server-backed features.
