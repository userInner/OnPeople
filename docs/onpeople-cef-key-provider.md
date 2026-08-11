# OnPeople CEF macOS Keychain contract

OnPeople uses the unmodified CEF framework and the real macOS system Keychain. Release
and development builds must never add `use-mock-keychain`, store a plaintext browser key,
or silently fall back to a fixed key.

Stock CEF owns its Chromium Safe Storage item. The item is protected by macOS code-signing
ACLs, so stable signing identity and a stable bundle layout are release invariants:

- `OnPeople.app`, `OnPeople Browser Host.app`, every Helper app/executable, and the CEF
  Framework are signed by Developer ID Team `6K4S66PVRQ`;
- the Browser Host bundle ID is `com.userinner.onpeople.browser-host`;
- Helper bundle IDs use the fixed `com.userinner.onpeople.browser-host.*` namespace;
- the release Browser Host is loaded only from the current app's
  `Contents/Resources/.embedded-runtime` directory;
- signing is performed inside an independent temporary staging directory, from the
  Framework and Helpers outward, and the runtime manifest is hashed only after signing.

If the source checkout itself is under Documents or another File Provider location, set
`ONPEOPLE_SIGNED_RUNTIME_OUTPUT` to an absolute external path ending in
`.embedded-runtime`. The signing task validates the committed output again; it must never
accept a bundle after File Provider has attached Finder metadata. Public release builds
should run from a non-File Provider workspace so Tauri embeds that verified runtime
directly.

CEF subprocesses call `execute_process` before Profile, storage, browser context, or IPC
initialization. Only the empty-process-type Browser Process proceeds to open the Profile
and initialize CEF. The Browser Host has a per-Profile singleton lock, and the Tauri shell
shares one `ensure_browser_ready()` initialization among concurrent browser requests.

The stock framework does not expose a supported API for renaming Chromium Safe Storage.
Changing the Keychain service would require a custom Chromium/CEF build and is intentionally
outside this implementation. The old Electron application credential item remains
`OnPeople Safe Storage` / `OnPeople Key`; migration code may read it once for legacy
application secrets, but CEF does not reuse it for the browser Profile.

Development builds use `com.userinner.onpeople.dev`, the
`internal-agent-workbench-dev/cef-profile` Profile, and never access the production Profile.
