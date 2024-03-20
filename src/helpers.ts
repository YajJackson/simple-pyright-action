import * as core from "@actions/core";
import { assert } from "console";

export const pluralize = (n: number, singular: string, plural: string) => {
    return `${n} ${n === 1 ? singular : plural}`;
};

export const getRelativePath = (fullPath: string, repoName: string) => {
    core.info(
        `Getting relative path for Full path: ${fullPath} repo: ${repoName}`,
    );
    // Identify the second occurrence of repoName by starting the search after the first occurrence
    const firstOccurrenceEndIndex =
        fullPath.indexOf(repoName) + repoName.length;
    const secondOccurrenceStartIndex = fullPath.indexOf(
        repoName,
        firstOccurrenceEndIndex,
    );

    if (secondOccurrenceStartIndex === -1) {
        core.error("Repository name not found twice in path");
        return fullPath; // Fallback to returning fullPath or handle error as appropriate
    }

    // Calculate the start index of the relative path, which is after the second occurrence of repoName
    const relativePathStartIndex =
        secondOccurrenceStartIndex + repoName.length + 1; // +1 to move past the trailing slash
    return fullPath.slice(relativePathStartIndex);
};

// const full_path =
//     "/home/runner/work/example-python-project/example-python-project/main.py";
// const repo = "example-python-project";
// const relativePath = getRelativePath(full_path, repo);
// console.log(`Relative path: ${relativePath}`);
// assert(
//     relativePath === "main.py",
//     `Expected "main.py" but got "${relativePath}"`,
// );
