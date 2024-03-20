import * as core from "@actions/core";
import * as github from "@actions/github";
import { ExecOptions, exec } from "@actions/exec";
import { Diagnostic, Report, parseReport } from "./types";
import {
    diagnosticToString,
    generateCommentKey,
    getRelativePath,
} from "./helpers";
import { Octokit } from "octokit";

export async function run() {
    try {
        const runInfo = getRunInfo();
        const pullRequestData = await getPullRequestData(runInfo);
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
        const pyrightReport = await runPyright(pythonFiles);
        await commentOnPR(runInfo, pyrightReport, pullRequestData);
    } catch (error) {
        core.setFailed(`Action failed with error: ${error}`);
    }
}

const getRunInfo = () => {
    const token = core.getInput("github-token", { required: true });
    const octokit = new Octokit({ auth: token });
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
    const { data } = await octokit.rest.pulls.get(requestParams);
    return data;
}

async function installPyright() {
    await exec("npm", ["install", "-g", "pyright"]);
}

async function runPyright(files: string[]): Promise<Report> {
    const pyrightCommand = `pyright --outputjson ${files.join(" ")}`;

    let output = "";
    const options: ExecOptions = {
        listeners: {
            stdout: (data) => {
                output += data.toString();
            },
        },
        ignoreReturnCode: true,
    };

    await exec(pyrightCommand, [], options);
    return parseReport(JSON.parse(output));
}

async function commentOnPR(
    runInfo: ReturnType<typeof getRunInfo>,
    report: Report,
    pullRequest: Awaited<ReturnType<typeof getPullRequestData>>,
) {
    const { octokit, context } = runInfo;

    const diagnostics = report.generalDiagnostics;

    const { data: existingReviewComments } =
        await octokit.rest.pulls.listReviewComments({
            owner: context.repo.owner,
            repo: context.repo.repo,
            pull_number: pullRequest.number, // Make sure you have the PR number correctly here
        });

    type KeyedComments = {
        [key: string]: (typeof existingReviewComments)[0];
    };

    const keyRegex = /\[diagnostic-key:([^]]+)\]/;
    const keyedExistingReviewComments =
        existingReviewComments.reduce<KeyedComments>((acc, comment) => {
            const match = comment.body.match(keyRegex);
            core.info(
                `Keying user: ${comment.user.login} comment: ${comment.id} - ${comment.body} | match: ${match}`,
            );
            if (match) {
                const key = match[1];
                acc[key] = comment;
            }
            return acc;
        }, {});

    // Group diagnostics by relative path
    const diagnosticsByFile: { [key: string]: Diagnostic[] } = {};
    for (const diagnostic of diagnostics) {
        const relativePath = getRelativePath(
            diagnostic.file,
            pullRequest.base.repo.name,
        );

        if (!diagnosticsByFile[relativePath]) {
            diagnosticsByFile[relativePath] = [];
        }

        diagnosticsByFile[relativePath].push(diagnostic);
    }

    // Create a comment for each diagnostic group
    for (const [relativePath, fileDiagnostics] of Object.entries(
        diagnosticsByFile,
    )) {
        let body = `### Pyright Issues\n\n`;
        for (const diagnostic of fileDiagnostics) {
            body += "- " + diagnosticToString(diagnostic, relativePath) + "\n";
        }
        const commentKey = generateCommentKey(relativePath, pullRequest.number);
        body += `\n\n###### [diagnostic-key:${commentKey}]`;

        const existingComment = keyedExistingReviewComments[commentKey];

        if (existingComment) {
            core.info(
                `Updating existing comment for file: ${relativePath} with key: ${commentKey}`,
            );
            await octokit.rest.pulls.updateReviewComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existingComment.id,
                body,
            });
            continue;
        }

        core.info(
            `Creating new comment for file: ${relativePath} with key: ${commentKey}`,
        );
        await octokit.rest.pulls.createReviewComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            pull_number: context.issue.number,
            commit_id: pullRequest.head.sha,
            path: relativePath,
            side: "RIGHT",
            subject_type: "file",
            body,
        });
    }

    core.info("Creating summary comment.");
    let summary =
        `## Pyright Summary \n` +
        `**📝 Files Analyzed**: ${report.summary.filesAnalyzed}\n`;

    if (report.summary.errorCount > 0)
        summary += `**❌ Errors**: ${report.summary.errorCount}\n`;
    if (report.summary.warningCount > 0)
        summary += `**⚠️ Warnings**: ${report.summary.warningCount}`;
    if (report.summary.errorCount === 0 && report.summary.warningCount === 0)
        summary += `✅ No errors or warnings found.`;

    await octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body: summary,
    });
}
