import { AnonPlan } from "./model";

export const createDefaultPlan = (): AnonPlan => ({
    taskName: "General Task",
    globalRules: {},
    replacements: [],
    status: "draft"
});
