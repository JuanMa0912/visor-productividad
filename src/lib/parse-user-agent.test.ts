import assert from "node:assert/strict";
import test from "node:test";
import { formatUserAgentLabel, parseUserAgent } from "./parse-user-agent";

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FIREFOX_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0";
const EDGE_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";

test("parseUserAgent detects Chrome on Windows", () => {
  const parsed = parseUserAgent(CHROME_WIN);
  assert.equal(parsed?.browser, "Chrome");
  assert.equal(parsed?.browserVersion, "131");
  assert.equal(parsed?.os, "Windows 10/11");
  assert.equal(parsed?.device, "Escritorio");
});

test("parseUserAgent detects Firefox", () => {
  const parsed = parseUserAgent(FIREFOX_WIN);
  assert.equal(parsed?.browser, "Firefox");
  assert.equal(parsed?.browserVersion, "150");
});

test("parseUserAgent detects Edge over Chrome token", () => {
  const parsed = parseUserAgent(EDGE_WIN);
  assert.equal(parsed?.browser, "Edge");
  assert.equal(parsed?.browserVersion, "131");
});

test("parseUserAgent detects iPhone", () => {
  const parsed = parseUserAgent(IPHONE);
  assert.equal(parsed?.browser, "Safari");
  assert.equal(parsed?.device, "Móvil");
  assert.match(parsed?.os ?? "", /iOS/);
});

test("formatUserAgentLabel returns readable string", () => {
  assert.equal(
    formatUserAgentLabel(CHROME_WIN),
    "Chrome 131 · Windows 10/11",
  );
  assert.equal(formatUserAgentLabel(null), "—");
});
