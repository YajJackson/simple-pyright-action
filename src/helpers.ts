import * as core from "@actions/core";
import { Diagnostic, Position, Range } from "./types";

export const pluralize = (n: number, singular: string, plural: string) => {
    return `${n} ${n === 1 ? singular : plural}`;
};

const isEmptyPosition = (p: Position) => p.line === 0 && p.character === 0;

const isEmptyRange = (r: Range) =>
    isEmptyPosition(r.start) && isEmptyPosition(r.end);

export const diagnosticToString = (diag: Diagnostic): string => {
    let message = "";

    if (diag.file) {
        message += `${diag.file}:`;
    }
    if (diag.range && !isEmptyRange(diag.range)) {
        message += `${diag.range.start.line + 1}:${
            diag.range.start.character + 1
        } -`;
    }
    message += ` ${diag.severity}: `;

    message += diag.message;

    if (diag.rule) {
        message += ` (${diag.rule})`;
    }

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
