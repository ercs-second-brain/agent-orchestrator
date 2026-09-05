import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_PROJECT_KEY,
  REPLAY_PATH,
  replayDecision,
} from "./design-partner-replay";

const OWN_PROJECT = "phc_marketingProjectKeyThatIsNotTheApp";

describe("design partner replay", () => {
  it("records on the design partner page once the site has its own project", () => {
    expect(
      replayDecision({ key: OWN_PROJECT, pathname: REPLAY_PATH, optedOut: false }),
    ).toEqual({ record: true });
  });

  // Desktop ships no PostHog key. An empty DESKTOP_PROJECT_KEY must not be
  // treated as a configured project (that would block a future marketing key
  // that happened to be blank-padded).
  it("refuses when the desktop project key is unset", () => {
    expect(
      replayDecision({ key: DESKTOP_PROJECT_KEY, pathname: REPLAY_PATH, optedOut: false }),
    ).toEqual({ record: false, reason: "no-key" });
  });

  it("refuses whitespace-padded empty desktop keys as no-key", () => {
    expect(
      replayDecision({ key: `  ${DESKTOP_PROJECT_KEY}  `, pathname: REPLAY_PATH, optedOut: false }),
    ).toEqual({ record: false, reason: "no-key" });
  });

  it("records nowhere else on the site", () => {
    for (const path of ["/", "/download", "/docs/overview", "/design-partner", "/design-partners-old"]) {
      expect(
        replayDecision({ key: OWN_PROJECT, pathname: path, optedOut: false }),
      ).toEqual({ record: false, reason: "wrong-path" });
    }
  });

  it("treats a trailing slash and a sub-path as the same page", () => {
    for (const path of [`${REPLAY_PATH}/`, `${REPLAY_PATH}/apply`]) {
      expect(replayDecision({ key: OWN_PROJECT, pathname: path, optedOut: false })).toEqual({
        record: true,
      });
    }
  });

  // Recording somebody who declined analytics is worse than not recording.
  it("refuses when the visitor has not consented", () => {
    expect(
      replayDecision({ key: OWN_PROJECT, pathname: REPLAY_PATH, optedOut: true }),
    ).toEqual({ record: false, reason: "not-consented" });
  });

  it("refuses when no key is configured at all", () => {
    for (const key of [undefined, "", "   "]) {
      expect(replayDecision({ key, pathname: REPLAY_PATH, optedOut: false })).toEqual({
        record: false,
        reason: "no-key",
      });
    }
  });
});

// Replay containment is a denylist against the desktop project's key, and that
// key is hand-duplicated here because the shared source lives in the desktop
// package, outside this static-export app, so importing it at runtime would drag
// desktop code into the marketing bundle. This test is the drift detector: if
// the desktop key is ever rotated in shared/posthog-config.ts, this fails and
// forces the literal here to be reconciled, rather than replay silently arming
// on the shared project.
it("keeps DESKTOP_PROJECT_KEY in sync with the shared desktop constant", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sharedPath = resolve(here, "../../../../shared/posthog-config.ts");
  const source = readFileSync(sharedPath, "utf8");
  const match = source.match(/DEFAULT_POSTHOG_PROJECT_KEY\s*=\s*"([^"]*)"/);
  expect(match, `could not find DEFAULT_POSTHOG_PROJECT_KEY in ${sharedPath}`).toBeTruthy();
  expect(DESKTOP_PROJECT_KEY).toBe(match![1]);
});
