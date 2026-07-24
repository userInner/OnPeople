# Third-party notices

This internal prototype invokes the Codex CLI/App Server. Codex CLI is distributed under the Apache License 2.0. See <https://github.com/openai/codex>. Its binary is not committed to this source repository; authorized internal release builds may stage it inside the application bundle.

The OnPeople desktop-pet state priority, animation timing model, and optional 1536×1872 sprite-atlas compatibility contract are adapted from the public OpenAI Codex terminal-pet implementation under the Apache License 2.0. See <https://github.com/openai/codex/tree/main/codex-rs/tui/src/pets>. No Codex desktop pet artwork or proprietary application code is included.

Electron is distributed under the MIT License. See <https://github.com/electron/electron>.

The integrated terminal uses `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-clipboard`, and `@xterm/addon-web-links`, all distributed under the MIT License. See <https://github.com/microsoft/node-pty> and <https://github.com/xtermjs/xterm.js>.

The `rrule` JavaScript library is distributed under the BSD 3-Clause License and is used to parse and evaluate iCalendar recurrence rules. See <https://github.com/jkbrzt/rrule>.

The original macOS browser-profile compatibility code interoperates with Chromium data formats documented by Chromium source files including `components/os_crypt/os_crypt_mac.mm`, `net/extras/sqlite/sqlite_persistent_cookie_store.cc`, and the password-manager login database. Chromium is distributed under a BSD-style license. See <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/LICENSE>.

This prototype invokes Cua Driver through its MCP interface. Its source and binaries are not committed to this source repository. Authorized internal release builds may preserve and embed the separately signed CuaDriver.app bundle; its original license, signature, and distribution terms continue to apply. See <https://cua.ai/docs/cua-driver>.

No source or binary from the proprietary OpenAI browser-profile importer is included in this repository. An authorized internal Electron runtime may optionally supply its native linked binding; that separate runtime or importer remains governed by its own license.
