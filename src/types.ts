import * as v from "@badrap/valita";

export type Position = v.Infer<typeof Position>;
const Position = v.object({
    line: v.number(),
    character: v.number(),
});

export type Range = v.Infer<typeof Range>;
const Range = v.object({
    start: Position,
    end: Position,
});

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
        filesAnalyzed: v.number(),
    }),
});

export const parseReport = (v: unknown): Report =>
    Report.parse(v, { mode: "strip" });
