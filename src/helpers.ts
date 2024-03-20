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

export const formatDiagnostic = (
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

export const createCommentKey = (prefix: string, value: string) =>
    `${prefix}:${value}`;

export const generateCommentKey = (prefix: string, value: string) => {
    const hash = createHash("sha256");
    hash.update(value);
    const v = hash.digest("hex").substring(0, 16);
    return `[${prefix}:${v}]`;
};

export const findCommentKeyValue = (input: string, keyPrefix: string) => {
    const regex = new RegExp(`\\[${keyPrefix}:([^\\]]+)\\]`);
    const match = regex.exec(input);
    return match ? match[1] : null;
};
