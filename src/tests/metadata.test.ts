import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import yaml from "js-yaml";

type ActionMetadata = {
  inputs?: Record<string, unknown>;
  runs?: { using?: string; main?: string };
};

type ReleaseWorkflow = {
  on?: { release?: { types?: string[] } };
  jobs?: Record<string, unknown>;
};

test("release and action metadata are valid and aligned with v1", async () => {
  const [actionText, releaseText, packageText, lockText] = await Promise.all([
    readFile("action.yml", "utf8"),
    readFile(".github/workflows/release.yml", "utf8"),
    readFile("package.json", "utf8"),
    readFile("package-lock.json", "utf8"),
  ]);

  const action = yaml.load(actionText) as ActionMetadata;
  const release = yaml.load(releaseText) as ReleaseWorkflow;
  const packageJson = JSON.parse(packageText) as { version?: string };
  const packageLock = JSON.parse(lockText) as {
    version?: string;
    packages?: Record<string, { version?: string }>;
  };

  assert.equal(action.runs?.using, "node20");
  assert.equal(action.runs?.main, "dist/index.js");
  assert.ok(action.inputs?.["pull-number"]);
  assert.deepEqual(release.on?.release?.types, ["published"]);
  assert.ok(release.jobs?.["validate-and-update-major-tag"]);
  assert.match(packageJson.version ?? "", /^\d+\.\d+\.\d+/);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages?.[""]?.version, packageJson.version);
});
