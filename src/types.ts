import * as v from "@badrap/valita";

export type Position = v.Infer<typeof Position>;
const Position = v.object({
    line: v.number(),
    character: v.number(),
});

function isEmptyPosition(p: Position) {
    return p.line === 0 && p.character === 0;
}

export type Range = v.Infer<typeof Range>;
const Range = v.object({
    start: Position,
    end: Position,
});

export function isEmptyRange(r: Range) {
    return isEmptyPosition(r.start) && isEmptyPosition(r.end);
}

export type Diagnostic = v.Infer<typeof Diagnostic>;
const Diagnostic = v.object({
    file: v.string(),
    severity: v.union(
        v.literal("error"),
        v.literal("warning"),
        v.literal("information"),
    ),
    message: v.string(),
    rule: v.string().optional(),
    range: Range.optional(),
});

export type Report = v.Infer<typeof Report>;
const Report = v.object({
    generalDiagnostics: v.array(Diagnostic),
    summary: v.object({
        errorCount: v.number(),
        warningCount: v.number(),
        informationCount: v.number(),
    }),
});

export function parseReport(v: unknown): Report {
    return Report.parse(v, { mode: "strip" });
}

// Example pyright output
// {
//     "version": "1.1.354",
//     "time": "1710897648689",
//     "generalDiagnostics": [
//         {
//             "file": "/home/runner/work/example-python-project/example-python-project/main.py",
//             "severity": "error",
//             "message": "Expression of type \"int\" cannot be assigned to declared type \"str\"\n  \"int\" is incompatible with \"str\"",
//             "range": {
//                 "start": {
//                     "line": 9,
//                     "character": 13
//                 },
//                 "end": {
//                     "line": 9,
//                     "character": 21
//                 }
//             },
//             "rule": "reportAssignmentType"
//         }
//     ],
//     "summary": {
//         "filesAnalyzed": 1,
//         "errorCount": 1,
//         "warningCount": 0,
//         "informationCount": 0,
//         "timeInSec": 0.337
//     }
// }
