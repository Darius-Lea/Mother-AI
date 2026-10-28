# Website updates

The installed app and website expose update controls. Checking for an update does not restart Mother or interrupt a conversation. The user chooses when to apply it.

The website compares its loaded build identity with `/api/health` using an uncached request. A changed commit from a newer deployment offers **Update website**. Missing build metadata or an older deployment does not trigger a refresh loop. Saved conversations and settings stay in browser local storage.

The service worker must wait after installing a new version, and only call `skipWaiting()` after receiving `{type: 'ACTIVATE_UPDATE'}`. An explicit website update prepares the worker, requests activation, and waits for `controllerchange` before refreshing. When no worker is installed, the explicit action refreshes directly. No background check or download reloads the page. Failed activation leaves the interface available with an actionable error.

Desktop updates are separate: download the compatible installer in the background, verify its size and SHA-256, then explicitly install. The **Keep working** control only closes the update panel; it does not cancel a download. Users finish a reply before installing or refreshing.
