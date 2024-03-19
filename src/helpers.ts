import { type Diagnostic, isEmptyRange } from "./schema";

export const pluralize = (n: number, singular: string, plural: string) => {
    return `${n} ${n === 1 ? singular : plural}`;
};

export const diagnosticToString = (
    diag: Diagnostic,
    forCommand: boolean,
): string => {
    let message = "";

    if (!forCommand) {
        if (diag.file) {
            message += `${diag.file}:`;
        }
        if (diag.range && !isEmptyRange(diag.range)) {
            message += `${diag.range.start.line + 1}:${
                diag.range.start.character + 1
            } -`;
        }
        message += ` ${diag.severity}: `;
    }

    message += diag.message;

    if (diag.rule) {
        message += ` (${diag.rule})`;
    }

    return message;
};

export const getRelativePath = (fullPath: string, repo: string) => {
    const endOfRepoNameIndex = fullPath.indexOf(repo) + repo.length;
    return fullPath.slice(endOfRepoNameIndex + 1);
};
