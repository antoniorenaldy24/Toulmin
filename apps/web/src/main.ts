/**
 * Minimal Phase 0 production Web shell (`apps/web/index.html`).
 *
 * Binds `DOMPurify` for the `toulmin-html` Trusted Types policy, renders canonical copy
 * from `@toulmin/copy` strictly via DOM APIs (zero `innerHTML`), and reports local
 * Chrome built-in Gemini Nano environment readiness (`04` §5.1.2).
 */

import { EN_COPY } from "@toulmin/copy";
import { checkEnvironment, formatEnvironmentReasons } from "@toulmin/firebase-client";
import { bindDomPurifyHtmlSanitizer } from "./security/trustedTypes.js";

function renderShell(root: HTMLElement): void {
  const card = document.createElement("section");
  card.className = "toulmin-card";

  const heading = document.createElement("h1");
  heading.textContent = EN_COPY.product.name;
  card.appendChild(heading);

  const tagline = document.createElement("p");
  tagline.textContent = EN_COPY.product.singlePromise;
  card.appendChild(tagline);

  const statusLine = document.createElement("p");
  statusLine.className = "toulmin-badge";
  statusLine.textContent = EN_COPY.l3.PROBE_ENV.chip;
  card.appendChild(statusLine);

  const detailsLine = document.createElement("p");
  card.appendChild(detailsLine);

  const footer = document.createElement("p");
  footer.className = "toulmin-footer";
  footer.textContent = EN_COPY.disclaimers.unmarkedNotVerified;
  card.appendChild(footer);

  root.replaceChildren(card);

  void checkEnvironment().then((env) => {
    const messages = formatEnvironmentReasons(env.reasons);
    if (env.readiness === "available") {
      statusLine.textContent = EN_COPY.provenance.ON_DEVICE;
      detailsLine.textContent = EN_COPY.disclaimers.onDeviceNotVerdicts;
    } else if (env.readiness === "downloadable") {
      statusLine.textContent = EN_COPY.l3.OFFER_DOWNLOAD.chip;
      detailsLine.textContent = EN_COPY.l3.OFFER_DOWNLOAD.cardBody;
    } else if (env.readiness === "downloading") {
      statusLine.textContent = EN_COPY.l3.OFFER_DOWNLOAD.chip;
      detailsLine.textContent = EN_COPY.l3.DOWNLOADING.text.replace("{pct}", "0");
    } else {
      statusLine.textContent = EN_COPY.l3.NO_LOCAL_MODEL.confidentialChip;
      detailsLine.textContent =
        messages.length > 0 ? messages.join(" ") : EN_COPY.consent.consentACardTitle;
    }
  });
}

bindDomPurifyHtmlSanitizer();

const root = document.getElementById("app-root");
if (root) {
  renderShell(root);
}
