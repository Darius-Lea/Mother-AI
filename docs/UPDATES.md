# Updating Mother

The installed app checks Mother's fixed GitHub preview channel for an installer
matching its operating system and processor. Checking does not install anything.
Choose **Download update** to download in the background; the progress remains
available while you keep using Mother. Choose **Install update** when ready to
close Mother and let the normal operating-system installer replace the app.
Conversations, approved sources, settings and downloaded models stay in Mother's
existing user-data directory. Do not uninstall Mother to update her.

An older preview that predates the update controls needs one installation of the
new installer over the existing app. After that, use the in-app update controls.
Unsigned preview installers can still display the normal operating-system warning
or approval prompt. Mother does not bypass those checks or claim a signed release.

The updater accepts only the public `mother-preview/downloads.json` catalog in
`Darius-Lea/Mother-AI`. It requires an exact platform/architecture match and an
immutable filename containing the first twelve characters of the SHA-256 digest.
Downloads use HTTPS, restricted GitHub asset hosts, a bounded private cache, a
random temporary filename, and size, header and complete SHA-256 checks. The file
is checked again immediately before the OS installer opens. Cancellation removes
the partial download. Paths and temporary asset-URL credentials are never sent to
the renderer. A matching catalog checksum detects corruption; it is not a digital
publisher signature or proof of native installation testing.

A later build can update an earlier build of the same preview version when their
embedded source commits differ. Older versions and catalog timestamps predating
the installed build are not offered. Build identity is important for rolling
preview updates; a development build without an embedded commit relies on version
increments.
