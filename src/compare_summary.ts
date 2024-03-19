import * as core from "@actions/core";
import * as github from "@actions/github";
import { exec } from "@actions/exec";
import * as fs from "fs";
import * as io from "@actions/io";

// TODO

async function run() {
  try {
    const baseBranchSummary = await getPyrightSummary("base");
    const prBranchSummary = await getPyrightSummary("pr");
    const comparisonResult = compareSummaries(
      baseBranchSummary,
      prBranchSummary,
    );
    await postComparisonResult(comparisonResult);
  } catch (error) {
    core.setFailed(`Action failed with error: ${error}`);
  }
}

async function getPyrightSummary(branchType: "base" | "pr"): Promise<any> {
  const context = github.context;
  const ref =
    branchType === "base"
      ? context.payload.pull_request?.base.ref
      : context.payload.pull_request?.head.ref;

  // Ensure repository is checked out at the correct ref
  await io.rmRF(".git/index.lock"); // Remove any existing git locks
  await exec("git", ["fetch", "origin", `${ref}:${ref}`]);
  await exec("git", ["checkout", ref]);

  const output = "pyright_summary.json";
  await exec(`pyright --outputjson > ${output}`);

  const summary = JSON.parse(fs.readFileSync(output, "utf8")).summary;
  fs.unlinkSync(output);
  return summary;
}

function compareSummaries(baseSummary: any, prSummary: any): string {
  const errorDiff = prSummary.errorCount - baseSummary.errorCount;
  const warningDiff = prSummary.warningCount - baseSummary.warningCount;

  let message =
    `## Pyright Summary Comparison\n` +
    `**Base Branch**: Errors: ${baseSummary.errorCount}, Warnings: ${baseSummary.warningCount}\n` +
    `**PR Branch**: Errors: ${prSummary.errorCount}, Warnings: ${prSummary.warningCount}\n\n` +
    `**Difference**: Errors: ${
      errorDiff >= 0 ? "+" : ""
    }${errorDiff}, Warnings: ${warningDiff >= 0 ? "+" : ""}${warningDiff}`;

  return message;
}

async function postComparisonResult(result: string) {
  const token = core.getInput("github-token", { required: true });
  const octokit = github.getOctokit(token);
  const context = github.context;

  await octokit.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.issue.number,
    body: result,
  });
}

run();
