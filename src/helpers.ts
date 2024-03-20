import * as core from "@actions/core";

export const pluralize = (n: number, singular: string, plural: string) => {
    return `${n} ${n === 1 ? singular : plural}`;
};

export const getRelativePath = (fullPath: string, repoName: string) => {
    core.info(`Getting relative path for Full path: ${fullPath} repo: ${repoName}`);
    const endOfRepoNameIndex = fullPath.indexOf(repoName) + repoName.length;
    return fullPath.slice(endOfRepoNameIndex + 1);
};
