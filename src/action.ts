import * as core from "@actions/core";
import * as github from "@actions/github";
import { ExecOptions, exec } from "@actions/exec";
import { Diagnostic, Report, parseReport } from "./types";
import {
    formatDiagnostic,
    generateCommentKey,
    getRelativePath,
    findCommentKeyValue,
    pluralize,
    createCommentKey,
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

        if (pythonFiles.length === 0) {
            core.info("No Python files have changed.");
            return;
        }

        const pyrightReport = await runPyright(pythonFiles);

        if (runInfo.options.includeFileComments)
            await addFileComments(runInfo, pyrightReport, pullRequestData);

        if (runInfo.options.includeBaseComparison) {
            await addBaseComparisonComment(runInfo, pullRequestData);
        } else {
            await addSummaryComment(runInfo, pyrightReport, pullRequestData);
        }
    } catch (error) {
        core.setFailed(`Action failed with error: ${error}`);
    }
}

const getRunInfo = () => {
    const token = core.getInput("github-token", { required: true });
    const octokit = new Octokit({ auth: token });
    const context = github.context;
    const options = getOptions();
    return { token, octokit, context, options };
};

const getOptions = () => {
    const includeFileComments =
        core.getBooleanInput("include-file-comments") ?? true;
    const includeBaseComparison =
        core.getBooleanInput("include-base-comparison") ?? false;
    const failOnIssueIncrease =
        core.getBooleanInput("fail-on-issue-increase") ?? false;
    return { includeFileComments, includeBaseComparison, failOnIssueIncrease };
};

async function getChangedPythonFiles(
    runInfo: ReturnType<typeof getRunInfo>,
    pullRequest: Awaited<ReturnType<typeof getPullRequestData>>,
): Promise<string[]> {
    const { octokit, context } = runInfo;

    const { data: compareData } =
        await octokit.rest.repos.compareCommitsWithBasehead({
            owner: context.repo.owner,
            repo: context.repo.repo,
            basehead: `${pullRequest.base.sha}...${pullRequest.head.sha}`,
        });

    if (!compareData.files) return [];

    const pythonFiles =
        compareData.files
            .filter((file) => file.filename?.endsWith(".py"))
            .map((file) => file.filename) || [];

    return pythonFiles;
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

async function runPyright(files?: string[]): Promise<Report> {
    await installPyright();

    let pyrightCommand = `pyright --outputjson`;
    if (files) pyrightCommand += ` ${files.join(" ")}`;

    core.info(`Running Pyright: ${pyrightCommand}`);

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

async function checkoutBaseBranch(
    pullRequest: Awaited<ReturnType<typeof getPullRequestData>>,
) {
    core.info(`Checking out base branch: ${pullRequest.base.ref}`);
    // await exec("git", ["fetch", "origin", `${pullRequest.base.ref}`]);
    await exec("git", ["checkout", `${pullRequest.base.ref}`]);
}

async function addBaseComparisonComment(
    runInfo: ReturnType<typeof getRunInfo>,
    pullRequest: Awaited<ReturnType<typeof getPullRequestData>>,
) {
    core.info("Generating base comparison comment.");

    const { octokit, context } = getRunInfo();

    // Generate pyright reports for the head and base branches
    const headReport = await runPyright();
    await checkoutBaseBranch(pullRequest);
    const baseReport = await runPyright();

    // Format the summary message
    const fileDiff =
        headReport.summary.filesAnalyzed - baseReport.summary.filesAnalyzed;
    const fileDiffIcon = fileDiff == 0 ? "" : fileDiff > 0 ? "⬆️" : "⬇️";
    const warningDiff =
        headReport.summary.warningCount - baseReport.summary.warningCount;
    const warningDiffIcon = warningDiff <= 0 ? "✅" : "❌";
    const errorDiff =
        headReport.summary.errorCount - baseReport.summary.errorCount;
    const errorDiffIcon = errorDiff <= 0 ? "✅" : "❌";
    let comparisonMessage = `## Pyright Summary\n`;
    comparisonMessage += `| | files analyzed | warnings | errors |\n`;
    comparisonMessage += `| --- | :--: | :--: | :--: |\n`;
    comparisonMessage += `| base | ${baseReport.summary.filesAnalyzed} | ${baseReport.summary.warningCount} | ${baseReport.summary.errorCount} |\n`;
    comparisonMessage += `| head | ${headReport.summary.filesAnalyzed} | ${headReport.summary.warningCount} | ${headReport.summary.errorCount} |\n`;
    comparisonMessage += `| diff | ${fileDiffIcon} ${fileDiff} | ${warningDiffIcon} ${warningDiff} | ${errorDiffIcon} ${errorDiff} |\n`;

    const keyPrefix = "base-summary-key";
    const keyValue = `${pullRequest.number}`;
    const baseSummaryKey = generateCommentKey(keyPrefix, keyValue);
    comparisonMessage += `\n###### ${baseSummaryKey}`;

    // Update or create the comment
    const { data: existingComments } = await octokit.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pullRequest.number,
    });

    const existingComparisonComment = existingComments.find((comment) => {
        if (!comment.user) return false;
        if (comment.user.login !== "github-actions[bot]") return false;
        if (!comment.body) return false;
        return comment.body.includes(baseSummaryKey);
    });

    if (existingComparisonComment) {
        core.info(
            `Updating existing base comparison comment with key: ${baseSummaryKey}`,
        );
        await octokit.rest.issues.updateComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            comment_id: existingComparisonComment.id,
            body: comparisonMessage,
        });
        return;
    }

    core.info(
        `Creating new base comparison comment with key: ${baseSummaryKey}`,
    );
    await octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body: comparisonMessage,
    });

    // Fail the action if the option is set
    if (!runInfo.options.failOnIssueIncrease) return;

    if (errorDiff > 0 || warningDiff > 0) {
        core.setFailed(
            `Pyright found ${errorDiff} errors and ${warningDiff} warnings.`,
        );
    }
}

async function addFileComments(
    runInfo: ReturnType<typeof getRunInfo>,
    report: Report,
    pullRequest: Awaited<ReturnType<typeof getPullRequestData>>,
) {
    core.info("Generating file comments.");

    const { octokit, context } = runInfo;

    const { data: existingReviewComments } =
        await octokit.rest.pulls.listReviewComments({
            owner: context.repo.owner,
            repo: context.repo.repo,
            pull_number: pullRequest.number,
        });

    // Find the existing file diagnostic comments
    type KeyedComments = {
        [key: string]: (typeof existingReviewComments)[0];
    };

    const keyPrefix = "file-diagnostic-key";
    const keyedExistingReviewComments: KeyedComments = {};
    for (const comment of existingReviewComments) {
        if (comment.user.login !== "github-actions[bot]") continue;

        const commentKeyValue = findCommentKeyValue(comment.body, keyPrefix);

        if (commentKeyValue) {
            const commentKey = createCommentKey(keyPrefix, commentKeyValue);
            keyedExistingReviewComments[commentKey] = comment;
        }
    }

    // Group diagnostics by relative path
    type KeyedDiagnostics = {
        [key: string]: Diagnostic[];
    };

    const diagnosticsByFile: KeyedDiagnostics = {};
    for (const diagnostic of report.generalDiagnostics) {
        const relativePath = getRelativePath(
            diagnostic.file,
            pullRequest.base.repo.name,
        );

        if (!diagnosticsByFile[relativePath])
            diagnosticsByFile[relativePath] = [];

        diagnosticsByFile[relativePath].push(diagnostic);
    }

    // Create a comment for each diagnostic group
    const processedCommentKeys: string[] = [];
    for (const [relativePath, fileDiagnostics] of Object.entries(
        diagnosticsByFile,
    )) {
        let body = "> [!CAUTION]";
        body += "\n> <details>";
        const issueText = pluralize(fileDiagnostics.length, "Issue", "Issues");
        body += `\n> <summary>${issueText}</summary>`;
        body += "\n>";

        for (const diagnostic of fileDiagnostics)
            body += `\n> - ${formatDiagnostic(diagnostic, relativePath)}`;

        body += "\n> </details>";

        const keyValue = `${pullRequest.number}-${relativePath}`;
        const commentKey = generateCommentKey(keyPrefix, keyValue);
        body += `\n\n###### ${commentKey}`;

        processedCommentKeys.push(commentKey);

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

    // Delete any comments that are no longer needed
    for (const [key, comment] of Object.entries(keyedExistingReviewComments)) {
        if (processedCommentKeys.includes(key)) continue;

        core.info(
            `Deleting comment for file: ${comment.path} with key: ${key}`,
        );
        await octokit.rest.pulls.deleteReviewComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            comment_id: comment.id,
        });
    }
}

async function addSummaryComment(
    runInfo: ReturnType<typeof getRunInfo>,
    report: Report,
    pullRequest: Awaited<ReturnType<typeof getPullRequestData>>,
) {
    core.info("Generating summary.");

    const { octokit, context } = runInfo;

    // Generate the pull request summary message
    let summary =
        `## Pyright Summary \n` +
        `**📝 Files Analyzed**: ${report.summary.filesAnalyzed}\n`;

    if (report.summary.errorCount > 0)
        summary += `**❌ Errors**: ${report.summary.errorCount}\n`;
    if (report.summary.warningCount > 0)
        summary += `**⚠️ Warnings**: ${report.summary.warningCount}`;
    if (report.summary.errorCount === 0 && report.summary.warningCount === 0)
        summary += `✅ No errors or warnings found.`;

    const keyPrefix = "diagnostic-summary-key";
    const keyValue = `${pullRequest.number}`;
    const summaryKey = generateCommentKey(keyPrefix, keyValue);
    summary += `\n\n###### ${summaryKey}`;

    const { data: existingComments } = await octokit.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pullRequest.number,
    });

    // Create or update the comment
    const existingSummaryComment = existingComments.find((comment) => {
        if (!comment.user) return false;
        if (comment.user.login !== "github-actions[bot]") return false;
        if (!comment.body) return false;
        const key = findCommentKeyValue(comment.body, keyPrefix);
        return key === summaryKey;
    });

    if (existingSummaryComment) {
        core.info(`Updating existing summary comment with key: ${summaryKey}`);
        await octokit.rest.issues.updateComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            comment_id: existingSummaryComment.id,
            body: summary,
        });
        return;
    }

    core.info(`Creating new summary comment with key: ${summaryKey}`);
    await octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body: summary,
    });

    // Fail the action if the option is set
    if (!runInfo.options.failOnIssueIncrease) return;

    if (report.summary.errorCount > 0 || report.summary.warningCount > 0) {
        core.setFailed(
            `Pyright found ${report.summary.errorCount} errors and ${report.summary.warningCount} warnings.`,
        );
    }
}
