import { AnonPlan } from "./model";

export const createDefaultPlan = (): AnonPlan => ({
    task_name: "General Task",
    global_rules: {},
    replacements: [],
    status: "draft"
});
