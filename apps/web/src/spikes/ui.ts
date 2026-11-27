/**
 * DOM-only (zero `innerHTML`, zero `srcdoc`) operator UI for `/apps/web/spike.html` (`07` §1.1 rule 6).
 */

import {
  formatSpikeJsonExport,
  formatSpikeSuiteMarkdown,
} from "./export.js";
import {
  SPIKE_REGISTRY,
  listSpikesByCategory,
  runSpike,
  runSpikeSuite,
} from "./registry.js";
import { createSpikeRuntimeContext } from "./runtime.js";
import type {
  Phase0SpikeId,
  SpikeCategory,
  SpikeManualInputs,
  SpikeRunRecord,
} from "./types.js";

function clearAndAppendText(el: HTMLElement, text: string): void {
  el.textContent = text;
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

export function mountSpikeHarnessUi(root: HTMLElement): void {
  const ctx = createSpikeRuntimeContext({ executionMode: "LIVE_BROWSER" });
  const resultsById = new Map<Phase0SpikeId, SpikeRunRecord>();

  const header = document.createElement("header");
  const h1 = document.createElement("h1");
  h1.textContent = "Toulmin Phase 0 Compatibility & Backend Spike Harness";
  const subtitle = document.createElement("p");
  subtitle.textContent =
    "Non-production verification console (07 §1.1–§1.7). Never deployed to production Hosting.";
  header.append(h1, subtitle);

  // Environment summary panel
  const envPanel = document.createElement("section");
  envPanel.className = "spike-panel";
  const envTitle = document.createElement("h2");
  envTitle.textContent = "Browser & Firebase Environment Readiness";
  const envPre = document.createElement("pre");
  envPre.textContent = "Inspecting environment...";
  const refreshEnvBtn = makeButton("Refresh Environment Check", () => {
    void refreshEnv();
  });
  envPanel.append(envTitle, refreshEnvBtn, envPre);

  const refreshEnv = async () => {
    const meta = await ctx.inspectEnvironment();
    clearAndAppendText(envPre, JSON.stringify(meta, null, 2));
  };

  // Manual inputs panel
  const inputsPanel = document.createElement("section");
  inputsPanel.className = "spike-panel";
  const inputsTitle = document.createElement("h2");
  inputsTitle.textContent = "Operator Inputs (Manual / S-N4 / Optional Overrides)";
  const fieldRow = document.createElement("div");
  fieldRow.className = "spike-field-row";

  const makeInputField = (labelText: string, placeholder: string) => {
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    label.appendChild(input);
    return { label, input };
  };

  const modelInput = makeInputField("S-N4 Internals Model Name", "e.g. OptimizationGuideOnDeviceModel");
  const verInput = makeInputField("S-N4 Component Version", "e.g. 2026.11.1");
  const maxIterInput = makeInputField("Max Iterations (optional)", "default per spike");
  const downloadChkLabel = document.createElement("label");
  downloadChkLabel.textContent = "Trigger S-W1 Model Download Gesture";
  const downloadChk = document.createElement("input");
  downloadChk.type = "checkbox";
  downloadChkLabel.appendChild(downloadChk);

  fieldRow.append(modelInput.label, verInput.label, maxIterInput.label, downloadChkLabel);
  inputsPanel.append(inputsTitle, fieldRow);

  // Grounding iframe preview slot (for S-W6 Blob-URL iframe verification)
  const previewPanel = document.createElement("section");
  previewPanel.className = "spike-panel";
  const previewTitle = document.createElement("h2");
  previewTitle.textContent = "S-W6 Grounding Blob-URL Iframe Preview Slot";
  const previewSlot = document.createElement("div");
  previewSlot.textContent = "Run S-W6 to render and inspect a live Blob-URL sandboxed iframe.";
  previewPanel.append(previewTitle, previewSlot);
  let disposeLastGroundingPreview: (() => void) | null = null;
  const registerGroundingDispose = (dispose: () => void): void => {
    disposeLastGroundingPreview?.();
    disposeLastGroundingPreview = dispose;
  };

  // Results & export panel
  const outputPanel = document.createElement("section");
  outputPanel.className = "spike-panel";
  const outputTitle = document.createElement("h2");
  outputTitle.textContent = "Recorded Results & Export";
  const exportControls = document.createElement("div");
  exportControls.className = "spike-controls";
  const resultsList = document.createElement("div");
  const exportPreview = document.createElement("pre");
  exportPreview.textContent = "No spike results recorded yet.";

  const renderResults = () => {
    const records = Array.from(resultsById.values());
    const cards: HTMLElement[] = [];
    for (const r of records) {
      const card = document.createElement("div");
      card.className = "spike-result-card";
      const heading = document.createElement("strong");
      heading.textContent = `[${r.status}] ${r.spikeId} (${r.flagName} = ${String(r.primaryRecommended)})`;
      const summary = document.createElement("p");
      summary.textContent = r.summary;
      card.append(heading, summary);
      cards.push(card);
    }
    resultsList.replaceChildren(...cards);
    clearAndAppendText(exportPreview, formatSpikeSuiteMarkdown(records));
  };

  exportControls.append(
    makeButton("Copy Markdown Export", () => {
      const md = formatSpikeSuiteMarkdown(Array.from(resultsById.values()));
      clearAndAppendText(exportPreview, md);
      void globalThis.navigator?.clipboard?.writeText(md).catch(() => undefined);
    }),
    makeButton("View JSON Export", () => {
      const json = formatSpikeJsonExport(Array.from(resultsById.values()));
      clearAndAppendText(exportPreview, json);
    }),
    makeButton("Clear Results", () => {
      disposeLastGroundingPreview?.();
      disposeLastGroundingPreview = null;
      previewSlot.replaceChildren();
      previewSlot.textContent = "Run S-W6 to render and inspect a live Blob-URL sandboxed iframe.";
      resultsById.clear();
      renderResults();
    })
  );
  outputPanel.append(outputTitle, exportControls, resultsList, exportPreview);

  const readOptions = () => {
    const parsedIter = Number.parseInt(maxIterInput.input.value.trim(), 10);
    const manualInputs: SpikeManualInputs = {
      internalsModelName: modelInput.input.value,
      internalsComponentVersion: verInput.input.value,
      enableDownloadGesture: downloadChk.checked,
      groundingPreviewContainer: previewSlot,
      onDisposeGroundingPreview: registerGroundingDispose,
    };
    return {
      executionMode: "LIVE_BROWSER" as const,
      ...(Number.isFinite(parsedIter) && parsedIter > 0 ? { maxIterations: parsedIter } : {}),
      manualInputs,
    };
  };

  const executeSingle = async (id: Phase0SpikeId) => {
    const record = await runSpike(id, ctx, readOptions());
    resultsById.set(record.spikeId, record);
    renderResults();
  };

  const executeCategory = async (category: SpikeCategory) => {
    const ids = listSpikesByCategory(category).map((s) => s.spikeId);
    const records = await runSpikeSuite(ids, ctx, readOptions());
    for (const r of records) {
      resultsById.set(r.spikeId, r);
    }
    renderResults();
  };

  // Controls panel
  const runnerPanel = document.createElement("section");
  runnerPanel.className = "spike-panel";
  const runnerTitle = document.createElement("h2");
  runnerTitle.textContent = "Run Spikes";

  const suiteControls = document.createElement("div");
  suiteControls.className = "spike-controls";
  suiteControls.append(
    makeButton("Run All Web L1 Spikes", () => {
      void executeCategory("web-l1");
    }),
    makeButton("Run All Platform Spikes (S-W5, S-W6, S-N4)", () => {
      void executeCategory("web-platform");
    }),
    makeButton("Run All Cloud L2/Auth Spikes", () => {
      void executeCategory("cloud-l2");
    }),
    makeButton("Run All Backend Checks (BE-1..BE-4)", () => {
      void executeCategory("backend");
    })
  );

  const singleControls = document.createElement("div");
  singleControls.className = "spike-controls";
  for (const def of SPIKE_REGISTRY) {
    singleControls.appendChild(
      makeButton(`Run ${def.spikeId}`, () => {
        void executeSingle(def.spikeId);
      })
    );
  }
  runnerPanel.append(runnerTitle, suiteControls, singleControls);

  root.replaceChildren(header, envPanel, inputsPanel, runnerPanel, previewPanel, outputPanel);
  void refreshEnv();
}
