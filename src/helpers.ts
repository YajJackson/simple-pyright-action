import { createHash } from "crypto";
import { Diagnostic, Position, Range } from "./types";

export const pluralize = (n: number, singular: string, plural: string) => {
    return `${n} ${n === 1 ? singular : plural}`;
};

const isEmptyPosition = (p: Position) => p.line === 0 && p.character === 0;

const isEmptyRange = (r: Range) =>
    isEmptyPosition(r.start) && isEmptyPosition(r.end);

const getSeverityIcon = (severity: string) => {
    switch (severity) {
        case "error":
            return "❌";
        case "warning":
            return "⚠️";
        default:
            return "";
    }
};

export const diagnosticToString = (
    diag: Diagnostic,
    fileName: string,
): string => {
    let message = `${fileName}:`;

    if (diag.range && !isEmptyRange(diag.range))
        message += `${diag.range.start.line + 1}:${
            diag.range.start.character + 1
        } -`;

    message += ` ${getSeverityIcon(diag.severity)} ${diag.severity}: `;

    message += diag.message.replace(/"/g, "`");

    if (diag.rule) message += ` (${diag.rule})`;

    return message;
};

export const getRelativePath = (file: string, repoName: string) => {
    const firstOccurrenceEndIndex = file.indexOf(repoName) + repoName.length;
    const secondOccurrenceStartIndex = file.indexOf(
        repoName,
        firstOccurrenceEndIndex,
    );

    if (secondOccurrenceStartIndex === -1) {
        return file;
    }

    return file.slice(secondOccurrenceStartIndex + repoName.length + 1);
};

export const generateCommentKey = (
    filePath: string,
    pullRequestNumber: number,
) => {
    const hash = createHash("sha256");
    hash.update(`${filePath}-${pullRequestNumber}`);
    return hash.digest("hex").substring(0, 16);
};

export const parseCommentKey = (input: string) => {
    const regex = /\[diagnostic-key:([^\]]+)\]/;
    const match = regex.exec(input);
    return match ? match[1] : null;
};

export const parseSummaryCommentKey = (input: string) => {
    const regex = /\[diagnostic-summparseCommentKey ary-key:([^\]]+)\]/;
    const match = regex.exec(input);
    return match ? match[1] : null;
};

// const exampleCommentBody = `### Pyright Issues
//
// - main.py:10:14 - ❌ error: Expression of type \`int\` cannot be assigned to declared type \`str\`
//   \`int\` is incompatible with \`str\` (reportAssignmentType)
// - main.py:11:24 - ❌ error: Expression of type \`int\` cannot be assigned to declared type \`str\`
//   \`int\` is incompatible with \`str\` (reportAssignmentType)
//
//
// ###### [diagnostic-key:89be8cb1cee8ef6a]`;
//
// const commentKey = parseCommentKey(exampleCommentBody);
// console.log({ commentKey });
