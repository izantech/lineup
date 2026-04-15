import type {
  AgentRole,
  LineupApiVersion,
  StageInput,
  StageType,
  WorkflowDefinition,
  WorkflowStage,
  WorkflowVariable
} from "./types.js";

export type TacticStage = {
  type?: string;
  agent?: string;
  tactic?: string;
  prompt?: string;
  optional?: boolean;
  gate?: string | null;
};

export type TacticVariable = {
  name: string;
  description?: string;
  default?: string;
};

export type TacticDefinition = {
  name: string;
  description?: string;
  stages: TacticStage[];
  verification?: string[];
  variables?: TacticVariable[];
};

const TACTIC_TYPE_MAP: Record<string, { type: StageType; agent?: AgentRole; id: string }> = {
  clarify: { type: "builtin", id: "clarify" },
  research: { type: "agent", agent: "researcher", id: "research" },
  "clarification-gate": { type: "builtin", id: "gate" },
  plan: { type: "agent", agent: "architect", id: "plan" },
  implement: { type: "agent", agent: "developer", id: "implement" },
  verify: { type: "agent", agent: "reviewer", id: "verify" },
  document: { type: "agent", agent: "documenter", id: "document" },
  explain: { type: "agent", agent: "teacher", id: "explain" },
};

const DEFAULT_STAGE_OUTPUT_FIELDS: Partial<Record<StageType, string[]>> = {
  reasoning: ["requirements", "resolved_requirements"],
  agent: []
};

function defaultOutputFieldsForTacticStage(stage: TacticStage): string[] {
  if (stage.type === "research") {
    return ["what_found", "how_it_works", "constraints", "gaps"];
  }
  if (stage.type === "clarify") {
    return ["requirements"];
  }
  if (stage.type === "clarification-gate") {
    return ["resolved_requirements"];
  }
  if (stage.type === "plan") {
    return ["summary", "approaches", "changes", "parallelization_strategy", "acceptance_criteria"];
  }
  if (stage.type === "verify") {
    return ["status", "summary", "findings"];
  }
  if (stage.type === "explain") {
    return ["learning_objectives", "prerequisites", "explanation", "further_exploration"];
  }

  return mappingOutputFields(stage.type);
}

function mappingOutputFields(stageType: string | undefined): string[] {
  if (!stageType) {
    return [];
  }

  const mapping = TACTIC_TYPE_MAP[stageType];
  if (!mapping) {
    return [];
  }

  return DEFAULT_STAGE_OUTPUT_FIELDS[mapping.type] ?? [];
}

function uniqueId(base: string, usedIds: Set<string>): string {
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  let counter = 2;
  while (usedIds.has(`${base}-${counter}`)) {
    counter++;
  }
  const id = `${base}-${counter}`;
  usedIds.add(id);
  return id;
}

export function tacticToWorkflow(tactic: TacticDefinition): WorkflowDefinition {
  const usedIds = new Set<string>();
  const workflowStages: WorkflowStage[] = [];
  let previousId: string | null = null;
  let previousOutputSource: StageInput | null = null;

  for (const tacticStage of tactic.stages) {
    if (!tacticStage.type) {
      // Skip tactic-reference stages (composition) — not supported in direct conversion
      continue;
    }

    const mapping = TACTIC_TYPE_MAP[tacticStage.type];
    if (!mapping) {
      throw new Error(`Unknown tactic stage type: ${tacticStage.type}`);
    }

    const stageId = uniqueId(mapping.id, usedIds);
    const agent = (tacticStage.agent as AgentRole | undefined) ?? mapping.agent;
    const inferredInputs = previousOutputSource ? [previousOutputSource] : undefined;

    const stage: WorkflowStage = {
      id: stageId,
      type: mapping.type,
      ...(agent ? { agent } : {}),
      depends_on: previousId ? [previousId] : [],
      ...(inferredInputs ? { inputs: inferredInputs } : {}),
      ...(tacticStage.optional ? { optional: true } : {}),
      ...(tacticStage.prompt ? { description: tacticStage.prompt.trim() } : {}),
    };

    workflowStages.push(stage);
    previousId = stageId;
    const outputFields = defaultOutputFieldsForTacticStage(tacticStage);
    previousOutputSource = outputFields.length > 0 ? { source: stageId, fields: outputFields } : null;

    // Insert approval gate after this stage if requested
    if (tacticStage.gate === "approval") {
      const approvalId = uniqueId(`${stageId}-approval`, usedIds);
      workflowStages.push({
        id: approvalId,
        type: "approval",
        depends_on: [stageId],
      });
      previousId = approvalId;
    }
  }

  // Append verify stage if tactic has verification criteria but no verify stage
  const hasVerifyStage = workflowStages.some((s) => s.id.startsWith("verify"));
  if (tactic.verification && tactic.verification.length > 0 && !hasVerifyStage) {
    const verifyId = uniqueId("verify", usedIds);
    workflowStages.push({
      id: verifyId,
      type: "agent",
      agent: "reviewer",
      depends_on: previousId ? [previousId] : [],
      description: `Verify: ${tactic.verification.join("; ")}`,
    });
  }

  // Convert variables
  const variables: WorkflowVariable[] | undefined = tactic.variables?.map((v) => ({
    name: v.name,
    description: v.description,
    type: "string" as const,
    ...(v.default !== undefined ? { default: v.default } : { required: true }),
  }));

  return {
    apiVersion: "lineup/v3" as LineupApiVersion,
    kind: "Workflow",
    name: tactic.name,
    description: tactic.description,
    ...(variables && variables.length > 0 ? { variables } : {}),
    stages: workflowStages,
  };
}
