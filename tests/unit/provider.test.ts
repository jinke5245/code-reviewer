import { describe, expect, it } from "vitest";

import { resolveReviewProviderName } from "../../src/platform/provider.js";

describe("resolveReviewProviderName", () => {
  it("uses explicit provider configuration", () => {
    expect(
      resolveReviewProviderName({
        config: { provider: "github" },
        env: {},
      }),
    ).toBe("github");
  });

  it("detects GitHub Actions pull request environments", () => {
    expect(
      resolveReviewProviderName({
        config: { provider: "auto" },
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_PATH: "/tmp/event.json",
        },
      }),
    ).toBe("github");
  });

  it("does not detect GitHub from non-pull-request Actions events", () => {
    expect(() =>
      resolveReviewProviderName({
        config: { provider: "auto" },
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "push",
          GITHUB_EVENT_PATH: "/tmp/event.json",
        },
      }),
    ).toThrow(/Cannot detect review provider/);
  });

  it("detects GitLab merge request CI environments", () => {
    expect(
      resolveReviewProviderName({
        config: { provider: "auto" },
        env: {
          CI_API_V4_URL: "https://gitlab.example.test/api/v4",
          CI_PROJECT_ID: "123",
          CI_MERGE_REQUEST_IID: "42",
        },
      }),
    ).toBe("gitlab");
  });

  it("does not detect GitLab from token presence without merge request CI", () => {
    expect(() =>
      resolveReviewProviderName({
        config: { provider: "auto" },
        env: {
          GITLAB_TOKEN: "secret-token",
        },
      }),
    ).toThrow(/Cannot detect review provider/);
  });

  it("rejects ambiguous auto-detection", () => {
    expect(() =>
      resolveReviewProviderName({
        config: { provider: "auto" },
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_PATH: "/tmp/event.json",
          CI_API_V4_URL: "https://gitlab.example.test/api/v4",
          CI_PROJECT_ID: "123",
          CI_MERGE_REQUEST_IID: "42",
        },
      }),
    ).toThrow(/Both GitHub and GitLab review environments were detected/);
  });

  it("reports missing provider context clearly", () => {
    expect(() =>
      resolveReviewProviderName({
        config: { provider: "auto" },
        env: {},
      }),
    ).toThrow(/Cannot detect review provider/);
  });
});
