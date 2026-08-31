import assert from "node:assert/strict";
import test from "node:test";

import {
  isTrustedRereviewActor,
  parseRereviewCommand,
  stripRereviewCommands,
} from "../events.js";

test("parseRereviewCommand accepts exact command lines", () => {
  assert.equal(parseRereviewCommand("/swarm-review"), "review");
  assert.equal(parseRereviewCommand("  /SWARM-REVIEW debate  \nPlease retry."), "debate");

  assert.equal(parseRereviewCommand("please /swarm-review"), undefined);
  assert.equal(parseRereviewCommand("/swarm-reviewer"), undefined);
  assert.equal(parseRereviewCommand("/swarm-review debate now"), undefined);
});

test("stripRereviewCommands removes only command lines", () => {
  assert.equal(
    stripRereviewCommands("/swarm-review debate\nPlease revisit auth.\nMention /swarm-review literally."),
    "Please revisit auth.\nMention /swarm-review literally."
  );
});

test("isTrustedRereviewActor restricts paid runs to trusted humans", () => {
  assert.equal(isTrustedRereviewActor("OWNER", "User"), true);
  assert.equal(isTrustedRereviewActor("member", "User"), true);
  assert.equal(isTrustedRereviewActor("COLLABORATOR", "User"), true);
  assert.equal(isTrustedRereviewActor("CONTRIBUTOR", "User"), false);
  assert.equal(isTrustedRereviewActor("NONE", "User"), false);
  assert.equal(isTrustedRereviewActor("MEMBER", "Bot"), false);
  assert.equal(isTrustedRereviewActor("MEMBER", "bot"), false);
});
