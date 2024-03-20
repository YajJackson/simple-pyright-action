import * as core from "@actions/core";
import * as github from "@actions/github";
import { ExecOptions, exec } from "@actions/exec";
import { Diagnostic, Report, parseReport } from "./types";
import {
    diagnosticToString,
    generateCommentKey,
    getRelativePath,
    parseBaseSummaryCommentKey,
    parseCommentKey,
    parseSummaryCommentKey,
    pluralize,
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

        await installPyright();
        const pyrightReport = await runPyright(pythonFiles);

        if (runInfo.options.includeFileComments)
            await addFileComments(runInfo, pyrightReport, pullRequestData);
        await addSummaryComment(runInfo, pyrightReport, pullRequestData);

        if (runInfo.options.includeBaseComparison)
            await addBaseComparisonComment(pullRequestData);
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
    return { includeFileComments, includeBaseComparison };
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

async function runPyright(files?: string[]): Promise<Report> {
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
    await exec("git", ["fetch", "origin", `${pullRequest.base.ref}`]);
    await exec("git", ["checkout", `${pullRequest.base.ref}`]);
}

async function addBaseComparisonComment(
    pullRequest: Awaited<ReturnType<typeof getPullRequestData>>,
) {
    core.info("Generating base comparison comment.");

    const { octokit, context } = getRunInfo();

    const headReport = await runPyright();
    await checkoutBaseBranch(pullRequest);
    const baseReport = await runPyright();

    const fileDiff =
        headReport.summary.filesAnalyzed - baseReport.summary.filesAnalyzed;
    const warningDiff =
        headReport.summary.warningCount - baseReport.summary.warningCount;
    const errorDiff =
        headReport.summary.errorCount - baseReport.summary.errorCount;
    let comparisonMessage = `## Type Stats\n`;
    comparisonMessage += `| | files | warnings | errors |\n`;
    comparisonMessage += `| --- | :--: | :--: | :--: |\n`;
    comparisonMessage += `| base | ${baseReport.summary.filesAnalyzed} | ${baseReport.summary.warningCount} | ${baseReport.summary.errorCount} |\n`;
    comparisonMessage += `| head | ${headReport.summary.filesAnalyzed} | ${headReport.summary.warningCount} | ${headReport.summary.errorCount} |\n`;
    comparisonMessage += `| result | ${
        fileDiff >= 0 ? "⬆️" : "⬇️"
    } ${fileDiff} | ${warningDiff >= 0 ? "✅" : "❌"} ${warningDiff} | ${
        errorDiff >= 0 ? "✅" : "❌"
    } ${errorDiff} |\n`;

    const baseSummaryKey = generateCommentKey(
        "pyright-base-summary",
        pullRequest.number,
    );
    comparisonMessage += `\n###### [base-summary-key:${baseSummaryKey}]`;

    const { data: existingComments } = await octokit.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pullRequest.number,
    });

    const existingComparisonComment = existingComments.find((comment) => {
        if (!comment.user) return false;
        if (comment.user.login !== "github-actions[bot]") return false;
        if (!comment.body) return false;
        const key = parseBaseSummaryCommentKey(comment.body);
        return key === baseSummaryKey;
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
}

async function addFileComments(
    runInfo: ReturnType<typeof getRunInfo>,
    report: Report,
    pullRequest: Awaited<ReturnType<typeof getPullRequestData>>,
) {
    core.info("Generating file comments.");

    const { octokit, context } = runInfo;

    const diagnostics = report.generalDiagnostics;

    const { data: existingReviewComments } =
        await octokit.rest.pulls.listReviewComments({
            owner: context.repo.owner,
            repo: context.repo.repo,
            pull_number: pullRequest.number,
        });

    type KeyedComments = {
        [key: string]: (typeof existingReviewComments)[0];
    };

    const keyedExistingReviewComments =
        existingReviewComments.reduce<KeyedComments>((acc, comment) => {
            if (comment.user.login !== "github-actions[bot]") return acc;

            const commentKey = parseCommentKey(comment.body);
            core.info(
                `Keying user: ${comment.user.login} comment: ${comment.id} - ${comment.body} | key: ${commentKey}`,
            );
            if (commentKey) {
                acc[commentKey] = comment;
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
    const processedCommentKeys: string[] = [];
    for (const [relativePath, fileDiagnostics] of Object.entries(
        diagnosticsByFile,
    )) {
        let body = "<details>";
        body += `\n<summary>${pluralize(
            fileDiagnostics.length,
            "Issue",
            "Issues",
        )}</summary>\n\n`;
        for (const diagnostic of fileDiagnostics) {
            body += `- ${diagnosticToString(diagnostic, relativePath)}\n`;
        }
        body += "</details>";

        const commentKey = generateCommentKey(relativePath, pullRequest.number);
        body += `\n\n###### [diagnostic-key:${commentKey}]`;
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

    let summary =
        `## Pyright Summary \n` +
        `**📝 Files Analyzed**: ${report.summary.filesAnalyzed}\n`;

    if (report.summary.errorCount > 0)
        summary += `**❌ Errors**: ${report.summary.errorCount}\n`;
    if (report.summary.warningCount > 0)
        summary += `**⚠️ Warnings**: ${report.summary.warningCount}`;
    if (report.summary.errorCount === 0 && report.summary.warningCount === 0)
        summary += `✅ No errors or warnings found.`;

    const summaryKey = generateCommentKey(
        "pyright-summary",
        pullRequest.number,
    );
    summary += `\n\n###### [diagnostic-summary-key:${summaryKey}]`;

    const { data: existingComments } = await octokit.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pullRequest.number,
    });
    const existingSummaryComment = existingComments.find((comment) => {
        if (!comment.user) return false;
        if (comment.user.login !== "github-actions[bot]") return false;
        if (!comment.body) return false;
        const key = parseSummaryCommentKey(comment.body);
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
}
