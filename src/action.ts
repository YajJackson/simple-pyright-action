import * as core from "@actions/core";
import * as github from "@actions/github";
import { exec } from "@actions/exec";
import * as cp from "node:child_process";
import * as fs from "fs";
import { Report, parseReport } from "./schema";
import { getRelativePath } from "./helpers";
import { Octokit } from "octokit";

export async function run() {
    try {
        core.info("Starting Pyright Action");
        const runInfo = getRunInfo();
        core.info("runInfo: " + JSON.stringify(runInfo));
        const pullRequestData = await getPullRequestData(runInfo);
        core.info("pullRequestData: " + JSON.stringify(pullRequestData));
        const pythonFiles = await getChangedPythonFiles(
            runInfo,
            pullRequestData,
        );
        core.info("pythonFiles: " + JSON.stringify(pythonFiles));
        if (pythonFiles.length === 0) {
            core.info("No Python files have changed.");
            return;
        }

        await installPyright();
        let pyrightReport: Report;
        try {
            pyrightReport = await runPyright(pythonFiles);
        } catch {
            core.info("Pyright failed, trying alternate method")
            pyrightReport = await runPyrightAlternate(pythonFiles);
        }
        await commentOnPR(runInfo, pyrightReport, pullRequestData);
    } catch (error) {
        core.setFailed(`Action failed with error: ${error}`);
    }
}

const getRunInfo = () => {
    const token = core.getInput("github-token", { required: true });
    const octokit = new Octokit({ auth: token });
    core.info("Initialized octokit");
    const context = github.context;
    return { token, octokit, context };
};

async function getChangedPythonFiles(
    runInfo: ReturnType<typeof getRunInfo>,
    pullRequest: Awaited<ReturnType<typeof getPullRequestData>>,
): Promise<string[]> {
    const { octokit, context } = runInfo;

    const compareData = await octokit.rest.repos.compareCommitsWithBasehead({
        owner: context.repo.owner,
        repo: context.repo.repo,
        basehead: `${pullRequest.base.sha}...${pullRequest.head.sha}`,
    });

    return (
        compareData.data.files
            ?.filter((file) => file.filename?.endsWith(".py"))
            .map((file) => file.filename) || []
    );
}

async function getPullRequestData(runInfo: ReturnType<typeof getRunInfo>) {
    const { octokit, context } = runInfo;

    const requestParams = {
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: context.issue.number,
    };
    core.info("requestParams: " + JSON.stringify(requestParams));

    const { data: pullRequestData } =
        await octokit.rest.pulls.get(requestParams);
    return pullRequestData;
}

async function installPyright() {
    await exec("npm", ["install", "-g", "pyright"]);
}

async function runPyright(files: string[]): Promise<Report> {
    const pyrightOutput = "pyright_output.json";
    await exec(`pyright --outputjson ${files.join(" ")} > ${pyrightOutput}`);
    core.info("Wrote Pyright results to: " + pyrightOutput);
    const output = fs.readFileSync(pyrightOutput, "utf8");
    core.info("Pyright output: " + output);
    // fs.unlinkSync(pyrightOutput);
    return parseReport(JSON.parse(output));
}

async function runPyrightAlternate(files: string[]): Promise<Report> {
    const pyrightArgs = ["npx", "pyright", "--outputjson", ...files];
    const { status, stdout } = cp.spawnSync(process.execPath, pyrightArgs, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
        maxBuffer: 100 * 1024 * 1024,
    });

    if (!stdout.trim()) {
        core.setFailed(`Exit code ${status!}`);
        throw "pyright failed";
    }

    const report = parseReport(JSON.parse(stdout));
    return report;
}

async function commentOnPR(
    runInfo: ReturnType<typeof getRunInfo>,
    report: Report,
    pullRequest: Awaited<ReturnType<typeof getPullRequestData>>,
) {
    const diagnostics = report.generalDiagnostics;
    if (diagnostics.length === 0) {
        core.info("No issues found by Pyright.");
        return;
    }

    const { octokit, context } = runInfo;

    for (const diagnostic of diagnostics) {
        if (diagnostic.range === undefined) continue;

        // Create comment on PR at specific line
        // These are considered "review comments" and are shown as annotations in the PR
        // See: https://docs.github.com/en/rest/pulls/comments?apiVersion=2022-11-28#create-a-review-comment-for-a-pull-request
        const body =
            `**Pyright Warning/Error**\n` + `Message: ${diagnostic.message}`;

        await octokit.rest.pulls.createReviewComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            pull_number: context.issue.number,
            body,
            commit_id: pullRequest.head.sha,
            path: getRelativePath(
                diagnostic.file,
                pullRequest.base.repo.full_name,
            ),
        });
    }

    // Create a comment on the PR with a summary of the issues
    const summary =
        `## Pyright Summary \n` +
        `**Errors**: ${report.summary.errorCount}\n` +
        `**Warnings**: ${report.summary.warningCount}`;
    await octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body: summary,
    });
}
