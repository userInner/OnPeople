import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedDesktopNavigation } from "./desktop-navigation.mjs";

const packagedEntryPath =
  "/Applications/OnPeople.app/Contents/Resources/app/dist/index.html";

test("allows only the packaged desktop entry document", () => {
  assert.equal(
    isAllowedDesktopNavigation({
      targetUrl:
        "file:///Applications/OnPeople.app/Contents/Resources/app/dist/index.html?thread=1#task",
      packagedEntryPath,
    }),
    true,
  );
  assert.equal(
    isAllowedDesktopNavigation({
      targetUrl: "file:///Users/example/workspace/report.md",
      packagedEntryPath,
    }),
    false,
  );
  assert.equal(
    isAllowedDesktopNavigation({
      targetUrl: "file:///tmp/report.pdf",
      packagedEntryPath,
    }),
    false,
  );
});

test("allows the development origin without allowing arbitrary files or sites", () => {
  const developmentUrl = "http://127.0.0.1:1420/";
  assert.equal(
    isAllowedDesktopNavigation({
      targetUrl: "http://127.0.0.1:1420/index.html#thread",
      developmentUrl,
      packagedEntryPath,
    }),
    true,
  );
  assert.equal(
    isAllowedDesktopNavigation({
      targetUrl: "https://example.com/",
      developmentUrl,
      packagedEntryPath,
    }),
    false,
  );
});
