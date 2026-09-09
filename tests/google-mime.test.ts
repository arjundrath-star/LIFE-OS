import test from "node:test";
import assert from "node:assert/strict";
import { decodeGmailBody } from "@/lib/sources/google";

const part = (mimeType: string, text: string) => ({ mimeType, body: { data: Buffer.from(text).toString("base64url") } });
const alternative = (plain: string, html: string) => ({ mimeType: "multipart/alternative", parts: [part("text/plain", plain), part("text/html", html)] });

test("recovers deadline and status when the plain alternative contains only training boilerplate", () => {
  const actual = decodeGmailBody(alternative("Your mandatory training plan:\r\n", `
    <p>Your mandatory training plan:</p>
    <table><tr><th>Course</th><th>Due Date</th><th>Status</th></tr>
    <tr><td>AlcoholEdu</td><td>Aug 30, 2026</td><td>Not Started</td></tr></table>`));
  assert.ok(actual.startsWith("Your mandatory training plan:\r\n"));
  assert.match(actual, /AlcoholEdu\s+Aug 30, 2026\s+Not Started/);
  assert.match(actual, /HTML/);
  assert.equal(actual.match(/Your mandatory training plan:/g)?.length, 1);
});

test("keeps complete plain text byte-for-byte when HTML carries the same content", () => {
  const plain = "Hi Sam,\r\n\r\nSubmit before September 15.\r\nA & B\r\n";
  assert.equal(decodeGmailBody(alternative(plain, "<p>Hi Sam,</p><p>Submit before <b>September 15.</b></p><div>A &amp; B</div>")), plain);
});

test("deduplicates repeated desktop and mobile HTML status blocks", () => {
  const actual = decodeGmailBody(alternative("Training plan", "<p>Training plan</p><div>Due Aug 30: Not Started</div><div>Due Aug 30: Not Started</div>"));
  assert.equal(actual.match(/Due Aug 30: Not Started/g)?.length, 1);
});

test("retains differing MIME facts with provenance instead of guessing which date is right", () => {
  const actual = decodeGmailBody(alternative("Due September 15", "<p>Due September 16</p>"));
  assert.match(actual, /^Due September 15/);
  assert.match(actual, /HTML[\s\S]*Due September 16/);
  assert.match(decodeGmailBody(alternative("Due September 15", "<p>Due September 1</p>")), /HTML[\s\S]*Due September 1$/);
  assert.match(decodeGmailBody(alternative("Not Started", "<p>Started</p>")), /HTML[\s\S]*Started$/);
});

test("equivalent wrapped plain paragraphs remain unchanged", () => {
  const plain = "Please complete the training\r\nbefore September 15.\r\n\r\nThank you!";
  assert.equal(decodeGmailBody(alternative(plain, "<p>Please complete the training before September 15.</p><p>Thank you!</p>")), plain);
});

test("keeps independent inline multipart bodies and ignores text, HTML and forwarded-message attachments", () => {
  const actual = decodeGmailBody({ mimeType: "multipart/mixed", parts: [
    alternative("See your plan.", "<p>See your plan.</p>"),
    { mimeType: "multipart/related", parts: [part("text/html", "<p>Deadline September 15</p>"), { filename: "logo.png", ...part("image/png", "image attachment") }] },
    { filename: "old-plan.txt", ...part("text/plain", "Old attachment deadline September 1") },
    { headers: [{ name: "Content-Disposition", value: 'attachment; filename="old.html"' }], ...part("text/html", "<p>Old HTML September 2</p>") },
    { mimeType: "message/rfc822", parts: [part("text/plain", "Attached email September 3")] },
  ] });
  assert.match(actual, /See your plan/);
  assert.match(actual, /Deadline September 15/);
  assert.doesNotMatch(actual, /Old|Attached email|image attachment/);
});

test("decodes HTML-only entities and table boundaries without script/style/head/comment content", () => {
  const actual = decodeGmailBody(part("text/html", '<head><title>Boilerplate</title></head><style>.hidden { display: none }</style><script>fetch("remote")</script><!-- ignored --><table><tr><td>A &amp; B</td><td>Sep&nbsp;15</td></tr></table><p>&quot;Ready&quot; &#x1F600; &#39;yes&#39;</p>'));
  assert.match(actual, /A & B\s+Sep 15/);
  assert.match(actual, /"Ready" 😀 'yes'/);
  assert.doesNotMatch(actual, /Boilerplate|hidden|fetch|remote|ignored/);
});

test("invalid numeric entities do not throw or hide valid content", () => {
  assert.equal(decodeGmailBody(part("text/html", "&#1114112;&#99999999999999999999999999;&#65;&#128512;")), "A😀");
});

test("empty plain alternative does not hide HTML and attachment-only mail has no body", () => {
  assert.match(decodeGmailBody(alternative(" \r\n", "<p>Action required</p>")), /Action required/);
  assert.equal(decodeGmailBody({ filename: "notes.txt", ...part("text/plain", "not the body") }), "");
});
