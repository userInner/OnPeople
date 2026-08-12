import assert from "node:assert/strict";
import test from "node:test";

import {
  isBrowserNavigationPending,
  isExpectedBrowserNavigationCancellation,
  shouldIgnoreBrowserLoadFailure,
} from "./browser-controller.mjs";

test("ignores expected Chromium navigation cancellations like Codex", () => {
  assert.equal(
    shouldIgnoreBrowserLoadFailure({
      errorCode: -3,
      errorDescription: "ERR_ABORTED",
      isMainFrame: true,
    }),
    true,
  );
  assert.equal(
    shouldIgnoreBrowserLoadFailure({
      errorCode: -20,
      errorDescription: "net::ERR_BLOCKED_BY_CLIENT",
      isMainFrame: true,
    }),
    true,
  );
  assert.equal(
    shouldIgnoreBrowserLoadFailure({
      errorCode: -105,
      errorDescription: "ERR_NAME_NOT_RESOLVED",
      isMainFrame: false,
    }),
    true,
  );
});

test("keeps real main-frame failures visible", () => {
  assert.equal(
    shouldIgnoreBrowserLoadFailure({
      errorCode: -105,
      errorDescription: "net::ERR_NAME_NOT_RESOLVED",
      isMainFrame: true,
    }),
    false,
  );
  assert.equal(
    shouldIgnoreBrowserLoadFailure({
      errorCode: -202,
      errorDescription: "ERR_CERT_AUTHORITY_INVALID",
      isMainFrame: true,
    }),
    false,
  );
});

test("recognizes all Electron cancellation messages handled by Codex", () => {
  assert.equal(
    isExpectedBrowserNavigationCancellation(
      new Error("ERR_ABORTED (-3) loading 'https://google.com/'"),
    ),
    true,
  );
  assert.equal(
    isExpectedBrowserNavigationCancellation(
      new Error("Navigation failed with error code -3."),
    ),
    true,
  );
  assert.equal(
    isExpectedBrowserNavigationCancellation(
      new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'https://invalid/'"),
    ),
    false,
  );
});

test("recognizes a competing navigation for bounded retry", () => {
  assert.equal(
    isBrowserNavigationPending(
      new Error("Cannot navigate because navigation is already pending"),
    ),
    true,
  );
  assert.equal(isBrowserNavigationPending(new Error("network offline")), false);
});
