import * as core from "@actions/core";

export const pluralize = (n: number, singular: string, plural: string) => {
    return `${n} ${n === 1 ? singular : plural}`;
};

export const getRelativePath = (fullPath: string, repo: string) => {
    core.info(`Getting relative path for Full path: ${fullPath} repo: ${repo}`);
    const endOfRepoNameIndex = fullPath.indexOf(repo) + repo.length;
    return fullPath.slice(endOfRepoNameIndex + 1);
};
