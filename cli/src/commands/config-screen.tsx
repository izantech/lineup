import os from "node:os";

import { Box, Text, render, useApp, useInput, useWindowSize } from "ink";
import React, { useEffect, useState } from "react";

import { writeProjectConfigFile, type LineupConfigFile } from "../lib/config.js";
import type { HostName } from "../lib/constants.js";
import { detectOllamaModels } from "../lib/ollama.js";
import { printTableLine } from "../lib/output.js";
import {
  CONFIG_FIELD_DEFINITIONS,
  CONFIG_SECTION_DEFINITIONS,
  applyFieldValue,
  cycleBooleanValue,
  formatDraftYaml,
  getConfigFieldDefinition,
  getConfigFieldsForSection,
  getDraftValidationErrors,
  getDraftValue,
  humanizeFieldValue,
  type ConfigFieldDefinition,
  type ConfigPaneId,
  type ConfigSectionId,
  type EditableConfigValue
} from "./config-editing.js";
import { createConfigPreviewReport, HOST_ORDER, type ConfigReport } from "./config-report.js";

type TextEditState = {
  kind: "text";
  fieldId: string;
  buffer: string;
};

type SelectEditState = {
  kind: "select";
  fieldId: string;
  optionIndex: number;
};

type EditState = TextEditState | SelectEditState;

type ExitReason = "saved" | "cancelled";

type ScreenSelectOption = {
  label: string;
  value: EditableConfigValue;
  action?: "customText";
};

type LayoutMode = "wide" | "stacked" | "compact";

type OllamaModelDetectionState = {
  status: "idle" | "loading" | "ready" | "error";
  models: string[];
  error?: string;
};

type OllamaModelLoaderInput = {
  draft: LineupConfigFile;
  host: HostName;
  cwd?: string;
  homeDir?: string;
};

type ConfigEditorAppProps = {
  configPath: string;
  initialConfig: LineupConfigFile;
  initialWarnings: string[];
  initialHost: HostName;
  hostNote?: string;
  cwd?: string;
  homeDir?: string;
  onSave: (draft: LineupConfigFile) => void;
  onCancel: () => void;
  loadOllamaModels?: (input: OllamaModelLoaderInput) => Promise<string[]>;
  viewportSize?: {
    columns: number;
    rows?: number;
  };
};

type ConfigEditorScreenInput = {
  configPath: string;
  initialConfig: LineupConfigFile;
  initialWarnings: string[];
  initialHost: HostName;
  hostNote?: string;
  cwd?: string;
  homeDir?: string;
};

type ConfigEditorSessionProps = ConfigEditorScreenInput & {
  onFinish: (result: SessionResult) => void;
};

type SessionResult =
  | {
      reason: "saved";
      path: string;
    }
  | {
      reason: "cancelled";
    };

function createFieldCursorMap(): Record<ConfigSectionId, number> {
  return {
    models: 0,
    agents: 0,
    ollama: 0,
    review: 0
  };
}

function getDirty(initialConfig: LineupConfigFile, draft: LineupConfigFile): boolean {
  return JSON.stringify(initialConfig) !== JSON.stringify(draft);
}

function getLayoutMode(columns: number): LayoutMode {
  if (columns < 110) {
    return "compact";
  }

  if (columns < 155) {
    return "stacked";
  }

  return "wide";
}

function isOllamaField(field: ConfigFieldDefinition): boolean {
  return field.path.startsWith("ollama.");
}

function getUnsetOptionLabel(field: ConfigFieldDefinition): string {
  return isOllamaField(field) ? "Use higher-layer value" : "Inherited";
}

function getDraftValueLabel(field: ConfigFieldDefinition, value: EditableConfigValue): string {
  if (value === undefined) {
    return isOllamaField(field) ? "Unset in project config" : humanizeFieldValue(value);
  }

  return humanizeFieldValue(value);
}

function getSelectableOptions(
  field: ConfigFieldDefinition,
  currentValue: EditableConfigValue,
  detectedOllamaModels: string[]
): ScreenSelectOption[] {
  if (field.kind === "toggle") {
    return [
      { label: getUnsetOptionLabel(field), value: undefined },
      { label: "Enabled", value: true },
      { label: "Disabled", value: false }
    ];
  }

  if (field.id === "ollama.model") {
    const options: ScreenSelectOption[] = [{ label: getUnsetOptionLabel(field), value: undefined }];
    const currentModel = typeof currentValue === "string" ? currentValue.trim() : "";
    if (currentModel && !detectedOllamaModels.includes(currentModel)) {
      options.push({
        label: `Current value (${currentModel})`,
        value: currentModel
      });
    }

    options.push(
      ...detectedOllamaModels.map((model) => ({
        label: model,
        value: model
      }))
    );

    options.push({
      label: "Custom value...",
      value: currentModel,
      action: "customText"
    });

    return options;
  }

  return (field.options ?? []).map((option) => ({
    label: option.value === undefined ? getUnsetOptionLabel(field) : option.label,
    value: option.value
  }));
}

function getOllamaModelNotes(state: OllamaModelDetectionState): Array<{ text: string; color?: "yellow" | "red" }> {
  if (state.status === "loading") {
    return [{ text: "Detecting Ollama models from the current base URL..." }];
  }

  if (state.status === "error") {
    return [{ text: `Model detection failed: ${state.error ?? "unknown error"}`, color: "yellow" }];
  }

  if (state.models.length > 0) {
    return [{ text: `Detected models: ${state.models.join(", ")}` }];
  }

  if (state.status === "ready") {
    return [{ text: "No Ollama models detected. Enter uses manual text input." }];
  }

  return [{ text: "Enable Ollama to detect installed local models." }];
}

async function loadDetectedOllamaModels(input: OllamaModelLoaderInput): Promise<string[]> {
  return detectOllamaModels({
    projectRoot: input.cwd,
    homeDir: input.homeDir,
    host: input.host,
    projectConfig: input.draft
  });
}

function getEffectiveSummary(field: ConfigFieldDefinition | undefined, report: ConfigReport, draft: LineupConfigFile): string[] {
  if (!field) {
    return [
      `resolved_host: ${report.hostResolution.resolved ?? "unresolved"}`,
      `ollama_config: ${report.hostPaths.ollamaConfig.path ?? "n/a"}`,
      `agent_override_dir: ${report.hostPaths.agentOverridesDir.path ?? "n/a"}`
    ];
  }

  if (field.path.startsWith("models.")) {
    const alias = field.path.split(".")[1];
      return [
        `draft: ${getDraftValueLabel(field, getDraftValue(draft, field.path))}`,
        `effective: ${report.modelRouting[alias] ?? "<missing>"}`,
        `source: ${getDraftValue(draft, field.path) === undefined ? "inherited" : "project"}`
      ];
  }

  if (field.path.startsWith("agents.")) {
    const [, agentName, property] = field.path.split(".");
    const agent = report.agents.find((entry) => entry.name === agentName);
    if (!agent) {
      return [
        `draft: ${getDraftValueLabel(field, getDraftValue(draft, field.path))}`,
        "effective: unavailable"
      ];
    }

    if (property === "model") {
      return [
        `draft: ${getDraftValueLabel(field, getDraftValue(draft, field.path))}`,
        `effective alias: ${agent.modelAlias}`,
        `effective target: ${agent.modelTarget}`,
        `source: ${agent.modelSource}`
      ];
    }

    if (property === "memory") {
      return [
        `draft: ${getDraftValueLabel(field, getDraftValue(draft, field.path))}`,
        `effective: ${agent.memory}`,
        `source: ${agent.memorySource}`
      ];
    }

    return [
      `draft: ${getDraftValueLabel(field, getDraftValue(draft, field.path))}`,
      `effective: ${agent.tools}`,
      `source: ${agent.toolsSource}`
    ];
  }

  const ollama = report.ollama;
  if (field.path === "ollama.enabled") {
    return [
      `draft: ${getDraftValueLabel(field, getDraftValue(draft, field.path))}`,
      `effective: ${ollama ? "true" : "false"}`,
      `source: ${getDraftValue(draft, field.path) === undefined ? "inherited" : "project"}`
    ];
  }

  if (!ollama) {
    return [
      `draft: ${getDraftValueLabel(field, getDraftValue(draft, field.path))}`,
      "effective: disabled",
      `source: ${getDraftValue(draft, field.path) === undefined ? "inherited" : "project"}`
    ];
  }

  if (field.path === "ollama.model") {
    return [
      `draft: ${getDraftValueLabel(field, getDraftValue(draft, field.path))}`,
      `effective: ${ollama.model || "<missing>"}`,
      `base_url: ${ollama.baseUrl}`
    ];
  }

  if (field.path === "ollama.scope") {
    return [
      `draft: ${getDraftValueLabel(field, getDraftValue(draft, field.path))}`,
      `effective: ${ollama.scope}`,
      `model: ${ollama.model || "<missing>"}`
    ];
  }

  if (field.path === "ollama.baseUrl") {
    return [
      `draft: ${getDraftValueLabel(field, getDraftValue(draft, field.path))}`,
      `effective: ${ollama.baseUrl}`,
      `model: ${ollama.model || "<missing>"}`
    ];
  }

  if (field.path === "ollama.host_integration.enabled") {
    return [
      `draft: ${getDraftValueLabel(field, getDraftValue(draft, field.path))}`,
      `effective: ${ollama.hostIntegration?.enabled ? "true" : "false"}`,
      `strategy: ${ollama.hostIntegration?.strategy ?? "disabled"}`
    ];
  }

  return [
    `draft: ${getDraftValueLabel(field, getDraftValue(draft, field.path))}`,
    `effective: ${ollama.hostIntegration?.strategy ?? "disabled"}`,
    `enabled: ${ollama.hostIntegration?.enabled ? "true" : "false"}`
  ];
}

function SectionRail(props: { activeSectionId: ConfigSectionId; activePane: ConfigPaneId; width?: number }): React.ReactNode {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} width={props.width}>
      <Text color="cyan">Sections</Text>
      {CONFIG_SECTION_DEFINITIONS.map((section) => {
        const isActive = section.id === props.activeSectionId;
        const isPaneFocused = props.activePane === "nav" && isActive;
        return (
          <Box key={section.id} marginTop={1} flexDirection="column">
            <Text color={isPaneFocused ? "green" : isActive ? "yellow" : undefined}>
              {isActive ? "› " : "  "}
              {section.label}
            </Text>
            {isActive ? <Text dimColor>{section.description}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

function FieldList(props: {
  sectionId: ConfigSectionId;
  activePane: ConfigPaneId;
  draft: LineupConfigFile;
  selectedIndex: number;
  validationErrors: Map<string, string>;
  activeFieldNotes?: Array<{ text: string; color?: "yellow" | "red" }>;
}): React.ReactNode {
  if (props.sectionId === "review") {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1} flexGrow={1}>
        <Text color="cyan">Review</Text>
        <Text dimColor>Use this section to inspect the YAML draft and the resolved preview pane before saving.</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>{formatDraftYaml(props.draft)}</Text>
        </Box>
      </Box>
    );
  }

  const fields = getConfigFieldsForSection(props.sectionId);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} flexGrow={1}>
      <Text color="cyan">Editable Fields</Text>
      {fields.map((field, index) => {
        const isActive = index === props.selectedIndex;
        const value = getDraftValueLabel(field, getDraftValue(props.draft, field.path));
        const error = props.validationErrors.get(field.id);
        return (
          <Box key={field.id} marginTop={1} flexDirection="column">
            <Text color={isActive && props.activePane === "fields" ? "green" : isActive ? "yellow" : undefined}>
              {isActive ? "› " : "  "}
              {field.label}: {value}
            </Text>
            {isActive ? <Text dimColor>{field.description}</Text> : null}
            {isActive
              ? props.activeFieldNotes?.map((note) => (
                <Text key={`${field.id}-${note.text}`} color={note.color} dimColor={!note.color}>
                  {note.text}
                </Text>
              ))
              : null}
            {isActive && error ? <Text color="red">error: {error}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

function PreviewPane(props: {
  report: ConfigReport;
  selectedHost: HostName;
  activePane: ConfigPaneId;
  activeField?: ConfigFieldDefinition;
  draft: LineupConfigFile;
  initialWarnings: string[];
  hostNote?: string;
  width?: number;
  detectedOllamaModels: OllamaModelDetectionState;
}): React.ReactNode {
  const fieldSummary = getEffectiveSummary(props.activeField, props.report, props.draft);
  const warnings = Array.from(new Set([...props.initialWarnings, ...props.report.warnings]));
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} width={props.width} flexGrow={props.width ? 0 : 1}>
      <Text color="cyan">Effective Preview</Text>
      <Box marginTop={1}>
        {HOST_ORDER.map((host) => {
          const isActive = host === props.selectedHost;
          const color = props.activePane === "preview" && isActive ? "green" : isActive ? "yellow" : undefined;
          return (
            <Box key={host} marginRight={1}>
              <Text color={color}>[{host}]</Text>
            </Box>
          );
        })}
      </Box>
      {props.activeField ? (
        <Box marginTop={1} flexDirection="column">
          <Text>field: {props.activeField.label}</Text>
          {fieldSummary.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text>project_config: {props.report.projectConfig.path}</Text>
        <Text>ollama_config: {props.report.hostPaths.ollamaConfig.path ?? "n/a"}</Text>
        <Text>agent_override_dir: {props.report.hostPaths.agentOverridesDir.path ?? "n/a"}</Text>
      </Box>
      {props.hostNote ? (
        <Box marginTop={1}>
          <Text color="yellow">host note: {props.hostNote}</Text>
        </Box>
      ) : null}
      {props.activeField?.id === "ollama.model" ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="cyan">Model Detection</Text>
          {getOllamaModelNotes(props.detectedOllamaModels).map((note) => (
            <Text key={note.text} color={note.color} dimColor={!note.color}>
              {note.text}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text color="cyan">Warnings</Text>
        {warnings.length > 0 ? warnings.map((warning) => <Text key={warning} color="yellow">{warning}</Text>) : <Text dimColor>No warnings.</Text>}
      </Box>
    </Box>
  );
}

function EditOverlay(props: {
  editState: EditState;
  draft: LineupConfigFile;
  detectedOllamaModels: OllamaModelDetectionState;
}): React.ReactNode {
  const editState = props.editState;
  const field = getConfigFieldDefinition(editState.fieldId);
  if (editState.kind === "text") {
    return (
      <Box borderStyle="round" paddingX={1} flexDirection="column">
        <Text color="cyan">Editing {field.label}</Text>
        <Text>{editState.buffer || field.placeholder || ""}</Text>
        <Text dimColor>Enter save, Ctrl+U inherit, Esc cancel</Text>
      </Box>
    );
  }

  const options = getSelectableOptions(field, getDraftValue(props.draft, field.path), props.detectedOllamaModels.models);
  return (
    <Box borderStyle="round" paddingX={1} flexDirection="column">
      <Text color="cyan">Select {field.label}</Text>
      {options.map((option, index) => (
        <Text key={`${field.id}-${option.label}`} color={index === editState.optionIndex ? "green" : undefined}>
          {index === editState.optionIndex ? "› " : "  "}
          {option.label}
        </Text>
      ))}
      <Text dimColor>Enter save, Esc cancel</Text>
    </Box>
  );
}

function ConfigEditorApp(props: ConfigEditorAppProps): React.ReactNode {
  const windowSize = useWindowSize();
  const [draft, setDraft] = useState<LineupConfigFile>(structuredClone(props.initialConfig));
  const [activePane, setActivePane] = useState<ConfigPaneId>("fields");
  const [sectionIndex, setSectionIndex] = useState<number>(0);
  const [fieldCursorBySection, setFieldCursorBySection] = useState<Record<ConfigSectionId, number>>(createFieldCursorMap());
  const [hostIndex, setHostIndex] = useState<number>(Math.max(HOST_ORDER.indexOf(props.initialHost), 0));
  const [editState, setEditState] = useState<EditState | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("Use Tab to move panes and Enter to edit.");
  const [detectedOllamaModels, setDetectedOllamaModels] = useState<OllamaModelDetectionState>({
    status: "idle",
    models: []
  });

  const activeSection = CONFIG_SECTION_DEFINITIONS[sectionIndex]?.id ?? "models";
  const sectionFields = getConfigFieldsForSection(activeSection);
  const selectedFieldIndex = sectionFields.length > 0
    ? Math.min(fieldCursorBySection[activeSection] ?? 0, sectionFields.length - 1)
    : 0;
  const activeField = sectionFields[selectedFieldIndex];
  const dirty = getDirty(props.initialConfig, draft);
  const validationErrors = new Map(getDraftValidationErrors(draft).map((entry) => [entry.fieldId, entry.message]));
  const selectedHost = HOST_ORDER[hostIndex] ?? HOST_ORDER[0];
  const report = createConfigPreviewReport({ host: selectedHost }, draft, props.cwd, props.homeDir);
  const layoutMode = getLayoutMode(props.viewportSize?.columns ?? windowSize.columns);
  const activeFieldNotes = activeField?.id === "ollama.model" ? getOllamaModelNotes(detectedOllamaModels) : [];

  useEffect(() => {
    const loader = props.loadOllamaModels ?? loadDetectedOllamaModels;
    if (!report.ollama) {
      setDetectedOllamaModels({
        status: "idle",
        models: []
      });
      return;
    }

    let cancelled = false;
    setDetectedOllamaModels((current) => ({
      status: "loading",
      models: current.models
    }));

    void loader({
      draft,
      host: selectedHost,
      cwd: props.cwd,
      homeDir: props.homeDir
    }).then((models) => {
      if (cancelled) {
        return;
      }

      setDetectedOllamaModels({
        status: "ready",
        models
      });
    }).catch((error) => {
      if (cancelled) {
        return;
      }

      setDetectedOllamaModels({
        status: "error",
        models: [],
        error: error instanceof Error ? error.message : String(error)
      });
    });

    return () => {
      cancelled = true;
    };
  }, [draft, props.cwd, props.homeDir, props.loadOllamaModels, report.ollama?.baseUrl, selectedHost]);

  function setFieldCursor(nextIndex: number): void {
    setFieldCursorBySection((current) => ({
      ...current,
      [activeSection]: Math.max(nextIndex, 0)
    }));
  }

  function moveSection(offset: number): void {
    setSectionIndex((current) => {
      const nextIndex = Math.min(Math.max(current + offset, 0), CONFIG_SECTION_DEFINITIONS.length - 1);
      return nextIndex;
    });
  }

  function moveField(offset: number): void {
    if (sectionFields.length === 0) {
      return;
    }

    const nextIndex = Math.min(Math.max(selectedFieldIndex + offset, 0), sectionFields.length - 1);
    setFieldCursor(nextIndex);
  }

  function switchHost(offset: number): void {
    setHostIndex((current) => {
      const nextIndex = current + offset;
      if (nextIndex < 0) {
        return 0;
      }
      if (nextIndex >= HOST_ORDER.length) {
        return HOST_ORDER.length - 1;
      }

      return nextIndex;
    });
  }

  function openFieldEditor(field: ConfigFieldDefinition | undefined): void {
    if (!field) {
      return;
    }

    const value = getDraftValue(draft, field.path);
    if (field.kind === "text" && !(field.id === "ollama.model" && detectedOllamaModels.models.length > 0)) {
      setEditState({
        kind: "text",
        fieldId: field.id,
        buffer: typeof value === "string" ? value : ""
      });
      setStatusMessage(`Editing ${field.label}.`);
      return;
    }

    const options = getSelectableOptions(field, value, detectedOllamaModels.models);
    const optionIndex = Math.max(options.findIndex((option) => option.value === value), 0);
    setEditState({
      kind: "select",
      fieldId: field.id,
      optionIndex
    });
    setStatusMessage(`Selecting ${field.label}.`);
  }

  function saveFieldValue(field: ConfigFieldDefinition, rawValue: EditableConfigValue): void {
    try {
      const nextDraft = applyFieldValue(draft, field, rawValue);
      setDraft(nextDraft);
      setEditState(null);
      setStatusMessage(`Updated ${field.label}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }

  useInput((input, key) => {
    if (confirmDiscard) {
      if (key.escape) {
        setConfirmDiscard(false);
        setStatusMessage("Discard cancelled.");
        return;
      }

      if (key.return || input === "q") {
        props.onCancel();
        return;
      }

      return;
    }

    if (editState) {
      if (editState.kind === "text") {
        const field = getConfigFieldDefinition(editState.fieldId);
        if (key.escape) {
          setEditState(null);
          setStatusMessage("Edit cancelled.");
          return;
        }

        if (key.ctrl && input === "u") {
          saveFieldValue(field, undefined);
          return;
        }

        if (key.return) {
          saveFieldValue(field, editState.buffer);
          return;
        }

        if (key.backspace || key.delete) {
          setEditState({
            ...editState,
            buffer: editState.buffer.slice(0, -1)
          });
          return;
        }

        if (!key.ctrl && !key.meta && !key.escape && input) {
          setEditState({
            ...editState,
            buffer: `${editState.buffer}${input}`
          });
        }

        return;
      }

      const field = getConfigFieldDefinition(editState.fieldId);
      const options = getSelectableOptions(field, getDraftValue(draft, field.path), detectedOllamaModels.models);

      if (key.escape) {
        setEditState(null);
        setStatusMessage("Selection cancelled.");
        return;
      }

      if (key.upArrow || input === "k") {
        setEditState({
          ...editState,
          optionIndex: Math.max(editState.optionIndex - 1, 0)
        });
        return;
      }

      if (key.downArrow || input === "j") {
        setEditState({
          ...editState,
          optionIndex: Math.min(editState.optionIndex + 1, options.length - 1)
        });
        return;
      }

      if (key.return || input === " ") {
        const selectedOption = options[editState.optionIndex];
        if (selectedOption?.action === "customText") {
          setEditState({
            kind: "text",
            fieldId: field.id,
            buffer: typeof selectedOption.value === "string" ? selectedOption.value : ""
          });
          setStatusMessage(`Editing ${field.label}.`);
          return;
        }

        saveFieldValue(field, selectedOption?.value);
      }

      return;
    }

    if (input === "s") {
      if (validationErrors.size > 0) {
        setStatusMessage(`Fix ${validationErrors.size} validation error${validationErrors.size === 1 ? "" : "s"} before saving.`);
        return;
      }

      try {
        props.onSave(draft);
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (input === "q") {
      if (dirty) {
        setConfirmDiscard(true);
        setStatusMessage("Unsaved changes. Press Enter or q to discard, Esc to continue editing.");
        return;
      }

      props.onCancel();
      return;
    }

    if (key.escape) {
      setStatusMessage("Ready.");
      return;
    }

    if (key.tab) {
      const panes: ConfigPaneId[] = ["nav", "fields", "preview"];
      const currentIndex = panes.indexOf(activePane);
      setActivePane(panes[(currentIndex + 1) % panes.length] ?? "fields");
      return;
    }

    if ((key.upArrow || input === "k") && activePane === "nav") {
      moveSection(-1);
      return;
    }

    if ((key.downArrow || input === "j") && activePane === "nav") {
      moveSection(1);
      return;
    }

    if ((key.upArrow || input === "k") && activePane === "fields") {
      moveField(-1);
      return;
    }

    if ((key.downArrow || input === "j") && activePane === "fields") {
      moveField(1);
      return;
    }

    if (activePane === "preview" && key.leftArrow) {
      switchHost(-1);
      return;
    }

    if (activePane === "preview" && key.rightArrow) {
      switchHost(1);
      return;
    }

    if (key.return) {
      if (activePane === "nav") {
        setActivePane("fields");
        return;
      }

      if (activePane === "fields") {
        openFieldEditor(activeField);
      }
      return;
    }

    if (input === " " && activePane === "fields" && activeField?.kind === "toggle") {
      saveFieldValue(activeField, cycleBooleanValue(getDraftValue(draft, activeField.path)));
    }
  });

  const editorPane = (
    <Box flexDirection="column" flexGrow={1}>
      <FieldList
        sectionId={activeSection}
        activePane={activePane}
        draft={draft}
        selectedIndex={selectedFieldIndex}
        validationErrors={validationErrors}
        activeFieldNotes={activeFieldNotes}
      />
      {editState ? (
        <Box marginTop={1}>
          <EditOverlay editState={editState} draft={draft} detectedOllamaModels={detectedOllamaModels} />
        </Box>
      ) : null}
      {confirmDiscard ? (
        <Box marginTop={1} borderStyle="round" paddingX={1}>
          <Text color="yellow">Discard unsaved changes? Press Enter or q to discard, Esc to keep editing.</Text>
        </Box>
      ) : null}
    </Box>
  );

  const previewPane = (
    <PreviewPane
      report={report}
      selectedHost={selectedHost}
      activePane={activePane}
      activeField={activeField}
      draft={draft}
      initialWarnings={props.initialWarnings}
      hostNote={props.hostNote}
      width={layoutMode === "wide" ? 38 : undefined}
      detectedOllamaModels={detectedOllamaModels}
    />
  );

  const mainContent = layoutMode === "wide"
    ? (
      <Box marginTop={1}>
        <SectionRail activeSectionId={activeSection} activePane={activePane} width={22} />
        <Box marginLeft={1} flexGrow={1}>
          {editorPane}
        </Box>
        <Box marginLeft={1}>
          {previewPane}
        </Box>
      </Box>
    )
    : layoutMode === "stacked"
      ? (
        <Box marginTop={1}>
          <SectionRail activeSectionId={activeSection} activePane={activePane} width={22} />
          <Box marginLeft={1} flexGrow={1} flexDirection="column">
            {editorPane}
            <Box marginTop={1}>
              {previewPane}
            </Box>
          </Box>
        </Box>
      )
      : (
        <Box marginTop={1} flexDirection="column">
          <SectionRail activeSectionId={activeSection} activePane={activePane} />
          <Box marginTop={1}>
            {editorPane}
          </Box>
          <Box marginTop={1}>
            {previewPane}
          </Box>
        </Box>
      );

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" paddingX={1} justifyContent="space-between">
        <Text color="cyan">Lineup Config Screen</Text>
        <Text>{props.configPath}</Text>
        <Text color={dirty ? "yellow" : "green"}>{dirty ? "dirty" : "clean"}</Text>
      </Box>

      {mainContent}

      <Box marginTop={1} borderStyle="round" paddingX={1} flexDirection="column">
        <Text>Tab pane | ↑/↓ or j/k move | Enter edit | Space toggle | ←/→ switch preview host | s save | q quit | Esc back</Text>
        <Text color={validationErrors.size > 0 ? "yellow" : "green"}>
          {statusMessage}
        </Text>
        <Text dimColor>
          {validationErrors.size > 0 ? `${validationErrors.size} validation error${validationErrors.size === 1 ? "" : "s"} in draft.` : "Draft is valid."}
        </Text>
      </Box>
    </Box>
  );
}

function ConfigEditorSession(props: ConfigEditorSessionProps): React.ReactNode {
  const { exit } = useApp();

  return (
    <ConfigEditorApp
      {...props}
      onSave={(draft) => {
        writeProjectConfigFile(props.configPath, draft);
        props.onFinish({
          reason: "saved",
          path: props.configPath
        });
        exit();
      }}
      onCancel={() => {
        props.onFinish({
          reason: "cancelled"
        });
        exit();
      }}
    />
  );
}

export async function runConfigEditorScreen(input: ConfigEditorScreenInput): Promise<void> {
  let result: SessionResult | null = null;

  const instance = render(<ConfigEditorSession {...input} homeDir={input.homeDir ?? os.homedir()} onFinish={(nextResult) => {
    result = nextResult;
  }} />, {
    alternateScreen: true,
    interactive: true
  });

  await instance.waitUntilExit();
  const finalResult = result as SessionResult | null;
  if (finalResult && finalResult.reason === "saved") {
    printTableLine(`Saved project config: ${finalResult.path}`);
    return;
  }

  printTableLine("Config editor closed without saving.");
}

export { ConfigEditorApp, getLayoutMode };
export type { ConfigEditorAppProps, ConfigEditorScreenInput, ExitReason };
